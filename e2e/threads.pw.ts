import { expect, test, sleep, fixture, type App as Page } from "./app";

const go = async (page: Page, key: string) => {
  await page.eval(
    `history.pushState({},'','?issue=${key}&view=page');dispatchEvent(new PopStateEvent('popstate'))`,
  );
  await page.waitFor(
    `new URL(location.href).searchParams.get('issue')==='${key}'&&!!document.getElementById('comment')`,
  );
};

// Headless Chrome draws 0.5px lines 1px wide, so the 0.5px rules are read from the stylesheet and the geometry below carries 1px lines (Linear: 0.5px, every offset 0.5px less).
test("one thread's life: draft, send, Linear's card and menus, react, resolve, reopen and a late reply paste", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { width: 1272, height: 902 });
  await page.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.waitFor(`!!document.getElementById('comment')`);
  await test.step("a reply draft stays with its thread across a reload, then sends", async () => {
    await page.click("#comment");
    await page.type("**Root** reference");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===1`);
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply draft");
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Reply to thread"]')`);
    await page.click('[aria-label="Reply to thread"]');
    await page.waitFor(`document.querySelector('[id^="reply-"]')?.textContent==='Reply draft'`);
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-comment]').length===2`);
  });
  await test.step('a comment card follows Linear (RAJ-52): 0.5px line and shadow, 16px padding, 13px header, 15px/450 body and a 46px "Leave a reply…" row with attach and send', async () => {
    // The empty reply editor keeps the focus after sending; Esc closes it back to the row.
    await page.key("Escape");
    await page.waitFor(`!!document.querySelector('.comment-reply-row')`);
    await page.eval("document.activeElement?.blur()");
    await page.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1265, y: 895 });
    await page.waitFor(`!document.getAnimations().length`); // hover transitions have run out
    const geo = `(()=>{const R=n=>{const b=n.getBoundingClientRect();return [b.x,b.y,b.width,b.height]},card=document.querySelector('[data-thread]'),c=R(card),rel=n=>R(n).map((v,i)=>Math.round((i<2?v-c[i]:v)*10)/10),st=(n,...k)=>k.map(p=>getComputedStyle(n)[p]);
   const [root,reply]=card.querySelectorAll('[data-comment]'),composer=card.querySelector('.comment-reply-composer'),head=root.querySelector('.comment-head'),body=root.querySelector('.comment-body');
   return {card:st(card,'borderTop','boxShadow','borderRadius'),root:[rel(root)[3],rel(head.children[0]),rel(head.children[1])[0],st(head.children[1],'fontSize','fontWeight','color'),st(head.children[2],'fontSize','fontWeight','color'),rel(body).slice(1),st(body,'fontSize','fontWeight','color')],
    reply:[rel(reply)[3],st(reply,'borderTop')[0],rel(reply.querySelector('.comment-head').children[0]).slice(0,2)],
    composer:[rel(composer)[3],st(composer,'borderTop')[0],(r=>[Math.round((r[1]-rel(composer)[1])*10)/10,r[2],r[3]])(rel(composer.querySelector('.comment-reply-row > :first-child'))),...['Reply to thread','Attach to reply','Submit reply'].map(l=>{const b=composer.querySelector('[aria-label="'+l+'"]');return [rel(b)[0],Math.round((c[2]-rel(b)[0]-rel(b)[2])*10)/10,rel(b).slice(2),...st(b,'fontSize','color','backgroundColor')]}),composer.querySelector('[aria-label="Reply to thread"]').textContent]}})()`;
    const g = await page.eval<any>(geo);
    expect(
      await page.eval(
        `[...document.styleSheets].flatMap(s=>[...s.cssRules]).filter(r=>/^\\.comment-(thread|reply|reply-composer)$/.test(r.selectorText)).map(r=>r.selectorText+' '+(r.style.borderTop||r.style.border).replace(/^\\.5/,'0.5'))`,
      ),
    ).toEqual([
      ".comment-thread 0.5px solid var(--hidden-line)",
      ".comment-reply 0.5px solid var(--hidden-line)",
      ".comment-reply-composer 0.5px solid var(--hidden-line)",
    ]);
    expect(g.card).toEqual([
      "1px solid lch(16.793 1.93 272)",
      "lch(0 0 0 / 0.3) 0px 0.5px 1px 1px",
      "8px",
    ]);
    expect(g.root).toEqual([
      80,
      [17, 17, 18, 18],
      44,
      ["13px", "500", "lch(100 0 272)"],
      ["13px", "450", "lch(63.304 1.425 272)"],
      [41, g.root[5][1], 24],
      ["15px", "450", "lch(90.826 1.425 272)"],
    ]);
    expect(g.reply).toEqual([77, "1px solid lch(16.793 1.93 272)", [17, 96]]);
    expect(g.composer.slice(0, 3)).toEqual([47, "1px solid lch(16.793 1.93 272)", [15, 18, 18]]);
    const [open_, attach, send, text] = g.composer.slice(3);
    expect([open_[0], open_[2][1], open_[3], open_[4], text]).toEqual([
      44,
      24,
      "15px",
      "lch(39.452 1.425 272)",
      "Leave a reply…",
    ]);
    expect([
      attach[2],
      send[2],
      Math.round((send[0] - attach[0] - 24) * 10) / 10,
      send[1],
      send[5],
    ]).toEqual([[24, 24], [24, 24], 12, 19, "lch(13.861 1.139 272)"]);
    await page.hover("[data-comment] .comment-body");
    await expect
      .poll(() =>
        page.eval(
          `(()=>{const c=document.querySelector('[data-thread]').getBoundingClientRect(),b=document.querySelector('[data-comment] [aria-label="Comment options"]').getBoundingClientRect();return [b.width,b.height,Math.round((b.top-c.top)*10)/10,Math.round((c.right-b.right)*10)/10,getComputedStyle(document.querySelector('[data-comment] [aria-label="Add reaction"]')).opacity]})()`,
        ),
      )
      .toEqual([28, 28, 12, 12, "1"]);
    expect(
      await page.eval(
        `(()=>{const b=document.querySelector('.rich-editor[data-variant=comment]:has(#comment) .rich-editor-submit')??document.getElementById('comment').closest('.rich-editor').querySelector('.rich-editor-submit'),c=getComputedStyle(b);return [c.backgroundColor,c.color]})()`,
      ),
    ).toEqual(["lch(13.861 1.139 272)", "lch(63.304 1.425 272)"]);
    await page.click('[aria-label="Submit reply"]');
    await page.waitFor(
      `document.activeElement?.closest('[data-thread]')&&document.activeElement.isContentEditable`,
    );
    await page.key("Escape");
    await page.waitFor(`!!document.querySelector('.comment-reply-row')`);
  });
  await test.step("copy thread produces rich Markdown", async () => {
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Copy thread as Markdown");
    expect(await page.eval("navigator.clipboard.readText()")).toBe(
      "**Audit user:**\n**Root** reference\n\n**Audit user:**\nReply draft",
    );
  });
  await test.step("right-clicking a reply opens the same menu as its options button, grouped and with icons as in Linear", async () => {
    await page.eval(
      `document.querySelector('.comment-reply').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await page.waitFor(
      `!!document.querySelector('[role="dialog"][aria-label="Comment options"] [cmdk-item]')`,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('[role="dialog"][aria-label="Comment options"] [cmdk-item]')].map(n=>n.textContent)`,
      ),
    ).toEqual([
      "Edit",
      "Unsubscribe from thread",
      "Resolve thread with comment",
      "Copy link to comment",
      "Copy content as Markdown",
      "New issue from comment…",
      "New sub-issue from comment…",
      "Delete",
    ]);
    expect(
      await page.eval(
        `(()=>{const m=document.querySelector('[role="dialog"][aria-label="Comment options"]');return [m.querySelectorAll('[cmdk-separator]').length,[...m.querySelectorAll('[cmdk-item]')].every(n=>n.querySelector('svg'))]})()`,
      ),
    ).toEqual([4, true]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"]')`);
  });
  await test.step("a reply reaction uses the issue's Linear pill: 42×28, violet fill, and a tooltip naming the shortcode", async () => {
    await page.click('.comment-reply [aria-label="Add reaction"]');
    await page.type("blue heart");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove 💙 reaction"]')`);
    expect(
      await page.eval(
        `(()=>{const p=document.querySelector('[aria-label="Remove 💙 reaction"]'),b=p.getBoundingClientRect(),c=getComputedStyle(p);return [Math.round(b.width),b.height,c.backgroundColor,c.borderRadius,p.title||p.dataset.title]})()`,
      ),
    ).toEqual([42, 28, "lch(14.391 19.592 286.445)", "9999px", "You reacted with :blue_heart:"]);
  });
  await test.step("a resolved thread persists over a reload; reopening it keeps its reply and reaction", async () => {
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Resolve thread");
    await page.waitFor(`!!document.querySelector('[aria-label="Expand thread"]')`);
    expect(
      await page.eval(`document.querySelector('[aria-label="Expand thread"]').textContent`),
    ).toContain("2 resolved comments");
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Expand thread"]')`);
    await page.click('[aria-label="Expand thread"]');
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Reopen thread");
    await page.waitFor(`!!document.querySelector('[aria-label="Reply to thread"]')`);
    expect(await page.eval(`document.querySelector('[data-thread]').textContent`)).toContain(
      "Reply draft",
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Remove 💙 reaction"]')`)).toBe(
      true,
    );
  });
  await test.step("a reply paste that finishes after switching issues is kept in that thread’s reply draft", async () => {
    await page.click('[aria-label="Reply to thread"]');
    await page.type("Reply text");
    await page.eval(
      `window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'late-reply.png',{type:'image/png'}));document.querySelector('[id^="reply-"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await go(page, "TEST-3");
    await page.eval("window.releaseBitmap()");
    // The late file lands in the thread's saved reply draft while TEST-3 is open.
    await page.waitFor(
      `Object.entries(localStorage).some(([k,v])=>k.includes('reply-draft')&&v.includes('"type":"media'))`,
    );
    await go(page, "TEST-2");
    await page.click('[aria-label="Reply to thread"]');
    const reply = `document.querySelector('[id^="reply-"]')`;
    // Distinct media IDs, not DOM nodes: an undecodable image swaps its <img> for an error card (Sol review 4).
    const media = `new Set([...${reply}.querySelectorAll('[data-media-id]')].map(n=>n.dataset.mediaId)).size`;
    await page.waitFor(`!!${reply}&&${media}===1`, 8000);
    expect(await page.eval(`${reply}.textContent`)).toContain("Reply text");
    // Reopened and edited while the upload is still pending: the live reply gets the file and keeps the new text.
    await page.eval(
      `window.releaseBitmap=undefined;window.createImageBitmap=()=>new Promise(resolve=>{window.releaseBitmap=()=>resolve({width:10,height:10,close(){}})});(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array([137,80,78,71])],'live-reply.png',{type:'image/png'}));document.querySelector('[id^="reply-"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true}))})()`,
    );
    await page.waitFor(`typeof window.releaseBitmap==='function'`);
    await go(page, "TEST-3");
    await go(page, "TEST-2");
    await page.click('[aria-label="Reply to thread"]');
    await page.waitFor(`!!${reply}`);
    await page.click('[id^="reply-"] p');
    // The caret goes to the end of the text: ⌘End can select the trailing image, and typing then replaces it.
    await page.eval(
      `(()=>{const r=document.createRange();r.selectNodeContents(${reply}.querySelector('p'));r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r)})()`,
    );
    await sleep(50); // the editor reads the new selection on selectionchange
    await page.cmd("Input.insertText", { text: " NEWER REPLY" });
    await page.eval("window.releaseBitmap()");
    await page.waitFor(`${media}===2`, 8000);
    expect(await page.eval(`${reply}.textContent`)).toContain("Reply text NEWER REPLY");
    expect(await page.eval(`${reply}.textContent`)).toContain("late-reply.png");
  });
  await test.step("a reply menu resolves the thread with that comment", async () => {
    await page.eval(
      `document.querySelector('.comment-reply').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`,
    );
    await page.click("text=Resolve thread with comment");
    await page.waitFor(
      `document.querySelector('[aria-label="Expand thread"]')?.textContent.includes('2 resolved comments')`,
    );
  });
});

