import { readFileSync } from "node:fs";
import { expect, test, fixture, type App as Page } from "./app";

const holdFileSave = `(()=>{const transact=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,mode,...rest){const tx=transact.call(this,names,mode,...rest);if(mode==='readwrite'&&[].concat(names).includes('files')){let listener;Object.defineProperty(tx,'oncomplete',{get(){return listener},set(value){listener=value;IDBTransaction.prototype.__lookupSetter__('oncomplete').call(tx,(...args)=>setTimeout(()=>value(...args),900))}})}return tx}})()`;
const paste = (target: string, name: string, body = "note") =>
  `(()=>{const data=new DataTransfer();data.items.add(new File([${JSON.stringify(body)}],${JSON.stringify(name)},{type:'text/plain'}));document.getElementById(${JSON.stringify(target)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`;
const submitDisabled = `document.querySelector('button[aria-label="Submit comment"]').disabled`;
const localComment = (text: string) =>
  `[...document.querySelectorAll('[data-comment^="local-"]')].some(n=>n.textContent.includes(${JSON.stringify(text)}))`;
const caretLocation = `(()=>{const editor=document.getElementById('description'),selection=getSelection();let top=selection.anchorNode;while(top&&top.parentNode!==editor&&top!==editor)top=top.parentNode;const children=[...editor.children],media=editor.querySelector('img')?.closest('.ProseMirror-selectednode')??editor.querySelector('img')?.closest('#description > div');return {block:top===editor?selection.anchorOffset:children.indexOf(top),image:children.indexOf(media),selected:!!editor.querySelector('.ProseMirror-selectednode')}})()`;
const imageLoaded = `document.querySelector('#description img')?.naturalWidth===320`;

/** TEST-1 opened on a fresh page, its description image loaded and selected. */
async function selectImage(open: (path?: string) => Promise<Page>) {
  const page = await open();
  await page.click('[data-key="TEST-1"]');
  await page.waitFor(imageLoaded, 15000);
  await page.click("#description img");
  return page;
}

test("comment composer: Delete, Backspace or removing a pending upload never blocks sending", async ({
  open,
}) => {
  const page = await open();
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.eval(holdFileSave);

  await test.step("forward Delete beside an upload cannot leave the composer blocked", async () => {
    await page.click("#comment");
    await page.type("hello world");
    await page.key("Home");
    await page.eval(paste("comment", "note.txt"));
    await page.waitFor(`!!document.querySelector('#comment .media-upload')`);
    await page.key("Delete");
    await page.waitFor(`!${submitDisabled}`, 10000);
    expect(
      await page.eval(`document.querySelector('#comment .file-media')?.textContent`),
    ).toContain("note.txt");
    await page.eval(`document.getElementById('comment').focus()`);
    await page.key("Enter", "meta");
    await page.waitFor(localComment("note.txt"));
  });

  await test.step("removing an entire pending insertion releases Submit after a successful save and explains recovery", async () => {
    await page.click("#comment");
    await page.type("hello world");
    await page.key("Home");
    await page.key("ArrowRight");
    await page.key("ArrowRight");
    await page.key("ArrowRight");
    await page.eval(paste("comment", "removed.txt"));
    await page.waitFor(`!!document.querySelector('#comment .media-upload')`);
    await page.key("a", "meta");
    await page.key("Backspace");
    await page.waitFor(
      `document.querySelector('.rich-editor:has(#comment) > p[role="status"]')?.textContent.includes('Files saved to issue attachments')`,
      10000,
    );
    await page.type("Send after recovering the attachment");
    expect(await page.eval(submitDisabled)).toBe(false);
    expect(await page.eval(`!!document.querySelector('#comment .media-upload')`)).toBe(false);
    await page.key("Enter", "meta");
    await page.waitFor(localComment("Send after recovering the attachment"));
  });

  await test.step("Backspace beside a pending upload retains its insertion", async () => {
    await page.click("#comment");
    await page.type("hello world");
    await page.eval(paste("comment", "backspace.txt"));
    await page.waitFor(`!!document.querySelector('#comment .media-upload')`);
    await page.key("Backspace");
    await page.waitFor(
      `document.querySelector('#comment .file-media')?.textContent.includes('backspace.txt')`,
      10000,
    );
    expect(await page.eval(submitDisabled)).toBe(false);
  });
});

