import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { expect, test, type App as Page, fixture, fileHash, savedAs } from "./app";

const choose = (page: Page, selector: string, files: string[]) =>
  page.page.locator(selector).setInputFiles(files.map((name) => `e2e/fixtures/${name}`));
const DESCRIPTION_FILES = ".rich-editor:has(#description) input[type=file]";
const COMMENT_FILES = ".rich-editor:has(#comment) input[type=file]";
const SAVED = `document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`;
const submitDisabled = `[...document.querySelectorAll('button')].find(b=>b.textContent==='Submit comment').disabled`;

test("local files: uploads render, play and survive reload without Jira media calls, and back up byte for byte", async ({
  open,
}) => {
  const page = await open();
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`!!document.querySelector('#description')`);

  await test.step("mixed local uploads render inline, play, persist after reload, and never call Jira media APIs", async () => {
    await choose(page, DESCRIPTION_FILES, ["media-image.png", "media-video.mp4", "media-file.txt"]);
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
    await page.hover("#description img");
    await page.waitFor(`document.querySelector('#description img')?.naturalWidth===320`);
    expect(
      await page.eval(
        `document.querySelector('#description video').getAttribute('src').startsWith('blob:')`,
      ),
    ).toBe(true);
    expect(await page.eval(`document.querySelector('#description video').duration`)).toBeCloseTo(
      4,
      0,
    );
    expect(
      await page.eval(`document.querySelector('#description img').getBoundingClientRect().width`),
    ).toBeLessThanOrEqual(320);
    expect(
      await page.eval(`document.querySelector('#description .file-media').textContent`),
    ).toContain("media-file.txt");
    expect(
      await page.eval(
        `[...document.querySelectorAll('#description > div')].filter(n=>n.querySelector('.media-frame')).every(n=>n.previousElementSibling?.matches('p,h1,h2,h3,h4,h5,h6,pre')&&n.nextElementSibling?.matches('p,h1,h2,h3,h4,h5,h6,pre'))`,
      ),
    ).toBe(true);
    await page.eval(`document.querySelector('#description video').play()`);
    await page.waitFor(`document.querySelector('#description video').currentTime>.1`);
    await page.waitFor(SAVED);
    await page.reload();
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
    await page.hover("#description img");
    expect(
      await page.eval(
        `document.querySelector('#description img').getAttribute('src').startsWith('blob:')`,
      ),
    ).toBe(true);
    const log = await fixture.log();
    expect(log.requests.filter((r) => /\/media\/|\/attachments\//.test(r.path))).toEqual([]);
    expect(log.requests.some((r) => r.method !== "GET")).toBe(false);
  });

  await test.step("pasted and dropped files join the same local description flow, and comment attachments survive send/reload", async () => {
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['Pasted fixture'],'pasted.txt',{type:'text/plain'}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(
      `[...document.querySelectorAll('#description .file-media')].some(n=>n.textContent.includes('pasted.txt'))`,
    );
    await page.eval(
      `(()=>{const node=document.getElementById('description'),r=node.getBoundingClientRect(),data=new DataTransfer();data.items.add(new File(['Dropped fixture'],'dropped.txt',{type:'text/plain'}));node.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true,clientX:r.x+20,clientY:r.y+20}))})()`,
    );
    await page.waitFor(
      `document.getElementById('description').textContent.includes('dropped.txt')`,
    );
    await choose(page, COMMENT_FILES, ["media-image.png"]);
    await page.waitFor(`!!document.querySelector('#comment img')`);
    await page.click("text=Submit comment");
    await page.waitFor(`!!document.querySelector('[data-comment^="local-"] img')`);
    await page.waitFor(SAVED);
    await page.reload();
    await page.waitFor(
      `document.getElementById('description')?.textContent.includes('dropped.txt')`,
      15000,
    );
    expect(await page.eval(`document.getElementById('description').textContent`)).toContain(
      "pasted.txt",
    );
    await page.waitFor(`!!document.querySelector('[data-comment^="local-"] img')`);
    expect(
      await page.eval(
        `document.querySelector('[data-comment^="local-"] img').getAttribute('src').startsWith('blob:')`,
      ),
    ).toBe(true);
  });

  await test.step("local video download preserves bytes and the binary backup contains files plus their manifest", async () => {
    // A fresh page: the backup must hold exactly this step's two files.
    const page = await open(),
      dir = await mkdtemp(join(tmpdir(), "better-jira-local-export-"));
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.querySelector('#description')`);
    await choose(page, DESCRIPTION_FILES, ["media-video.mp4", "media-file.txt"]);
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
    const download = page.page.waitForEvent("download");
    await page.hover("#description video");
    await page.click('#description [aria-label="Download"]');
    const video = await savedAs(download, "media-video.mp4");
    expect(existsSync(video)).toBe(true);
    expect(fileHash(video)).toBe(fileHash("e2e/fixtures/media-video.mp4"));
    await page.waitFor(SAVED);
    const backup = page.page.waitForEvent("download");
    await page.click('[aria-label="Download backup"]');
    const archive = await savedAs(backup, "better-jira-local-backup.tar");
    expect(existsSync(archive)).toBe(true);
    expect(spawnSync("tar", ["-xf", archive, "-C", dir]).status).toBe(0);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.files).toHaveLength(2);
    const change = manifest.state.changes.find((change: any) => change.key === "TEST-2");
    expect(change.issue.attachments).toHaveLength(2);
    for (const asset of change.issue.attachments) {
      const entry = manifest.files.find((entry: any) => entry.id === asset.id);
      expect(entry.size).toBe(asset.size);
      expect(fileHash(join(dir, entry.path))).toBe(fileHash(`e2e/fixtures/${asset.name}`));
    }
    await rm(dir, { recursive: true });
  });
});

test("local storage failures: nothing partial is saved, Retry saves the whole selection, and Discard releases the composer", async ({
  open,
}) => {
  const page = await open();
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`!!document.querySelector('#description')`);

  await test.step("a failed multi-file storage transaction leaves no partial files and Retry saves the whole selection", async () => {
    await page.eval(
      `(()=>{const put=IDBObjectStore.prototype.put;let calls=0;IDBObjectStore.prototype.put=function(...args){if(this.name==='files'&&++calls===2){IDBObjectStore.prototype.put=put;throw new DOMException('Fixture quota exceeded','QuotaExceededError')}return put.apply(this,args)}})()`,
    );
    await choose(page, DESCRIPTION_FILES, ["media-image.png", "media-file.txt"]);
    await page.waitFor(
      `document.querySelector('#description .media-upload[role="alert"]')?.textContent.includes('Fixture quota exceeded')`,
    );
    expect(
      await page.eval(
        `(async()=>{const names=await indexedDB.databases();const entry=names.find(n=>n.name.startsWith('better-jira:local:'));return new Promise(resolve=>{const open=indexedDB.open(entry.name);open.onsuccess=()=>{const db=open.result,request=db.transaction('files','readonly').objectStore('files').count();request.onsuccess=()=>{resolve(request.result);db.close()}}})})()`,
      ),
    ).toBe(0);
    await page.click("text=Retry");
    await page.waitFor(`!!document.querySelector('#description img')`);
    await page.waitFor(
      `document.querySelector('#description .file-media')?.textContent.includes('media-file.txt')`,
    );
    expect(await page.eval(`!!document.querySelector('#description .media-upload')`)).toBe(false);
  });

  await test.step("comments cannot send while an attachment needs retry, and discarding releases the composer", async () => {
    await page.eval(
      `(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='files'){IDBObjectStore.prototype.put=put;throw new DOMException('Attachment storage failed','QuotaExceededError')}return put.apply(this,args)}})()`,
    );
    await choose(page, COMMENT_FILES, ["media-file.txt"]);
    await page.waitFor(
      `document.querySelector('#comment [role="alert"]')?.textContent.includes('Attachment storage failed')`,
    );
    expect(await page.eval(submitDisabled)).toBe(true);
    await page.eval(`document.getElementById('comment').focus()`);
    await page.type("Text waiting for its attachment");
    await page.key("Enter", "meta");
    expect(await page.eval(`!!document.querySelector('[data-comment^="local-"]')`)).toBe(false);
    await page.click("text=Discard");
    await page.waitFor(`!document.querySelector('#comment .media-upload')`);
    expect(await page.eval(submitDisabled)).toBe(false);
    await page.click("text=Submit comment");
    await page.waitFor(
      `document.querySelector('[data-comment^="local-"]')?.textContent.includes('Text waiting for its attachment')`,
    );
  });
});