test("mirrored comment edits and thread state survive a fresh Jira detail response", async ({
  open,
}) => {
  await fixture.reset({ includeMedia: true, mediaInComment: true });
  const page = await open("?issue=TEST-2&view=page");
  await test.step("a local edit and unsubscribe of a Jira comment outlive a forced detail refetch and a reload", async () => {
    await page.waitFor(`!!document.querySelector('[data-comment="jira-media-comment"]')`);
    await page.hover('[data-comment="jira-media-comment"]');
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit comment'`);
    await page.key("a", "meta");
    await page.type("Edited mirror comment locally");
    await page.click("text=Save comment");
    await page.waitFor(
      `document.querySelector('[data-thread]').textContent.includes('Edited mirror comment locally')`,
    );
    await page.click('[aria-label="Comment options"]');
    await page.click("text=Unsubscribe from thread");
    await page.eval(`loadFull('TEST-2',true)`);
    expect(await page.eval(`document.querySelector('[data-thread]').textContent`)).toContain(
      "Edited mirror comment locally",
    );
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-thread]')?.textContent.includes('Edited mirror comment locally')`,
    );
    await page.hover("[data-comment]");
    await page.click('[aria-label="Comment options"]');
    await page.waitFor(
      `!![...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent==='Subscribe to thread')`,
    );
  });
});