test("description files: a drop lands at its text coordinates, and active HTML and SVG download instead of running", async ({
  open,
}) => {
  const page = await open();
  await page.click('[data-key="TEST-2"]');

  await test.step("a file drop uses its text coordinates instead of the current editor selection", async () => {
    await page.waitFor(`!!document.querySelector('#description p a')`);
    await page.eval(
      `(()=>{const editor=document.getElementById('description'),heading=editor.querySelector('h2');editor.focus();const range=document.createRange();range.setStart(heading.firstChild,0);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range)})()`,
    );
    await page.eval(
      `(()=>{const editor=document.getElementById('description'),node=document.createTreeWalker(editor.querySelector('p a'),NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(node,9);range.collapse(true);const r=range.getBoundingClientRect(),data=new DataTransfer();data.items.add(new File(['Dropped at coordinates'],'coordinate.txt',{type:'text/plain'}));editor.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true,clientX:r.x,clientY:r.y+r.height/2}))})()`,
    );
    await page.waitFor(`!!document.querySelector('#description .file-media')`);
    expect(
      await page.eval(
        `document.querySelector('#description .file-media').closest('#description > div').previousElementSibling.textContent`,
      ),
    ).toBe("Formatted");
    expect(
      await page.eval(
        `document.querySelector('#description .file-media').closest('#description > div').nextElementSibling.textContent`,
      ),
    ).toBe(" fixture");
  });

  await test.step("active local HTML and SVG download when their blob links are opened, including after reload", async () => {
    const payloads = [
      {
        name: "active.html",
        type: "text/html",
        body: '<script>document.title="EXEC_LOCAL"</script>',
      },
      {
        name: "active.svg",
        type: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" onload="document.title=\'EXEC_LOCAL\'"></svg>',
      },
    ];
    const both = `${JSON.stringify(payloads.map((p) => p.name))}.every(name=>[...document.querySelectorAll('#description .file-media')].some(n=>n.textContent.includes(name)))`;
    await page.eval(
      `(()=>{const data=new DataTransfer();for(const f of ${JSON.stringify(payloads)})data.items.add(new File([f.body],f.name,{type:f.type}));document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(both);
    for (const restored of [false, true]) {
      if (restored) {
        await page.waitFor(
          `document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`,
        );
        await page.reload();
        await page.waitFor(both, 15000);
      }
      for (const payload of payloads) {
        const href = await page.eval<string>(
          `[...document.querySelectorAll('#description .file-media')].find(n=>n.textContent.includes(${JSON.stringify(payload.name)})).querySelector('a').href`,
        );
        const mime = await page.eval(
          `fetch(${JSON.stringify(href)}).then(r=>r.headers.get('content-type'))`,
        );
        // Opened as a page of its own, the file downloads instead of running in the app's origin.
        const tab = await page.context.newPage();
        const download = tab.waitForEvent("download");
        await tab.goto(href).catch(() => {}); // a download aborts the navigation
        const path = (await (await download).path())!;
        expect(await tab.title()).not.toContain("EXEC_LOCAL");
        expect(readFileSync(path, "utf8")).toBe(payload.body);
        expect(mime).toBe("application/octet-stream");
        await tab.close();
      }
    }
  });
});

test("selected media: arrows, dictation and IME land beside the media, never at the document start", async ({
  open,
}) => {
  await fixture.reset({ includeMedia: true });

  for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"])
    await test.step(`${key} from selected media lands in the adjacent caret position`, async () => {
      const page = await selectImage(open);
      const before = await page.eval<any>(caretLocation);
      await page.key(key);
      await expect
        .poll(async () => (await page.eval<any>(caretLocation)).block)
        .toBe(before.image + (["ArrowRight", "ArrowDown"].includes(key) ? 1 : -1));
      if (key === "ArrowRight") {
        await page.key("ArrowRight");
        await page.waitFor(
          `!!document.querySelector('#description .ProseMirror-selectednode .file-media')`,
        );
        await page.key("ArrowDown");
        await expect
          .poll(async () => (await page.eval<any>(caretLocation)).block)
          .toBe(before.image + 3);
      }
      await page.cmd("Input.insertText", { text: "Beside image" });
      expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe(
        "Rich fixture heading",
      );
    });

  for (const ime of [false, true])
    await test.step(`${ime ? "IME" : "dictation"} over selected media inserts at the media rather than the document start`, async () => {
      const page = await selectImage(open);
      const before = await page.eval<any>(caretLocation);
      if (ime)
        await page.cmd("Input.imeSetComposition", {
          text: "に",
          selectionStart: 1,
          selectionEnd: 1,
        });
      const text = ime ? "日本" : "Dictation";
      await page.cmd("Input.insertText", { text });
      await page.waitFor(
        `document.getElementById('description').textContent.includes(${JSON.stringify(text)})`,
      );
      const after = await page.eval<any>(caretLocation);
      expect(after.block).toBeGreaterThanOrEqual(before.image - 1);
      expect(after.block).toBeLessThanOrEqual(before.image + 1);
      expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe(
        "Rich fixture heading",
      );
    });

  for (const direction of ["ArrowLeft", "ArrowRight"])
    await test.step(`multi-step IME after ${direction} next to media commits exactly the requested words`, async () => {
      const page = await selectImage(open);
      await page.key(direction);
      let committed = "";
      for (const [steps, commit] of [
        [["n", "に", "にh", "にほ", "にほn", "にほん"], "日本"],
        [["g", "ご"], "語"],
      ] as const) {
        for (const text of steps)
          await page.cmd("Input.imeSetComposition", {
            text,
            selectionStart: text.length,
            selectionEnd: text.length,
          });
        await page.cmd("Input.insertText", { text: commit });
        committed += commit;
        await page.waitFor(
          `getSelection().anchorNode.parentElement.closest('p')?.textContent===${JSON.stringify(committed)}`,
        );
      }
      expect(
        await page.eval(`getSelection().anchorNode.parentElement.closest('p').textContent`),
      ).toBe("日本語");
      await page.waitFor(
        `!getSelection().anchorNode.parentElement.closest('p').hasAttribute('data-media-caret')`,
      );
      expect(
        await page.eval(
          `parseFloat(getComputedStyle(getSelection().anchorNode.parentElement.closest('p')).lineHeight)`,
        ),
      ).toBeGreaterThan(10);
    });

  await test.step("assistive text stays at its requested position", async () => {
    const page = await selectImage(open);
    await page.eval(
      `getSelection().collapse(document.querySelector('#description h2').firstChild,3)`,
    );
    // The editor has taken the new selection once the image is no longer selected.
    await page.waitFor(`!document.querySelector('#description .ProseMirror-selectednode')`);
    await page.cmd("Input.insertText", { text: "Q" });
    expect(await page.eval(`document.querySelector('#description h2').textContent`)).toBe(
      "RicQh fixture heading",
    );
  });
});

test("image selection and delete undo survive twenty independent issue openings", async ({
  open,
}) => {
  await fixture.reset({ includeMedia: true });
  // Four lanes of five: each opening is still a fresh page of its own, they just overlap.
  await Promise.all(
    [0, 1, 2, 3].map(async (lane) => {
      for (let i = lane; i < 20; i += 4) {
        const page = await open();
        await page.click('[data-key="TEST-1"]');
        await page.waitFor(
          `document.querySelector('#description video')?.readyState>=1&&${imageLoaded}`,
          15000,
        );
        await page.click("#description img");
        await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode')`);
        await page.key(i % 2 ? "Delete" : "Backspace");
        await page.waitFor(`!document.querySelector('#description img')`);
        await page.key("z", "meta");
        await page.waitFor(imageLoaded);
        await page.close();
      }
    }),
  );
});

test("nested list, table and quote media accept selection and uploads after their text", async ({
  open,
}) => {
  for (const container of ["list", "table", "quote"])
    await test.step(`nested ${container} media`, async () => {
      await fixture.reset({ includeMedia: true, mediaVariant: `nested-${container}` });
      const page = await open(),
        errors: string[] = [];
      await page.cmd("Runtime.enable");
      page.onEvent("Runtime.exceptionThrown", (event) =>
        errors.push(event.exceptionDetails.exception?.description ?? event.exceptionDetails.text),
      );
      await page.click('[data-key="TEST-2"]');
      await page.hover("#description img");
      await page.waitFor(imageLoaded, 15000);
      await page.click("#description img");
      await page.key("ArrowLeft");
      await page.eval(paste("description", "nested-upload.txt", "Nested file"));
      await page.waitFor(
        `document.querySelector('#description .file-media')?.textContent.includes('nested-upload.txt')`,
        10000,
      );
      expect(await page.eval(`!!document.querySelector('#description img')`)).toBe(true);
      expect(errors).toEqual([]);
    });
});
