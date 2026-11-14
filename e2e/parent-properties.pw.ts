import { expect, test, sleep, shownIssue } from "./app";
// RAJ-52 ▸ RAJ-53 (done) ▸ RAJ-54/55 in Linear; here TEST-2 ▸ TEST-3 (done) ▸ TEST-4/5, plus TEST-6 as a second sibling. TEST-2 and TEST-3 get a one-paragraph description like RAJ-53.
const tree = `const read=fetch;const para={type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'Disposable sub-issue for the parity audit.'}]}]};window.fetch=async(...args)=>{const response=await read(...args),path=new URL(String(args[0]),location.href).pathname;
 if(path==='/api/issues/TEST-2'||path==='/api/issues/TEST-3'){const full=await response.json();full.fields.description=para;return Response.json(full)}
 if(path!=='/api/issues')return response;const issues=await response.json();Object.assign(issues.find(i=>i.key==='TEST-3'),{parent:'TEST-2',status:'done',resolved:new Date().toISOString()});for(const key of ['TEST-4','TEST-5'])issues.find(i=>i.key===key).parent='TEST-3';issues.find(i=>i.key==='TEST-6').parent='TEST-2';return Response.json(issues)}`;
const box = (selector: string) =>
  `(()=>{const b=document.querySelector('${selector}').getBoundingClientRect();return [Math.round(b.x*10)/10,Math.round(b.y*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]})()`;

