import { expect, test, sleep, fixture, type App as Page } from "./app";
async function comment(page: Page, text: string) {
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.click("#comment");
  await page.type(text);
  await page.key("Enter", "meta");
  await page.waitFor(
    `document.querySelector('[data-comment]')?.textContent.includes(${JSON.stringify(text.replaceAll("**", ""))})`,
  );
}
const saved = `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`;
const media = { includeMedia: true, mediaInComment: true };

test("a comment becomes an issue and a sub-issue, then its thread is deleted like Linear", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("new issue from comment carries its rich description into the editor and created issue", async () => {
    await comment(page, "**Original** comment to copy");
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=New issue from comment…");
    await page.waitFor(`!!document.querySelector('[role="dialog"] [contenteditable]')`);
    expect(
      await page.eval(`document.querySelector('[role="dialog"] [contenteditable]').textContent`),
    ).toContain("Original comment to copy");
    await page.type("Copied discussion");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-toast] button')`);
    await page.click("[data-toast] button");
    await page.waitFor(`!!document.querySelector('#description strong')`);
    expect(await page.eval(`document.getElementById('description').textContent`)).toContain(
      "Original comment to copy",
    );
  });
  await test.step("New sub-issue from comment… creates a child of the commented issue", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-comment]')`);
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=New sub-issue from comment…");
    await page.waitFor(`!!document.querySelector('[role="dialog"] [contenteditable]')`);
    await page.type("Copied child");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-toast] button')`);
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(
      `[...document.querySelectorAll('[data-sub-issues="TEST-2"] [data-sub-issue]')].some(n=>n.textContent.includes('Copied child'))`,
    );
  });
  await test.step("deleting a thread confirms like Linear, shows no toast and stays absent from board counts after reload", async () => {
    await page.goto("?issue=TEST-2&view=side");
    await page.waitFor(`!!document.querySelector('[aria-label="Reply to thread"]')`);
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply to delete with root");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===2`);
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Delete");
    await page.waitFor(
      `document.activeElement?.textContent==='Delete'&&!!document.activeElement.closest('[role="dialog"][aria-label="Delete this comment?"]')`,
    );
    expect(
      await page.eval(
        `document.querySelector('[role="dialog"][aria-label="Delete this comment?"]').textContent`,
      ),
    ).toContain("You cannot undo this action.");
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Delete this comment?"]')`);
    expect(await page.eval(`document.querySelectorAll('[data-comment]').length`)).toBe(2);
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Delete");
    await page.waitFor(`!!document.querySelector('[aria-label="Delete this comment?"]')`);
    await page.key("Enter");
    // As in Jira, the reply outlives its root: it moves to "Original comment removed" at once (R1-D52).
    await page.waitFor(
      `document.querySelectorAll('[data-comment]').length===1&&document.querySelector('[data-thread]').textContent.includes('Original comment removed')`,
    );
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Delete");
    await page.waitFor(`!!document.querySelector('[aria-label="Delete this comment?"]')`);
    await page.key("Enter");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===0`);
    expect(
      await page.eval(
        `[!!document.querySelector('[data-toast]'),document.activeElement===document.body]`,
      ),
    ).toEqual([false, true]);
    await page.waitFor(saved);
    await page.goto("?board=1");
    await page.waitFor(`!!document.querySelector('[data-key="TEST-2"]')`);
    expect(
      await page.eval(`!!document.querySelector('[data-key="TEST-2"] :is([aria-label$=" comment"],[aria-label$=" comments"])')`),
    ).toBe(false);
  });
});

test("thread actions by keyboard and menu: undo and redo around a reminder, links, hash navigation, reactions, another author", async ({
  open,
}) => {
  await test.step("another author has no edit/delete actions and an unchanged Jira timestamp is not an edit", async () => {
    const page = await open("?issue=TEST-2&view=page", {
      setup: `const read=window.fetch;window.fetch=async(...args)=>{const r=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues/TEST-2')return r;const f=await r.json();f.fields.comment={total:1,comments:[{id:'foreign-root',author:{accountId:'another-user',displayName:'Another person'},created:'2026-11-07T01:00:00Z',updated:'2026-11-07T01:00:00Z',body:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'Another person comment'}]}]}}]};return Response.json(f)}`,
    });
    await page.waitFor(`!!document.querySelector('[data-comment="foreign-root"]')`);
    expect(
      await page.eval(`document.querySelector('[data-comment]').textContent.includes('edited')`),
    ).toBe(false);
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    const names = await page.eval<string[]>(
      `[...document.querySelectorAll('[role^=menuitem]')].map(e=>e.textContent)`,
    );
    expect(names).not.toContain("Edit");
    expect(names).not.toContain("Delete");
  });
  const page = await open("?issue=TEST-2&view=page");
  await test.step("open-app reminder delivery preserves redo and cannot trap undo or re-toast after redo", async () => {
    await comment(page, "Earlier user edit");
    // The reminder set "an hour from now" falls due 7 s later.
    await page.eval(`const now=Date.now;Date.now=()=>now()+3593000`);
    await page.click("#issue-options");
    await page.click('[role^=menuitem][data-value="Remind me"]');
    await page.click('[role^=menuitem][data-value="An hour from now"]');
    await page.click("#comment");
    await page.type("Temporary edit");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===2`);
    await page.click('[aria-label="Undo"]');
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===1`);
    expect(await page.eval(`document.querySelector('[aria-label="Redo"]').disabled`)).toBe(false);
    await page.waitFor(
      `document.querySelector('[data-toast]')?.textContent.includes('Reminder: Browser fixture 2')`,
      15000,
    );
    expect(await page.eval(`document.querySelector('[aria-label="Redo"]').disabled`)).toBe(false);
    await page.click('[aria-label="Undo"]');
    await page.waitFor(`document.body.textContent.includes('Undid set reminder')`);
    await page.click('[aria-label="Redo"]');
    await page.waitFor(`document.body.textContent.includes('Redid set reminder')`);
    await page.click("[data-toast] button");
    await sleep(250); // the redone, already delivered reminder must not toast again
    expect(await page.eval(`!!document.querySelector('[data-toast]')`)).toBe(false);
    await page.click('[aria-label="Undo"]');
    await page.click('[aria-label="Undo"]');
    await page.waitFor(`!document.querySelector('[data-comment]')`);
  });
  await test.step("copy links, hash navigation, reaction removal and reply draft cleanup follow the actual thread flow", async () => {
    await page.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await comment(page, "Thread for keyboard use");
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Saved reply");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===2`);
    // Focus stays in the emptied reply editor, as in Linear (R1-D75); Esc leaves it.
    expect(await page.active()).toBe("Reply to thread");
    await page.key("Escape");
    const replyId = await page.eval<string>(
      `document.querySelector('.comment-reply').dataset.comment`,
    );
    await page.hover(".comment-reply");
    await page.click('.comment-reply [aria-label="Reply options"]');
    await page.click("text=Copy link to comment");
    expect(new URL(await page.eval<string>("navigator.clipboard.readText()")).hash).toBe(
      `#comment-${replyId}`,
    );
    await page.click('[aria-label="Reply to thread"]');
    await page.waitFor(`!!document.querySelector('[id^="reply-"]')`);
    expect(await page.eval(`document.querySelector('[id^="reply-"]').textContent`)).toBe("");
    expect(await page.eval(`Object.keys(localStorage).some(k=>k.includes('reply-draft'))`)).toBe(
      false,
    );
    await page.key("Escape");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Reply to thread'`);
    await page.hover(".comment-reply");
    await page.click('.comment-reply [aria-label="Add reaction"]');
    await page.type("blue heart");
    await page.key("Enter");
    await page.click('[aria-label="Remove 💙 reaction"]');
    expect(await page.eval(`!!document.querySelector('[aria-label="Remove 💙 reaction"]')`)).toBe(
      false,
    );
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Resolve thread");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Expand thread'`);
    await page.eval(
      `document.querySelector('[data-thread]').insertAdjacentHTML('beforebegin','<div style="height:1600px"></div>');for(const n of document.querySelectorAll('main *'))if(n.scrollHeight>n.clientHeight)n.scrollTop=0;location.hash='comment-${replyId}'`,
    );
    await page.waitFor(`!!document.querySelector('.comment-reply')`);
    await page.waitFor(
      `(()=>{const r=document.getElementById('comment-${replyId}').getBoundingClientRect(),m=document.querySelector('main').getBoundingClientRect();return r.top>=m.top&&r.bottom<=m.bottom})()`,
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Attach to reply"]')`)).toBe(
      true,
    );
    await page.hover(".comment-reply");
    await page.click('.comment-reply [aria-label="Reply options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
    await page.key("Escape");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Reply options'`);
  });
});

