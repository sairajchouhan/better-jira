import { expect, test, sleep, type App as Page } from "./app";
// Sending while a pasted file is still saving (Opus review 4, P1–P5): posted once, never resurrected into a draft, and a sub-issue keeps its image.
const hold = `window.createImageBitmap=()=>new Promise(r=>{window.release=()=>r({width:10,height:10,close(){}})});`;
async function paste(p: Page, sel: string, name = "late.png") {
  await p.eval(
    `${hold}(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'${name}',{type:'image/png'}));document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
  );
  await p.waitFor(`typeof window.release==='function'`);
}
const go = async (p: Page, key: string) => {
  await p.eval(
    `history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`,
  );
  await p.waitFor(
    `!!document.querySelector('[data-key="${key}"]')&&!!document.getElementById('comment')`,
  );
};
const composerMedia = `document.querySelectorAll('#comment [contenteditable=false]:not([contenteditable=false] *)').length`;
const saved = `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`;
/** The comment count on TEST-2's row, which every page keeps in the DOM. */
const commentsOnTest2 = (n: number) =>
  `document.querySelector('[data-key="TEST-2"] [aria-label$=" comments"]')?.getAttribute('aria-label')==="${n} comments"&&${saved}`;
const threadsWith = (p: Page, text: string) =>
  p.eval<number>(
    `[...document.querySelectorAll('[data-thread]')].filter(n=>n.textContent.includes(${JSON.stringify(text)})).length`,
  );

test("sending a comment or reply while its pasted file is still saving: posted once, never resurrected into a draft (P5, P1, P2)", async ({
  open,
}) => {
  const p = await open("?issue=TEST-2&view=page");
  await p.waitFor(`!!document.getElementById('comment')`);
  await test.step("P5 reply sent while upload pending, then user leaves: reply posted once, reply draft not resurrected", async () => {
    await p.click("#comment");
    await p.type("ROOT P5");
    await p.key("Enter", "meta");
    await p.waitFor(`!!document.querySelector('[aria-label="Reply to thread"]')`);
    await p.click('[aria-label="Reply to thread"]');
    await p.type("REPLY PENDING");
    await pastePng(p, '[id^="reply-"]');
    await p.key("Enter", "meta");
    await go(p, "TEST-3");
    await p.eval("window.release()");
    await p.waitFor(commentsOnTest2(2)); // the reply went out while TEST-3 is open
    await go(p, "TEST-2");
    await p.reload();
    await p.waitFor(`!!document.querySelector('.comment-reply')`);
    expect(
      await p.eval(
        `[...document.querySelectorAll('.comment-reply')].filter(n=>n.textContent.includes('REPLY PENDING')).length`,
      ),
    ).toBe(1);
    expect(await p.eval(`Object.keys(localStorage).some(k=>k.includes('reply-draft'))`)).toBe(
      false,
    );
    await p.click('[aria-label="Reply to thread"]');
    await p.waitFor(`!!document.querySelector('[id^="reply-"]')`);
    await sleep(300); // no late media may land in the reopened reply
    expect(
      await p.eval(
        `({text:document.querySelector('[id^="reply-"]')?.textContent,media:document.querySelectorAll('[id^="reply-"] [contenteditable=false]:not([contenteditable=false] *)').length})`,
      ),
    ).toEqual({ text: "", media: 0 });
    await p.key("Escape");
  });
  await test.step("P1 comment sent while upload pending, then user leaves the issue: posted once, draft not resurrected", async () => {
    await p.click("#comment");
    await p.type("SEND PENDING");
    await paste(p, "#comment");
    await p.key("Enter", "meta");
    await go(p, "TEST-3");
    await p.eval("window.release()");
    await p.waitFor(commentsOnTest2(3)); // posted while TEST-3 is open
    await go(p, "TEST-2");
    await p.reload();
    await p.waitFor(
      `!!document.getElementById('comment')&&document.querySelectorAll('[data-thread]').length===2`,
    );
    expect(await threadsWith(p, "SEND PENDING")).toBe(1);
    expect(await p.eval(composerMedia)).toBe(0);
    expect(await p.eval(`Object.keys(localStorage).some(k=>k.includes('comment-draft'))`)).toBe(
      false,
    );
  });
  await test.step("P2 comment sent while upload pending, user leaves and returns before it finishes: live composer stays empty", async () => {
    await p.click("#comment");
    await p.type("SEND PENDING 2");
    await paste(p, "#comment");
    await p.key("Enter", "meta");
    await go(p, "TEST-3");
    await go(p, "TEST-2");
    await p.eval("window.release()");
    await p.waitFor(
      `[...document.querySelectorAll('[data-thread]')].some(n=>n.textContent.includes('SEND PENDING 2'))&&${saved}`,
    );
    await sleep(300); // no late media may land in the live composer
    expect(await p.eval(composerMedia)).toBe(0);
    await p.reload();
    await p.waitFor(
      `!!document.getElementById('comment')&&document.querySelectorAll('[data-thread]').length===3`,
    );
    expect(await threadsWith(p, "SEND PENDING 2")).toBe(1);
  });
});

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
async function pastePng(p: Page, sel: string, name = "real.png") {
  await p.eval(
    `window.release=undefined;window.createImageBitmap=()=>new Promise(r=>{window.release=()=>r({width:10,height:10,close(){}})});(()=>{const b=Uint8Array.from(atob('${PNG}'),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([b],'${name}',{type:'image/png'}));document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
  );
  await p.waitFor(`typeof window.release==='function'`);
}
const openSub = async (p: Page) => {
  await p.hover("#summary"); // ⌘⇧O acts on a hovered sub-issue row, so the pointer leaves the list
  await p.eval("document.activeElement?.blur()");
  await p.key("o", "meta", "shift");
  await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Sub-issue title'`);
};
const childKey = (p: Page, title: string) =>
  p.waitFor<string>(
    `[...document.querySelectorAll('[data-sub-issue]')].find(n=>n.textContent.includes(${JSON.stringify(title)}))?.dataset.subIssue`,
  );
const subMedia = `document.querySelectorAll('[aria-label="Sub-issue description"] [contenteditable=false]:not([contenteditable=false] *)').length`;
/** Opens the child and waits for its description to carry the image. */
async function childHasImage(p: Page, key: string) {
  await go(p, key);
  await p.waitFor(`document.getElementById('description')?.innerHTML.includes('data-media-group')`);
}

test("creating a sub-issue while its pasted image is still saving: the child keeps the image, once (P3c, P3, P4)", async ({
  open,
}) => {
  const p = await open("?issue=TEST-2&view=page");
  await p.waitFor(`!!document.getElementById('summary')`);
  await test.step("P3c control: sub-issue created after its image finished saving keeps the image", async () => {
    await openSub(p);
    await p.type("PENDING CHILD C");
    await p.click('[aria-label="Sub-issue description"]');
    await pastePng(p, '[aria-label="Sub-issue description"]');
    await p.eval("window.release()");
    await p.waitFor(
      `${subMedia}===1&&!document.querySelector('[aria-label="Sub-issue description"] .media-upload')`,
    );
    await p.key("Enter", "meta");
    await childHasImage(p, await childKey(p, "PENDING CHILD C"));
    await go(p, "TEST-2");
  });
  await test.step("P3 sub-issue created with Cmd+Enter while its pasted image is still saving: child keeps the image", async () => {
    await openSub(p);
    await p.type("PENDING CHILD A");
    await p.click('[aria-label="Sub-issue description"]');
    await pastePng(p, '[aria-label="Sub-issue description"]');
    await p.key("Enter", "meta");
    await p.eval("window.release()");
    const key = await childKey(p, "PENDING CHILD A");
    await sleep(300); // the image must not come back into the composer
    expect(await p.eval(subMedia)).toBe(0);
    await childHasImage(p, key);
    await go(p, "TEST-2");
  });
  await test.step("P4 sub-issue created while image saving, then user leaves: created once, draft not resurrected", async () => {
    await openSub(p);
    await p.type("PENDING CHILD B");
    await p.click('[aria-label="Sub-issue description"]');
    await pastePng(p, '[aria-label="Sub-issue description"]');
    // The board windows its cards (BJ-111), so the issue page's "n / total" shows what the board holds.
    const total = `Number(document.querySelector('[aria-label="Issue position"]')?.textContent.split("/")[1])`;
    const before = await p.eval<number>(total);
    await p.key("Enter", "meta");
    await go(p, "TEST-3");
    await p.eval("window.release()");
    // Created while TEST-3 is open: the new issue joins the board.
    await p.waitFor(`${total}===${before + 1}&&${saved}`);
    await go(p, "TEST-2");
    await p.reload();
    await p.waitFor(
      `!!document.getElementById('summary')&&!!document.querySelector('[data-sub-issue]')`,
    );
    await openSub(p);
    await sleep(300); // no draft may come back into the reopened composer
    expect(
      await p.eval(
        `({title:document.querySelector('[aria-label="Sub-issue title"]').value,media:${subMedia},childRows:[...document.querySelectorAll('[data-sub-issue]')].filter(n=>n.textContent.includes('PENDING CHILD B')).length})`,
      ),
    ).toEqual({ title: "", media: 0, childRows: 1 });
  });
});