test('a sub-issue\'s parent: the "Sub-issue of" line, its sub-issue list, and removing the parent', async ({
  open,
}) => {
  const page = await open("?issue=TEST-3&view=page", { width: 1272, height: 846, setup: tree });
  await test.step("a sub-issue shows Linear's \"Sub-issue of\" line, whose pill lists the parent's sub-issues (⌘⇧→) and whose link opens the parent", async () => {
    await page.waitFor(
      `!!document.querySelector('[data-parent-link]')&&!!document.querySelector('#description p')`,
    );
    // RAJ-53 at 1272×846: title 112.5, the line 8px under it (26px tall, link from x 373, status icon at 378), the paragraph now 226.5: bundle If/Lf.container has 24px bottom margin (was 10px).
    expect(
      await page.eval(
        `[document.getElementById('summary').getBoundingClientRect().y,document.querySelector('#description p').getBoundingClientRect().y]`,
      ),
    ).toEqual([112.5, 226.5]);
    const [link, icon] = await page.eval<number[][]>(
      `[${box("[data-parent-link]")},${box("[data-parent-link] svg")}]`,
    );
    expect([link![0], link![1], link![3], icon![0]]).toEqual([373, 152.5, 26, 378]);
    expect(
      await page.eval(
        `[...document.querySelector('[data-parent-link]').parentElement.children].map(n=>n.textContent)`,
      ),
    ).toEqual(["Sub-issue of", "TEST-2Browser fixture 2", "1/4"]);
    expect(
      await page.eval(
        `document.querySelector('.issue-detail-header').textContent.includes('parent')`,
      ),
    ).toBe(false);
    expect(await page.eval(`document.querySelector('[data-parent-progress]').title`)).toMatch(
      /^Open sub-issues of TEST-2 \(.*→\)$/,
    );
    // Click: a Navigation list of the parent's sub-issues, the open one checked, 5px under the pill and 349 wide.
    await page.click("[data-parent-progress]");
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Open sub-issues of TEST-2"]')`,
    );
    const [pill, menu] = await page.eval<[number[], number[]]>(
      `[${box("[data-parent-progress]")},${box("[role=dialog]")}]`,
    );
    expect([menu[0], menu[1]! - pill[1]! - pill[3]!, menu[2], menu[3]]).toEqual([
      pill[0],
      5,
      349,
      102,
    ]);
    expect(
      await page.eval(
        `(()=>{const d=document.querySelector('[role=dialog]');return d.scrollHeight-d.clientHeight})()`,
      ),
    ).toBe(0);
    expect(Math.round((pill[0]! - link![0]! - link![2]!) * 10) / 10).toBe(4); // Linear: 70 tall for one row (30 heading, 32 rows, 6 under, 2 border).
    expect(
      await page.eval(
        `[document.querySelector('[cmdk-group-heading]').textContent,[...document.querySelectorAll('[role=dialog] [cmdk-item]')].map(i=>[i.querySelector('.menu-name').textContent,!!i.querySelector('.menu-checkmark')])]`,
      ),
    ).toEqual([
      "Navigation",
      [
        ["TEST-3Browser fixture 3", true],
        ["TEST-6Browser fixture 6", false],
      ],
    ]);
    // Typing filters it and Enter opens the match; Escape closes without moving.
    await page.type("fixture 6");
    await page.waitFor(`document.querySelectorAll('[role=dialog] [cmdk-item]').length===1`);
    await page.key("Enter");
    await page.waitFor(
      `${shownIssue}==='TEST-6'&&document.querySelector('[data-parent-link]')?.textContent.includes('TEST-2')`,
    );
    await page.eval(`document.activeElement.blur()`);
    await page.key("ArrowRight", "meta", "shift");
    await page.waitFor(
      `!!document.querySelector('[role=dialog][aria-label="Open sub-issues of TEST-2"]')`,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    expect(await page.eval(`${shownIssue}`)).toBe("TEST-6");
    // The link opens the parent in place; ⌘⇧↑ does the same from the keyboard.
    await page.click("[data-parent-link]");
    await page.waitFor(`${shownIssue}==='TEST-2'`);
    expect(await page.eval(`!!document.querySelector('[data-parent-link]')`)).toBe(false);
    await page.eval(`history.back()`);
    await page.waitFor(
      `${shownIssue}==='TEST-6'&&!!document.querySelector('[data-parent-link]')`,
    );
    await page.eval(`document.activeElement.blur()`);
    await page.key("ArrowUp", "meta", "shift");
    await page.waitFor(`${shownIssue}==='TEST-2'`);
  });
  await test.step("Issue options › Remove › Parent issue detaches the sub-issue, and the line stays gone after a reload", async () => {
    await page.goto("?issue=TEST-6&view=page");
    await page.waitFor(`!!document.querySelector('[data-parent-link]')`);
    await page.click("#issue-options");
    await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="Remove"]')`);
    // Linear's Remove glyph: a flag with an ×.
    expect(
      await page.eval(
        `document.querySelector('[cmdk-item][data-value="Remove"] svg path').getAttribute('d').endsWith('M13.5 11.5l-3 3')`,
      ),
    ).toBe(true);
    await page.click('[cmdk-item][data-value="Remove"]');
    await page.waitFor(
      `[...document.querySelectorAll('[cmdk-item]')].some(i=>i.textContent==='Parent issue TEST-2 Browser fixture 2')`,
    );
    await page.eval(
      `[...document.querySelectorAll('[cmdk-item]')].find(i=>i.textContent==='Parent issue TEST-2 Browser fixture 2').click()`,
    );
    await page.waitFor(`!document.querySelector('[data-parent-link]')`);
    // Reload only once it is saved (mid-save the page's beforeunload guard holds the reload).
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`,
      10000,
    );
    await page.reload();
    await page.waitFor(`!!document.getElementById('comment')`);
    await sleep(300);
    expect(await page.eval(`!!document.querySelector('[data-parent-link]')`)).toBe(false);
  });
});

test("RAJ-52/53: a sub-issue's page lays out properties, reactions, sub-issues, activity and property menus like Linear", async ({
  open,
}) => {
  const page = await open("?issue=TEST-3&view=page", { width: 1272, height: 846, setup: tree });
  await test.step("properties are Linear's 28px pills under 13px headings, with its tooltip under the hovered pill", async () => {
    await page.waitFor(`!!document.querySelector('[data-properties] button')`);
    // RAJ-53: headings at 127.8 / 278.8 / 365.8 with text from x 910.1; pills from x 903.1, 28 tall, every 32px, text at x 931.1.
    // Our issue type pill (not in Linear) adds one 32px row to Properties, so later headings sit 32px lower.
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-properties] h3')].map(h=>{const b=h.getBoundingClientRect();return [h.textContent,Math.round(b.y*10)/10,Math.round(b.x*10)/10+8,getComputedStyle(h).fontSize]})`,
      ),
    ).toEqual([
      ["Properties", 127.8, 910.1, "13px"],
      ["Labels", 310.8, 910.1, "13px"],
      ["Epic", 397.8, 910.1, "13px"],
    ]);
    const pills = await page.eval<number[][]>(
      `[...document.querySelectorAll('[data-properties] button[id^="prop-"]:not([aria-label="Add label"])')].map(b=>{const r=b.getBoundingClientRect(),t=document.createRange();t.setStartAfter(b.firstChild);t.setEnd(b,b.childNodes.length);return [Math.round(r.x*10)/10,Math.round(r.y),r.height,Math.round(t.getBoundingClientRect().x*10)/10,parseFloat(getComputedStyle(b).borderRadius)>=14?1:0]})`,
    );
    expect(pills.map((p) => p[0])).toEqual([903.1, 903.1, 903.1, 903.1, 903.1]);
    expect(pills.map((p) => p[1])).toEqual([154, 186, 218, 250, 424]);
    expect(pills.map((p) => p.slice(2))).toEqual(Array.from({ length: 5 }, () => [28, 931.1, 1]));
    // Hover: after a beat, "Change status S" in a menu-surface tooltip centred 8px under the pill; the native title is parked so it does not double up.
    await page.hover("#prop-status");
    await page.waitFor(`!!document.querySelector('[role=tooltip].app-tooltip')`, 2000);
    const tip = await page.eval<[string, string, number, number, boolean, string, string]>(
      `(()=>{const t=document.querySelector('.app-tooltip'),r=t.getBoundingClientRect(),b=document.getElementById('prop-status').getBoundingClientRect(),cs=getComputedStyle(t);return [t.firstChild.textContent,[...t.querySelectorAll('kbd')].map(k=>k.textContent).join(' '),Math.round(r.y-b.bottom),Math.round(Math.abs(r.x+r.width/2-(b.x+b.width/2))),document.getElementById('prop-status').hasAttribute('title'),cs.backgroundColor,cs.fontSize]})()`,
    );
    expect(tip).toEqual(["Change status", "S", 8, 0, false, "lch(12.72 0.85 272)", "12px"]);
    await page.hover("[data-parent-link]");
    await page.waitFor(`!document.querySelector('.app-tooltip')`);
    expect(await page.eval(`document.getElementById('prop-status').title`)).toBe(
      "Change status (S)",
    );
    // At the window's edge it stays 8px inside, and a multi-key hint gets one key cap per key.
    await page.hover('[title="Copy git branch name (⇧ ⌘ .)"]');
    await page.waitFor(`!!document.querySelector('.app-tooltip')`, 2000);
    expect(
      await page.eval(
        `(()=>{const t=document.querySelector('.app-tooltip');return [innerWidth-Math.round(t.getBoundingClientRect().right),[...t.querySelectorAll('kbd')].map(k=>k.textContent)]})()`,
      ),
    ).toEqual([8, ["⇧", "⌘", "."]]);
    // An icon button keeps its own accessible name while its title is parked, and gets its own markup back after.
    await page.hover('[title="Close (Esc)"]');
    await page.waitFor(`!!document.querySelector('.app-tooltip')`, 2000);
    expect(
      await page.eval(
        `(()=>{const b=document.querySelector('[data-title="Close (Esc)"]');return [b.getAttribute('aria-label'),b.hasAttribute('title')]})()`,
      ),
    ).toEqual(["Close", false]);
    await page.hover("#prop-status");
    expect(
      await page.eval(
        `(()=>{const b=document.querySelector('[title="Close (Esc)"]');return [b.getAttribute('aria-label'),b.hasAttribute('data-tip-label')]})()`,
      ),
    ).toEqual(["Close", false]);
    // Project has no tooltip in Linear.
    expect(await page.eval(`document.getElementById('prop-project').hasAttribute('title')`)).toBe(
      false,
    );
    // Linear: arrow cursor on every control, text cursor in the title and description; a keyboard-focused control gets a 1px accent ring (links 1px off).
    expect(
      await page.eval(
        `[[...new Set([...document.querySelectorAll('main button,main a[href],[data-properties] button')].map(n=>getComputedStyle(n).cursor))],getComputedStyle(document.getElementById('summary')).cursor,getComputedStyle(document.querySelector('#description [contenteditable]')??document.getElementById('description')).cursor]`,
      ),
    ).toEqual([["default"], "text", "text"]);
    await page.key("Shift");
    await page.eval(`document.getElementById('prop-status').focus()`);
    const ring = (selector: string) =>
      page.eval(
        `(()=>{const c=getComputedStyle(document.querySelector('${selector}'));return [c.outlineStyle,c.outlineWidth,c.outlineColor,c.outlineOffset]})()`,
      );
    expect(await ring("#prop-status")).toEqual([
      "solid",
      "1px",
      "lch(47.918 59.303 288.421)",
      "0px",
    ]);
    await page.eval(`document.querySelector('[data-parent-link]').focus()`);
    expect(await ring("[data-parent-link]")).toEqual([
      "solid",
      "1px",
      "lch(47.918 59.303 288.421)",
      "1px",
    ]);
    await page.eval("document.activeElement?.blur()");
  });
  await test.step("RAJ-52: reactions: the row under the description, a right-aligned 274×322 picker with arrow keys, and 28px pills with a tooltip", async () => {
    await page.waitFor(
      `!!document.querySelector('[data-sub-issue]')&&!!document.getElementById('comment')&&!!document.querySelector('#description p')`,
    );
    const r = `const r=n=>{const b=n.getBoundingClientRect();return [Math.round(b.x*10)/10,Math.round(b.y*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]};`;
    // The row starts 6px left of the text, 26px under the last paragraph and 16px above the sub-issues header; add and attach are 28px round lch(90.451) buttons with 14px icons.
    expect(
      await page.eval(
        `(()=>{${r}const p=r([...document.querySelectorAll('#description p')].at(-1)),add=document.querySelector('[aria-label="Add reaction"]'),a=r(add),h=r(document.querySelector('[data-sub-issues] button')),c=getComputedStyle(add);return [a[0]-p[0],a[1]-p[1]-p[3],h[1]-a[1]-a[3],a.slice(2),c.borderRadius,c.color,r(add.querySelector('svg')).slice(2),r(add.nextElementSibling)]})()`,
      ),
    ).toEqual([
      -6,
      26,
      16,
      [28, 28],
      "9999px",
      "lch(90.451 1.2 272)",
      [14, 14],
      [314.2, 276.5, 28, 28],
    ]);
    await page.click('[aria-label="Add reaction"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Search emoji'`);
    // Linear's picker: 274×322, right edge on the button's, 3.6px under it; a 37px header ruled lch(17.04), a 262×28 input, 28px headings and nine 28px cells a row.
    expect(
      await page.eval(
        `(()=>{${r}const d=document.querySelector('[role=dialog][aria-label="Choose reaction"]'),b=r(d),a=r(document.querySelector('[aria-label="Add reaction"]')),i=d.querySelector('input'),cells=[...d.querySelectorAll('button[aria-label^="React "]')];return [b.slice(2),Math.round((b[0]+b[2]-a[0]-a[2])*10)/10,Math.round((b[1]-a[1]-a[3])*10)/10,r(i.parentElement)[3],getComputedStyle(i.parentElement).borderBottom,r(i).slice(2),getComputedStyle(i).borderRadius,i.placeholder,[...d.querySelectorAll('.text-\\\\[12px\\\\]')].slice(0,2).map(n=>[n.textContent,r(n)[3]]),cells.slice(0,18).map(c=>c.textContent).join(''),r(cells[0]).slice(2),r(cells[1])[0]-r(cells[0])[0],r(cells[9])[0]-r(cells[0])[0],r(cells[9])[1]-r(cells[0])[1],cells[0].getAttribute('aria-label')]})()`,
      ),
    ).toEqual([
      [274, 322],
      0,
      3.6,
      37,
      "1px solid lch(17.04 1.93 272)",
      [262, 28],
      "8px",
      "Search emoji…",
      [
        ["Frequently used", 28],
        ["Smileys & People", 28],
      ],
      "👍👌🙏😂❤️👀✅🙂😃😄😀🤔😅⚠️😕❌🙌💙",
      [28, 28],
      28,
      0,
      28,
      "React 👍 +1",
    ]);
    // Arrows move a highlight tinted with the emoji's own colour; focus stays in the search; Enter picks it.
    await page.key("ArrowDown");
    await page.key("ArrowRight");
    await page.key("ArrowDown");
    expect(
      await page.eval(
        `[[...document.querySelectorAll('[data-active]')].map(n=>[n.textContent,/^rgba\\(\\d+, \\d+, \\d+, 0\\.17\\d\\)$/.test(getComputedStyle(n).backgroundColor)&&new Set(getComputedStyle(n).backgroundColor.match(/\\d+/g).slice(0,3)).size>1]),document.activeElement.getAttribute('aria-label')]`,
      ),
    ).toEqual([[["😀", true]], "Search emoji"]);
    // Enter picks the highlighted cell (👌 after Up); the pick then leads "Frequently used".
    await page.key("ArrowUp");
    await page.key("Enter");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Remove 👌 reaction"]')&&!document.querySelector('[aria-label="Choose reaction"]')`,
    );
    await page.click('[aria-label="Remove 👌 reaction"]');
    await page.waitFor(`!document.querySelector('[aria-label="Remove 👌 reaction"]')`);
    await page.click('[aria-label="Add reaction"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Search emoji'`);
    expect(
      await page.eval(
        `[...document.querySelectorAll('[aria-label="Choose reaction"] button[aria-label^="React "]')].slice(0,3).map(c=>c.textContent).join('')`,
      ),
    ).toBe("👌👍🙏");
    await page.key("ArrowRight");
    await page.key("ArrowRight");
    await page.key("Enter");
    await page.waitFor(
      `!!document.querySelector('[aria-label="Remove 👍 reaction"]')&&!document.querySelector('[aria-label="Choose reaction"]')`,
    );
    // The pill: 42×28, Linear's violet fill and line, a 14px emoji 9px in, the count 23px in, then the add button 8px after it.
    const pill = `document.querySelector('[aria-label="Remove 👍 reaction"]')`;
    await page.hover("#description p");
    expect(
      await page.eval(
        `(()=>{${r}const p=${pill},b=r(p),c=getComputedStyle(p),e=r(p.children[0]),n=r(p.children[1]);return [b.slice(2),c.borderRadius,c.backgroundColor,c.borderTopColor,e[0]-b[0],e[2],n[0]-b[0],getComputedStyle(p.children[1]).color,getComputedStyle(p.children[1]).fontSize,r(document.querySelector('[aria-label="Add reaction"]'))[0]-b[0]-b[2]]})()`,
      ),
    ).toEqual([
      [42, 28],
      "9999px",
      "lch(14.391 19.592 286.445)",
      "lch(19.701 19.952 286.445)",
      9,
      14,
      23,
      "lch(100 0 272)",
      "12px",
      8,
    ]);
    // Hover darkens it and Linear's tooltip names the reaction, centred 8px under the pill.
    await page.hover('[aria-label="Remove 👍 reaction"]');
    await page.waitFor(`getComputedStyle(${pill}).backgroundColor==='lch(12.141 17.792 286.445)'`);
    await page.waitFor(`!!document.querySelector('[role=tooltip]')`);
    expect(
      await page.eval(
        `(()=>{const t=document.querySelector('[role=tooltip]').getBoundingClientRect(),p=${pill}.getBoundingClientRect();return [document.querySelector('[role=tooltip]').textContent,Math.round(t.top-p.bottom),Math.round(t.left+t.width/2-p.left-p.width/2)+0]})()`,
      ),
    ).toEqual(["You reacted with :+1:", 8, 0]);
    // It survives a reload and a click removes it.
    await page.goto("?issue=TEST-3&view=page");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove 👍 reaction"]')`);
    await page.click('[aria-label="Remove 👍 reaction"]');
    await page.waitFor(`!document.querySelector('[aria-label="Remove 👍 reaction"]')`);
  });
  await test.step("RAJ-52/53: sub-issues, activity rows and the composer sit where Linear puts them", async () => {
    await page.waitFor(
      `!!document.querySelector('[data-sub-issue]')&&!!document.getElementById('comment')&&!!document.querySelector('#description p')`,
    );
    await page.clickAt(5, 600);
    const r = `const r=n=>{const b=n.getBoundingClientRect();return [Math.round(b.x*10)/10,Math.round(b.y*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]};`;
    // Bundle If/Lf.container adds 14px below the parent line; Nk also proves the section ring is 16px.
    // RAJ-53 at 1272×846: a 24px header pill 6px left of the content, caret and label 7/24px in, progress 8px after it, circles 6px apart 8px from the right.
    expect(
      await page.eval(
        `(()=>{${r}const h=document.querySelector('[data-sub-issues]').firstElementChild,b=h.querySelector('button');return [r(b),r(b.querySelector('svg'))[0],r(b.querySelector('span:nth-child(2)'))[0],r(h.querySelector('[data-sub-progress] svg')).slice(0,3),[...h.querySelectorAll('button')].slice(-2).map(c=>r(c.querySelector('svg')).slice(0,2))]})()`,
      ),
    ).toEqual([
      [286.2, 320.5, 101.6, 24],
      293.2,
      310.2,
      [395.8, 324.5, 16],
      [
        [801.9, 325.5],
        [835.9, 325.5],
      ],
    ]);
    // Rows: 36px, 6px outset, status icon 39px in, title 23px after it, an 18px avatar 12px from the right.
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-sub-issue]')].map(row=>{${r}return [r(row),r(row.querySelector('button svg'))[0],r(row.querySelector('a span'))[0],r(row.lastElementChild.querySelector('span')).slice(0,1).concat(r(row.lastElementChild.querySelector('span'))[2])]})`,
      ),
    ).toEqual([
      [[286.2, 354.5, 578.7, 36], 325.2, 348.2, [834.9, 18]],
      [[286.2, 390.5, 578.7, 36], 325.2, 348.2, [834.9, 18]],
    ]);
    // Activity: the rule 16px under the list, the heading 22.5px under it, event rows 24.8px tall with a 14px avatar 11px in and the name 36px in, the 84px composer 14px below.
    expect(
      await page.eval(
        `(()=>{${r}const s=document.querySelector('.issue-activity'),c=document.getElementById('issue-created'),ed=document.getElementById('comment').closest('.rich-editor');return [r(s)[1],r(s.querySelector('h3'))[1],r(c),r(c.firstElementChild),r(c.querySelector('.font-medium'))[0],r(ed),r(ed.querySelector('.rich-placeholder')).slice(0,2),getComputedStyle(ed.querySelector('.rich-placeholder')).fontSize,[...ed.querySelectorAll('.rich-editor-actions > button, .rich-editor-actions > .ui-tooltip-trigger > button')].map(b=>r(b))]})()`,
      ),
    ).toEqual([
      442.5,
      466,
      [292.2, 507.5, 572.7, 24.8],
      [303.2, 512.9, 14, 14],
      328.2,
      [284.2, 546.3, 588.7, 84],
      [301.2, 559.3],
      "15px",
      [
        [793.9, 591.3, 24, 24],
        [829.9, 591.3, 24, 24],
      ],
    ]);
    // A property change adds an event row 28.8px under the previous one.
    await page.key("p");
    await page.waitFor(`!!document.querySelector('[role=dialog] [cmdk-item]')`);
    await page.type("Low");
    await page.key("Enter");
    await page.waitFor(`document.querySelectorAll('.activity-event').length===2`);
    expect(
      await page.eval(
        `[...document.querySelectorAll('.activity-event')].map(n=>Math.round(n.getBoundingClientRect().y*10)/10)`,
      ),
    ).toEqual([507.5, 536.3]);
  });
  await test.step("RAJ-52: property menus, label chips and the label menu follow Linear, and their edits read as Linear's Activity rows", async () => {
    await page.waitFor(
      `!!document.getElementById('comment')&&!!document.querySelector('[data-label-chip]')`,
    );
    await page.clickAt(5, 600);
    const R = `const r=e=>{const b=e.getBoundingClientRect();return [Math.round(b.x*10)/10,Math.round(b.y*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]};`;
    const menu = `(()=>{${R}const d=document.querySelector('[role=dialog]'),box=d.getBoundingClientRect(),rel=e=>{const b=e.getBoundingClientRect();return [Math.round((b.x-box.x)*10)/10,Math.round((b.y-box.y)*10)/10,Math.round(b.width*10)/10,Math.round(b.height*10)/10]};return {box:r(d),input:rel(d.querySelector('input')),key:d.querySelector('.menu-input kbd')?.textContent,rows:[...d.querySelectorAll('[cmdk-item]')].map(o=>[o.textContent,rel(o)[0],rel(o)[2],rel(o)[3],rel(o.querySelector('.menu-icon'))[0],rel(o.querySelector('.menu-name'))[0],o.querySelector('.menu-hint')?Math.round(rel(o.querySelector('.menu-hint'))[0]+rel(o.querySelector('.menu-hint'))[2]):null,o.dataset.selected]),items:[...d.querySelectorAll('[cmdk-item],[cmdk-separator],[cmdk-group-heading]')].map(n=>n.hasAttribute('cmdk-item')?n.textContent:n.hasAttribute('cmdk-separator')?'—':'#'+n.textContent)}})()`;
    // Status: 208px under the pill, a 36px filter with S at its right, full-width 32px rows (Linear's IB item: the highlight is inset, not the row), icon at 15, text at 39, numbers ending 19px in, the current status active.
    const pill = await page.eval<number[]>(
      `(()=>{${R}return r(document.getElementById('prop-status'))})()`,
    );
    await page.key("s");
    await page.waitFor(`!!document.querySelector('[role=dialog] .menu')`);
    const s = await page.eval<any>(menu);
    expect([
      s.box[0] - pill[0]!,
      Math.round((s.box[1] - pill[1]! - pill[3]!) * 10) / 10,
      s.box[2],
      s.input,
      s.key,
    ]).toEqual([0, 4.5, 208, [15, 1, 148, 36], "S"]);
    // The line under the filter is every menu input's: Linear's Qw.inputRowBorderBottom, bgBorderFaintThin.
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('[role=dialog] .menu-input')).borderBottomColor`,
      ),
    ).toBe("lch(20.28 1.93 272)");
    expect(s.rows.map((r: any[]) => r.slice(1, 7))).toEqual(
      s.rows.map(() => [1, 206, 32, 15, 39, 189]),
    );
    expect(s.rows.map((r: any[]) => r[0].replace(/\D/g, ""))).toEqual(
      s.rows.map((_: unknown, i: number) => String(i + 1)),
    );
    expect(s.rows.map((r: any[]) => r[7])).toEqual(
      s.rows.map((r: any[]) => (r[0].startsWith("Done") ? "true" : "false")),
    );
    // Only the current status carries Linear's 16px check, before its number: 149.5px into the row's highlight (6px inside the row).
    expect(
      await page.eval(
        `[...document.querySelectorAll('[role=dialog] [cmdk-item]')].filter(o=>o.querySelector('.menu-checkmark')).map(o=>{const b=o.getBoundingClientRect(),c=o.querySelector('.menu-checkmark svg').getBoundingClientRect();return [o.textContent.replace(/[0-9]/g,''),Math.abs(c.x-b.x-6-149.5)<0.5,c.width]})`,
      ),
    ).toEqual([["Done", true, 16]]);
    await page.key("Escape");
    // A number picks its row, as in Linear.
    await page.clickAt(5, 600);
    await page.key("p");
    await page.waitFor(`!!document.querySelector('[role=dialog] .menu')`);
    expect((await page.eval<any>(menu)).key).toBe("P");
    await page.key("1");
    await page.waitFor(
      `!document.querySelector('[role=dialog]')&&document.getElementById('prop-priority').textContent==='Urgent'`,
    );
    // Chips (LabelChip, Linear's ISn): 25px, radius 30, 1.5px in from the heading, 9px dot 9px in, name 24px in (live Linear); the round + 6px after the last chip.
    const chips = await page.eval<any>(
      `(()=>{${R}const h=[...document.querySelectorAll('[data-properties] h3')].find(h=>h.textContent==='Labels').getBoundingClientRect(),c=document.querySelector('[data-label-chip]'),b=c.getBoundingClientRect(),dot=c.children[0].getBoundingClientRect(),name=c.children[1].getBoundingClientRect(),add=document.getElementById('prop-labels').getBoundingClientRect();return [Math.round((b.x-h.x)*10)/10,b.height,dot.x-b.x,dot.y-b.y,dot.width,name.x-b.x,add.x-b.right,add.width,add.height,getComputedStyle(c).borderRadius,c.textContent]})()`,
    );
    expect(chips).toEqual([1.5, 25, 9, 8, 9, 24, 6, 25, 25, "30px", "test"]);
    // Hovering a chip lifts it to Linear's lch(16.706).
    await page.hover("[data-label-chip]");
    await page.waitFor(
      `getComputedStyle(document.querySelector('[data-label-chip]')).backgroundColor==='lch(16.706 0.979 272)'`,
    );
    await page.clickAt(5, 600);
    // L opens the menu beside the + (right edge 4.5px before it, top 5.5px above it); the issue's labels come first, then a divider and the rest.
    const add = await page.eval<number[]>(
      `(()=>{${R}return r(document.getElementById('prop-labels'))})()`,
    );
    await page.clickAt(5, 600);
    await page.key("l");
    await page.waitFor(`!!document.querySelector('[role=dialog] .menu')`);
    let l = await page.eval<any>(menu);
    expect([
      Math.round((add[0]! - l.box[0] - l.box[2]) * 10) / 10,
      Math.round((add[1]! - l.box[1]) * 10) / 10,
      l.key,
      l.items,
    ]).toEqual([4.5, 5.5, "L", ["test", "—", "#Workspace labels", "ui"]]);
    expect(await page.eval(`document.querySelector('[role=dialog] input').placeholder`)).toBe(
      "Change or add labels…",
    );
    expect(
      await page.eval(
        `(()=>{const o=document.querySelector('[data-label]'),b=o.getBoundingClientRect();return ['.menu-checkbox','.menu-icon','.menu-name'].map(c=>o.querySelector(c).getBoundingClientRect().x-b.x)})()`,
      ),
    ).toEqual([14, 35, 59]); // B4e: 13px in when multi-select, the 14px box centred in 16, the label 6px after it
    // Space toggles the active label and keeps the menu open; so does a checkbox click; neither reorders.
    await page.key(" ");
    await page.waitFor(`!document.querySelector('[data-label-chip]')`);
    await page.click('[aria-label="Add label ui"]');
    await page.waitFor(
      `[...document.querySelectorAll('[data-label-chip]')].map(c=>c.textContent).join()==='ui'`,
    );
    expect((await page.eval<any>(menu)).items).toEqual(["test", "—", "#Workspace labels", "ui"]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    // Clicking a chip opens the menu 4.5px left of the chip; a row click (or Enter) toggles it and closes.
    const chip = await page.eval<number[]>(
      `(()=>{${R}return r(document.querySelector('[data-label-chip]'))})()`,
    );
    await page.click("[data-label-chip]");
    await page.waitFor(`!!document.querySelector('[role=dialog] .menu')`);
    l = await page.eval<any>(menu);
    expect(Math.round((chip[0]! - l.box[0] - l.box[2]) * 10) / 10).toBe(4.5);
    await page.click('[role=dialog] [cmdk-item][data-value="ui"]');
    await page.waitFor(
      `!document.querySelector('[role=dialog]')&&!document.querySelector('[data-label-chip]')`,
    );
    expect(
      await page.eval(
        `(()=>{const b=document.getElementById('prop-labels');return [b.textContent,getComputedStyle(b.querySelector('.property-wide')).display!=='none']})()`,
      ),
    ).toEqual(["Add labelLabels", true]);
    // With no labels on the issue, Linear opens on "Frequently used": the board's three most used, most used first. The fixture has only
    // three labels, so no "Workspace labels" section follows (labelSections' unit test covers that one).
    await page.clickAt(5, 600);
    await page.key("l");
    await page.waitFor(`!!document.querySelector('[role=dialog] .menu')`);
    const fresh = (await page.eval<any>(menu)).items as string[];
    expect([fresh[0], fresh[1], fresh.includes("—")]).toEqual(["#Frequently used", "test", false]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    // Activity: the priority and label changes share one row with the actor's avatar, the label after its 4px dot.
    const row = `document.querySelector('[data-activity="multi"]')`;
    await page.waitFor(`!!${row}`);
    expect(
      await page.eval(
        `${row}.textContent.slice(${row}.firstElementChild.textContent.length).replace(/\\s+/g,' ').trim()`,
      ),
    ).toMatch(/^Audit user raised priority from High to Urgent and removed label test · just now$/);
    expect(
      await page.eval(
        `(()=>{const d=${row}.querySelector('[style*="background"]');return [d.getBoundingClientRect().width,d.getBoundingClientRect().height,${row}.firstElementChild.querySelector('svg')?'icon':'avatar']})()`,
      ),
    ).toEqual([4, 4, "avatar"]);
    // Undoing the three label edits leaves a lone priority row, drawn with the new priority's icon.
    await page.eval("document.activeElement?.blur()");
    for (let i = 0; i < 3; i++) await page.key("z", "meta");
    await page.waitFor(
      `!document.querySelector('[data-activity="multi"]')&&!!document.querySelector('[data-activity="priority"]')&&!!document.querySelector('[data-label-chip]')`,
    );
    expect(
      await page.eval(
        `!!document.querySelector('[data-activity="priority"]').firstElementChild.querySelector('svg')`,
      ),
    ).toBe(true);
  });
  await test.step("RAJ-52/53: nested rows on the parent: +24px per level, with the elbow 45.5px in and 10px down", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-sub-issue="TEST-4"] [data-elbow]')`);
    expect(
      await page.eval(
        `(()=>{const row=document.querySelector('[data-sub-issue="TEST-4"]'),b=row.getBoundingClientRect(),e=row.querySelector('[data-elbow]').getBoundingClientRect();return [Math.round(e.x*10)/10,Math.round(e.y-b.y),Math.round(row.querySelector('button svg').getBoundingClientRect().x*10)/10,Math.round(row.querySelector('a span').getBoundingClientRect().x*10)/10]})()`,
      ),
    ).toEqual([331.7, 10, 349.2, 372.2]);
  });
});