test("files in replies: a failed file blocks send until retry, and a file still saving sends once it is saved", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  const replies = (text: string) =>
    `[...document.querySelectorAll('.comment-reply')].filter(n=>n.textContent.includes(${JSON.stringify(text)}))`;
  await test.step("a failed reply attachment blocks send until retry and survives a reload after sending", async () => {
    await comment(page, "Parent for a file reply");
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply with attachment");
    await page.eval(
      `const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='files'){IDBObjectStore.prototype.put=put;throw new DOMException('Reply file could not save','QuotaExceededError')}return put.apply(this,args)}`,
    );
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['Reply content'],'reply.txt',{type:'text/plain'}));document.querySelector('[id^="reply-"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(
      `document.querySelector('[id^="reply-"] [role="alert"]')?.textContent.includes('Reply file could not save')`,
    );
    expect(
      await page.eval(
        `document.querySelector('.rich-editor [data-variant="send"][aria-label="Submit reply"]').disabled`,
      ),
    ).toBe(true);
    await page.key("Enter", "meta");
    expect(await page.eval(`document.querySelectorAll('[data-comment]').length`)).toBe(1);
    await page.click("text=Retry");
    await page.waitFor(
      `document.querySelector('[id^="reply-"]').textContent.includes('reply.txt')&&!document.querySelector('[id^="reply-"] .media-upload')`,
    );
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('.comment-reply')?.textContent.includes('reply.txt')`,
    );
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(
      `document.querySelector('.comment-reply')?.textContent.includes('reply.txt')`,
    );
  });
  await test.step("sending a reply while its pasted file is still saving sends once the file is saved, like Linear", async () => {
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply sent while saving");
    await page.eval(
      `(()=>{const d=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');Object.defineProperty(IDBTransaction.prototype,'oncomplete',{configurable:true,get(){return d.get.call(this)},set(f){d.set.call(this,f&&[...this.objectStoreNames].join()==='files'?(...a)=>setTimeout(()=>f(...a),800):f)}})})()`,
    );
    await page.eval(
      `(()=>{const data=new DataTransfer();data.items.add(new File(['Busy content'],'busy.txt',{type:'text/plain'}));document.querySelector('[id^="reply-"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`!!document.querySelector('[id^="reply-"] .media-upload')`);
    await page.key("Enter", "meta");
    expect(await page.eval(`${replies("Reply sent while saving")}.length`)).toBe(0);
    await page.waitFor(`${replies("busy.txt")}.length>0`);
    expect(await page.eval(`${replies("busy.txt")}[0].textContent`)).toContain(
      "Reply sent while saving",
    );
    expect(await page.eval(`${replies("Reply sent while saving")}.length`)).toBe(1);
  });
});

test("Jira comments with media: copying them into issues, and local replies when the Jira root disappears and returns", async ({
  open,
}) => {
  await fixture.reset(media);
  const page = await open("?issue=TEST-2&view=page");
  await test.step("new issue from media-only comment copies playable bytes into durable local attachments", async () => {
    await page.waitFor(`!!document.querySelector('[data-comment] video')`);
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=New issue from comment…");
    await page.waitFor(`!!document.querySelector('[role="dialog"] video')`);
    await page.waitFor(`document.querySelector('[role="dialog"] video').readyState>=1`);
    expect(
      await page.eval(`document.querySelector('[role="dialog"] video').src.startsWith('blob:')`),
    ).toBe(true);
    await page.type("Media copied from discussion");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-toast] button')`);
    await page.click("[data-toast] button");
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`);
    expect(await page.eval(`document.querySelector('#description video').duration`)).toBeCloseTo(
      4,
      0,
    );
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`);
    expect(await page.eval(`document.querySelector('#description img').naturalWidth`)).toBe(320);
  });
  await test.step("navigating away during a held comment copy cannot open creation on the next issue", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-comment] video')`);
    await page.eval(
      `const read=window.fetch;window.fetch=async(...args)=>{if(String(args[0]).includes('/media/')){window.copyWaiting=true;await new Promise(resolve=>window.releaseCopy=resolve);window.fetch=read;}return read(...args)};const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='files')this.transaction.addEventListener('complete',()=>window.copySaved=true);return put.apply(this,args)}`,
    );
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.click("text=New issue from comment…");
    await page.waitFor("window.copyWaiting");
    await page.eval(
      `history.pushState(null,'','/issue/TEST-3');dispatchEvent(new PopStateEvent('popstate'));window.releaseCopy()`,
    );
    await page.waitFor("window.copySaved");
    await page.eval(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    );
    expect(await page.eval(`!!document.querySelector('[role="dialog"] [contenteditable]')`)).toBe(
      false,
    );
    expect(await page.eval(`document.getElementById('summary').value`)).toBe("Browser fixture 3");
  });
  await test.step("a local reply remains visible when its mirrored parent disappears upstream", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-comment="jira-media-comment"]')`);
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Keep my local reply");
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('[data-thread]').textContent.includes('Keep my local reply')`,
    );
    await page.waitFor(saved);
    await fixture.reset();
    await page.reload();
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.waitFor(
      `document.querySelector('[data-thread]')?.textContent.includes('Keep my local reply')`,
    );
    expect(await page.eval(`document.querySelector('[data-thread]').textContent`)).toContain(
      "Original comment removed",
    );
  });
  await test.step("replies to recovered orphans stay visible when the Jira root returns", async () => {
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply while parent absent");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===2`);
    await page.waitFor(saved);
    await fixture.reset(media);
    await page.reload();
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===3`);
    expect(await page.eval(`document.querySelector('[data-thread]').textContent`)).toContain(
      "Reply while parent absent",
    );
    expect(
      await page.eval(
        `document.querySelector('[data-key="TEST-2"] [aria-label$=" comments"]')?.getAttribute('aria-label')`,
      ),
    ).toBe("3 comments");
    await page.waitFor(saved);
    await page.goto("?board=1");
    await page.waitFor(`!!document.querySelector('[data-key="TEST-2"]')`);
    expect(
      await page.eval(
        `document.querySelector('[data-key="TEST-2"] [aria-label$=" comments"]')?.getAttribute('aria-label')`,
      ),
    ).toBe("3 comments");
  });
});