test("RAJ-52: relations: Mark as menus, sidebar pills, Activity rows and Issue options › Remove follow Linear", async ({
  open,
}) => {
  const page = await open("?issue=TEST-3&view=page", { width: 1272, height: 846 });
  await test.step("RAJ-52: relations: sidebar sections after Project, 28px pills with a hover remove button, an Activity row each, and Issue options › Remove", async () => {
    await page.waitFor(`!!document.getElementById('comment')`);
    const mark = async (query: string, item: string, key: string) => {
      await page.click("#issue-options");
      await page.type(query);
      await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="${item}"]')`);
      await page.key("Enter");
      await page.waitFor(
        `document.activeElement?.getAttribute('aria-label')==='Find related issue'`,
      );
      await page.type(key);
      await page.waitFor(`!!document.querySelector('[cmdk-item][data-value="${key}"]')`);
      await page.key("Enter");
    };
    await mark("related to", "Mark as › Related to…", "TEST-1");
    await page.waitFor(`!!document.querySelector('[data-relation="related:TEST-1"]')`);
    await mark("blocked by", "Mark as › Blocked by…", "TEST-2");
    await page.waitFor(`!!document.querySelector('[data-relation="blocked:TEST-2"]')`);
    // Like Linear (startup-root mI's disableWithReason, R3-relations-D6), a search lists an issue that is already related
    // disabled, with its reason, so it cannot be marked twice.
    await page.click("#issue-options");
    await page.type("related to");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Mark as › Related to…"]')`,
    );
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Find related issue'`);
    await page.type("TEST-1");
    const linked = `document.querySelector('[role=dialog][aria-label="Issue relations"] [cmdk-item][data-value="TEST-1"]')`;
    await page.waitFor(`${linked}?.getAttribute('aria-disabled')==='true'`);
    expect(await page.eval(`${linked}.textContent.includes('Already referenced')`)).toBe(true);
    await page.key("Enter");
    await sleep(200);
    expect(await page.eval(`document.querySelectorAll('[data-relation="related:TEST-1"]').length`)).toBe(1);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    expect(
      await page.eval(
        `[document.querySelectorAll('[data-relation="related:TEST-1"]').length,document.querySelectorAll('[data-activity="relation"]').length]`,
      ),
    ).toEqual([1, 2]);
    // RAJ-52 at 1272×846: "Blocked by" then "Related" headings 87px apart from Project's, as Linear's x 902.1 / y 452.8 and 539.8 (+32px for our type pill).
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-properties] h3')].map(h=>[h.textContent,Math.round(h.getBoundingClientRect().x*10)/10,Math.round(h.getBoundingClientRect().y*10)/10]).slice(2)`,
      ),
    ).toEqual([
      ["Epic", 902.1, 397.8],
      ["Blocked by", 902.1, 484.8],
      ["Related", 902.1, 571.8],
    ]);
    // Pill 1px in, 25.7px under the heading (±0.5; our heading is 0.5px taller), status icon 7px and title 28px in, 13px/500 lch(90.451); the remove button 24px round, 8px after the pill, hidden until hover.
    const geometry = `(()=>{const row=document.querySelector('[data-relation="blocked:TEST-2"]'),h=[...document.querySelectorAll('[data-properties] h3')].find(h=>h.textContent==='Blocked by').getBoundingClientRect(),pill=row.querySelector('a'),p=pill.getBoundingClientRect(),btn=row.querySelector('button[aria-label="Remove relation"]'),b=btn.getBoundingClientRect(),c=getComputedStyle(pill);return [p.x-h.x,Math.abs(p.y-h.y-25.7)<=0.5,p.height,pill.querySelector('svg').getBoundingClientRect().x-p.x,pill.children[1].getBoundingClientRect().x-p.x,pill.children[1].textContent,c.fontSize,c.fontWeight,c.color,c.borderRadius,Math.round((b.x-p.right)*10)/10,b.y-p.y,b.width,b.height,getComputedStyle(btn).borderRadius,getComputedStyle(btn).opacity,c.backgroundColor]})()`;
    expect(await page.eval(geometry)).toEqual([
      1,
      true,
      28,
      7,
      28,
      "Browser fixture 2",
      "13px",
      "500",
      "lch(90.451 1.2 272)",
      "9999px",
      8,
      2,
      24,
      24,
      "9999px",
      "0",
      "rgba(0, 0, 0, 0)",
    ]);
    // Hover: the pill lifts to lch(14.006) and shows the remove button, which lifts too and brightens its icon.
    await page.hover('[data-relation="blocked:TEST-2"] a');
    await page.waitFor(
      `getComputedStyle(document.querySelector('[data-relation="blocked:TEST-2"] button')).opacity==='1'`,
    );
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('[data-relation="blocked:TEST-2"] a')).backgroundColor`,
      ),
    ).toBe("lch(14.006 0.593 272)");
    await page.hover('[data-relation="blocked:TEST-2"] button');
    expect(
      await page.eval(
        `(()=>{const c=getComputedStyle(document.querySelector('[data-relation="blocked:TEST-2"] button'));return [c.backgroundColor,c.color]})()`,
      ),
    ).toEqual(["lch(14.006 0.593 272)", "lch(100 0 272)"]);
    // Each relation is its own Activity row with Linear's wording and glyph: related in the dim text colour, blocked in lch(80% 80 29).
    const rows = `[...document.querySelectorAll('[data-activity="relation"]')].map(n=>[n.textContent.replace(/\\s+/g,' ').trim(),n.querySelector('[data-relation-icon]')?.dataset.relationIcon,getComputedStyle(n.querySelector('[data-relation-icon]')).fill])`;
    expect(await page.eval(rows)).toEqual([
      [
        "Audit user added related issue TEST-1 Rich browser fixture · just now",
        "related",
        await page.eval<string>(
          `getComputedStyle(document.querySelector('[data-activity="relation"]')).color`,
        ),
      ],
      [
        "Audit user marked this issue as blocked by TEST-2 Browser fixture 2 · just now",
        "blocked",
        "lch(80 80 29)",
      ],
    ]);
    // Issue options › Remove names each relation by the other issue's role, as Linear does.
    await page.click("#issue-options");
    await page.type("remove");
    await page.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Remove › Blocking issue TEST-2 Browser fixture 2"]')`,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.dataset.value).filter(v=>v.startsWith('Remove › '))`,
      ),
    ).toEqual([
      "Remove › Related issue TEST-1 Rich browser fixture",
      "Remove › Blocking issue TEST-2 Browser fixture 2",
    ]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role=dialog]')`);
    // Removing a relation added moments ago drops it, its section and its Activity row (Linear's round trip); the inverse goes from TEST-2 too.
    await page.hover('[data-relation="blocked:TEST-2"] a');
    await page.click('[data-relation="blocked:TEST-2"] button');
    await page.waitFor(
      `!document.querySelector('[data-relation="blocked:TEST-2"]')&&![...document.querySelectorAll('[data-properties] h3')].some(h=>h.textContent==='Blocked by')`,
    );
    expect(
      await page.eval(`[...document.querySelectorAll('[data-activity="relation"]')].length`),
    ).toBe(1);
    // A pill opens the related issue; there the inverse relation and its Activity row are listed, and both survive a reload.
    await page.click('[data-relation="related:TEST-1"] a');
    await page.waitFor(
      `${shownIssue}==='TEST-1'&&!!document.querySelector('[data-relation="related:TEST-3"]')`,
    );
    await page.goto("?issue=TEST-1&view=page");
    await page.waitFor(
      `!!document.querySelector('[data-relation="related:TEST-3"]')&&!document.querySelector('[data-relation^="blocking:"]')`,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-activity="relation"]')].map(n=>n.textContent.replace(/\\s+/g,' ').trim())`,
      ),
    ).toEqual(["Audit user added related issue TEST-3 Browser fixture 3 · just now"]);
  });
  await test.step("RAJ-52: Mark as opens Linear's command menu: centred at 110px, a placeholder, Create row and Enter hint per kind, and no type picker", async () => {
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.getElementById('comment')`);
    const D = `document.querySelector('[role=dialog][aria-label="Issue relations"]')`;
    const markAs = async (item: string) => {
      await page.click("#issue-options");
      await page.hover('[cmdk-item][data-value="Mark as"]');
      await page.click(`[cmdk-item][data-value="${item}"]`);
      await page.waitFor(
        `document.activeElement?.getAttribute('aria-label')==='Find related issue'`,
      );
    };
    const look = `(()=>{const d=${D};return [d.querySelector('input').placeholder,[...d.querySelectorAll('[cmdk-group-heading]')].map(h=>h.textContent),d.querySelector('[cmdk-item][data-value="create"]')?.textContent??null,d.querySelector('.mark-footer > span').textContent,!!d.querySelector('select')]})()`;
    await markAs("Related to…");
    // Relations now renders the shared Menu input, heading and row geometry.
    expect(
      await page.eval(
        `(()=>{const d=${D},r=d.getBoundingClientRect(),row=d.querySelector('[cmdk-item]'),f=d.querySelector('.mark-footer');return [[r.x,r.y,r.width],getComputedStyle(d.parentElement).backgroundColor,getComputedStyle(d).borderRadius,d.querySelector('input').getBoundingClientRect().height,d.querySelector('[cmdk-group-heading]').getBoundingClientRect().height,row.getBoundingClientRect().height,!!row.querySelector('.menu-icon'),row.classList.contains('menu-item'),f.getBoundingClientRect().height,getComputedStyle(f).borderTopColor]})()`,
      ),
    ).toEqual([
      [276, 110, 720],
      "rgba(0, 0, 0, 0)",
      "12px",
      36,
      30,
      32,
      true,
      true,
      35,
      "lch(21.36 1.93 272)",
    ]);
    expect(await page.eval(look)).toEqual([
      "Search for issue to reference…",
      ["Recent", "Create"],
      "Create new issue related to TEST-2…",
      "↵Mark as related",
      false,
    ]);
    // The highlight uses the shared 32px row; on the Create row the footer reads "Select".
    await page.key("ArrowDown");
    expect(
      await page.eval(
        `(()=>{const s=${D}.querySelector('[cmdk-item][data-selected=true]'),b=getComputedStyle(s,'::before');return [b.backgroundColor,b.height,b.borderRadius]})()`,
      ),
    ).toEqual(["lch(20.82 1.3 272)", "32px", "8px"]);
    await page.key("ArrowUp");
    await page.key("ArrowUp");
    await page.waitFor(`${D}.querySelector('.mark-footer > span').textContent==='↵Select'`);
    await page.type("TEST-1");
    await page.waitFor(
      `!${D}.querySelector('[cmdk-item][data-value="create"]')&&[...${D}.querySelectorAll('[cmdk-group-heading]')].map(h=>h.textContent).join()==='Issues'`,
    );
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[data-relation="related:TEST-1"]')`);
    // Blocked by offers the related issue first, and its Create row makes an issue blocking this one.
    await markAs("Blocked by…");
    expect(await page.eval(look)).toEqual([
      "Search for issue to mark blocked by…",
      ["Related issues", "Recent", "Create"],
      "Create new issue blocking TEST-2…",
      "↵Mark as blocked by",
      false,
    ]);
    expect(
      await page.eval(
        `${D}.querySelector('[cmdk-item][data-value="related:TEST-1"]')?.textContent`,
      ),
    ).toBe("TEST-1Rich browser fixture");
    await page.key("Escape");
    await markAs("Blocking…");
    expect(await page.eval(look)).toEqual([
      "Search for issue to mark as blocked by TEST-2…",
      ["Related issues", "Recent", "Create"],
      "Create new issue blocked by TEST-2…",
      "↵Mark as blocking",
      false,
    ]);
    await page.key("Escape");
    await markAs("Duplicate of…");
    expect(await page.eval(look)).toEqual([
      "Search for issue to mark as duplicate of…",
      ["Related issues", "Recent"],
      null,
      "↵Select",
      false,
    ]);
    await page.key("Escape");
    await markAs("Sub-issue of…");
    expect(await page.eval(look)).toEqual([
      "Search for issue to set as a parent…",
      [],
      null,
      "↵Set as parent",
      false,
    ]);
    await page.key("Escape");
    await markAs("Parent of…");
    expect(await page.eval(look)).toEqual([
      "Search for issue to add as a sub-issue…",
      ["Recent", "Create"],
      "Add sub-issue…" +
        (await page.eval(
          `document.querySelector('[cmdk-item][data-value="create"] .ui-shortcut').textContent`,
        )),
      "↵Add as sub-issue",
      false,
    ]);
    await page.key("Escape");
    await markAs("Blocked by…");
    await page.key("ArrowUp");
    await page.key("Enter");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Issue title'`);
    await page.type("Blocker follow-up");
    await page.key("Enter", "meta");
    const created = await page.eval<string>(
      `new Promise(r=>{const t=setInterval(()=>{const k=${shownIssue};if(k!=='TEST-2'){clearInterval(t);r(k)}},40)})`,
    );
    await page.waitFor(`!!document.querySelector('[data-relation="blocking:TEST-2"]')`);
    await page.goto("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('[data-relation="blocked:${created}"]')`);
  });
});

// Bundle: Nk/Pk, QB/eV/c1t/l1t/f1t, and If/Lf.subIssuesWidgetBadges.
test("bundle header geometry and colours are shared by page and side panel", async ({ open }) => {
  const page = await open("?issue=TEST-3&view=page", { width: 1272, height: 846, setup: tree });
  for (const mode of ["page", "side"]) {
    await page.waitFor(`document.querySelector('.issue-detail')?.dataset.mode===${JSON.stringify(mode)}&&!!document.querySelector('[data-parent-progress]')`);
    await page.hover('#summary');
    await page.waitFor(`getComputedStyle(document.querySelector('[data-parent-progress]')).borderTopColor==='lch(16.32 1.48 272)'`);
    expect(await page.eval(`(() => {
      const pill=document.querySelector('[data-parent-progress]'), style=getComputedStyle(pill), ring=pill.querySelector('svg'), arcs=[...ring.querySelectorAll('circle')];
      return [pill.getBoundingClientRect().height,style.paddingLeft,style.paddingRight,style.borderRadius,style.fontSize,style.fontWeight,
        getComputedStyle(pill.querySelector('.sub-issue-progress-count')).marginLeft,
        ring.getBoundingClientRect().width,ring.getBoundingClientRect().height,
        arcs.map(a=>[a.getAttribute('r'),a.getAttribute('stroke-width'),a.getAttribute('stroke-linecap'),getComputedStyle(a).stroke]),
        style.backgroundColor,style.color,style.borderTopColor, getComputedStyle(document.querySelector('[data-parent-link]').parentElement).marginBottom];
    })()`)).toEqual([26,"8px","8px","48px","12px","450","6px",16,16,
      [["7","2","round","lch(13.08 1.48 272)"],["7","2","round","lch(48 59.31 288.43)"]],
      "lch(5.52 0.4 272)","lch(61.803 1.2 272)","lch(16.32 1.48 272)","24px"]);
    expect(await page.eval(`(() => {const arcs=document.querySelector('[data-parent-progress] svg').children;return [arcs[0].getAttribute('stroke-dasharray'),arcs[1].getAttribute('transform'),Number(arcs[1].getAttribute('stroke-dashoffset'))]})()`)).toEqual([String(2*Math.PI*7),"rotate(-76 8 8)",3+2*Math.PI*7-(2*Math.PI*7-3)*(.085+.25*(.915+3/(2*Math.PI*7)))]);
    expect(await page.eval(`(() => {const s=getComputedStyle(document.getElementById('summary'));return [s.fontSize,s.fontWeight,s.lineHeight,s.letterSpacing,s.fontFeatureSettings,s.textWrap]})()`)).toEqual(["24px","600","32px","-0.16px",'"calt"',"pretty"]);
    await page.hover('[data-parent-progress]');
    await page.waitFor(`getComputedStyle(document.querySelector('[data-parent-progress]')).backgroundColor==='lch(7.32 0.85 272)'`);
    await page.click('[data-parent-progress]');
    await page.waitFor(`!!document.querySelector('[role=dialog]')`);
    expect(await page.eval(`(() => {const s=getComputedStyle(document.querySelector('[data-parent-progress]'));return [s.backgroundColor,s.borderTopColor]})()`)).toEqual(["lch(7.32 0.85 272)","lch(27.12 1.48 272)"]);
    await page.key("Escape");
    if(mode==="page") await page.click('[title="Open in side panel"]');
  }
  await page.hover('#summary');
  await page.cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await page.waitFor(`getComputedStyle(document.querySelector('[data-parent-progress]')).backgroundColor==='lch(97.94 0.5 282)'&&getComputedStyle(document.querySelector('[data-parent-progress]')).borderTopColor==='lch(84.44 0 282)'`);
  expect(await page.eval(`(() => {const p=document.querySelector('[data-parent-progress]'),s=getComputedStyle(p);return [s.backgroundColor,s.color,s.borderTopColor,...[...p.querySelectorAll('circle')].map(a=>getComputedStyle(a).stroke)]})()`)).toEqual(["lch(97.94 0.5 282)","lch(39.176 1.25 282)","lch(84.44 0 282)","lch(88.49 0 282)","lch(48 59.31 288.43)"]);
});
