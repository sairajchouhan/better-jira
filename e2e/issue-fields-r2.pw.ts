import { expect, test, sleep } from "./app";

/** A writable site faked in the page: ops are recorded in `window.__ops` and answered after `window.__latency` ms. `list` patches TEST-2 in the mirror list. */
const writable = (list = {}) => `(()=>{const real=fetch;window.__ops=[];window.__latency=0;
window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/client'){const client=await (await real(input,init)).json();return Response.json({...client,writable:true});}
 if(path==='/api/options')return Response.json({priorities:[],users:[],labels:[],versions:{}});
 if(path==='/api/issues'){const issues=await (await real(input,init)).json();return Response.json(issues.map(i=>i.key==='TEST-2'?{...i,...${JSON.stringify(list)}}:i));}
 if(path==='/api/issues/TEST-2'){const full=await (await real(input,init)).json();return Response.json({...full,remotelinks:[{url:'https://example.com/qa',title:'QA link'}]});}
 const m=path.match(/^\\/api\\/issues\\/([^/]+)\\/ops$/);if(!m)return real(input,init);
 const {ops}=JSON.parse(init.body);window.__ops.push(ops);
 await new Promise(r=>setTimeout(r,window.__latency));
 return Response.json({key:m[1],created:{},others:[]});
};})()`;
const ops = `window.__ops.flat()`;
const ready = `!!document.getElementById('comment')`;
const items = (dialog: string) =>
  `[...document.querySelectorAll('[role="dialog"][aria-label="${dialog}"] [cmdk-item]')].map(n=>n.dataset.value)`;

test("R2 issue fields on a writable site: remote links, watching, palette commands, rapid status", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { setup: writable() });
  await test.step("R2-issue-fields-D2: Restore mirrored Jira version keeps the issue's Jira remote links", async () => {
    await page.waitFor(`${ready}&&document.body.textContent.includes('QA link')`);
    await page.key("d", "shift");
    await page.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Tomorrow"]');
    await page.waitFor(`${ops}.some(o=>o.op==='fields')`);
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Restore mirrored Jira version"]');
    await page.waitFor(`document.body.textContent.includes('Restored mirrored Jira version')`);
    await sleep(300);
    // Restore adopts Jira's version and writes nothing (R2-D3), so it can never delete Jira's links.
    expect(await page.eval(`${ops}.filter(o=>o.op==='weblink')`)).toEqual([]);
    expect(await page.eval(`${ops}.filter(o=>o.op==='fields').length`)).toBe(1);
    expect(await page.eval(`document.body.textContent.includes('QA link')`)).toBe(true);
  });
  await test.step("R2-issue-fields-D13: rapid status changes reach Jira as one transition to the last status", async () => {
    await page.waitFor(ready);
    // Rapid means within the 400 ms hold of each other: the picks run in the page, as fast as the app renders, since four
    // Playwright round trips each can outlast the hold on a loaded machine and rightly send two transitions (BJ-166).
    await page.eval(`(async()=>{
      const until=async(found)=>{for(let n;!(n=found());)await new Promise(r=>requestAnimationFrame(r));return found();};
      const menu='[role="dialog"][aria-label="Change status"]';
      for(const status of ["Doing","Review","Done","Backlog"]){
        document.activeElement?.blur();
        document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"s",code:"KeyS",bubbles:true,cancelable:true}));
        (await until(()=>document.querySelector(menu+' [cmdk-item][data-value="'+status+'"]'))).click();
        await until(()=>!document.querySelector(menu));
      }
    })()`);
    await page.waitFor(`${ops}.some(o=>o.op==='status')`);
    await sleep(800);
    expect(await page.eval(`${ops}.filter(o=>o.op==='status').map(o=>o.status)`)).toEqual([
      "backlog",
    ]);
  });
  await test.step("R2-issue-fields-D9: an issue Jira says I watch reads as subscribed before watchers load", async () => {
    const p = await open("?issue=TEST-2&view=page", { setup: writable({ watching: true }) });
    await p.waitFor(`!!document.querySelector('[aria-label="Unsubscribe from issue"]')`);
  });
  await test.step("R2-issue-fields-D11/D12: the palette offers Un-assign from me and Copy as Markdown, not Remove due date without one", async () => {
    const p = await open("?issue=TEST-2&view=page", {
      setup: writable({ assignee: { id: "audit-me", name: "Audit user" }, due: null }),
    });
    await p.waitFor(ready);
    await p.key("k", "meta");
    const commands = await p.waitFor<string[]>(
      `(()=>{const v=[...document.querySelectorAll('[cmdk-item]')].map(n=>n.dataset.value);return v.length>5&&v})()`,
    );
    expect(commands).toContain("cmd:Un-assign from me");
    expect(commands).toContain("cmd:Copy issue as Markdown");
    expect(commands).not.toContain("cmd:Assign to me");
    expect(commands).not.toContain("cmd:Remove due date");
  });
  await test.step("BJ-45: I un-assigns me when the issue is already mine", async () => {
    const p = await open("?issue=TEST-2&view=page", {
      setup: writable({ assignee: { id: "audit-me", name: "Audit user" } }),
    });
    await p.waitFor(ready);
    await p.key("i");
    await p.waitFor(`${ops}.some(o=>o.op==='fields'&&o.fields.assignee===null)`);
  });
  await test.step("R3-issue-fields-D1: a writable site offers no No priority, which Jira refuses", async () => {
    const p = await open("?issue=TEST-2&view=page", {
      setup: writable({ priority: "High" }),
    });
    await p.waitFor(ready);
    await p.key("p");
    await p.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Set priority"] [cmdk-item]')`);
    expect(
      await p.eval(
        `!!document.querySelector('[role="dialog"][aria-label="Set priority"] [cmdk-item][data-value="No priority"]')`,
      ),
    ).toBe(false);
  });
});

test("R2 issue fields on a read-only site: reminder pill, hyphenated labels, Shift+R caret", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("R2-issue-fields-D4: the reminder pill opens a focusable menu that Escape closes", async () => {
    await page.waitFor(ready);
    await page.key("h", "shift");
    await page.click(
      '[role="dialog"][aria-label="Remind me"] [cmdk-item][data-value="An hour from now"]',
    );
    await page.click('[aria-label^="Reminder scheduled"]');
    await page.waitFor(
      `!!document.activeElement?.closest('[role="dialog"][aria-label="Reminder options"]')`,
    );
    expect(await page.eval(items("Reminder options"))).toEqual([
      "Reschedule reminder",
      "Cancel reminder",
    ]);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Reminder options"]')`);
    expect(await page.eval(`!!document.getElementById('summary')`)).toBe(true);
  });
  await test.step("R2-issue-fields-D5: a new label with spaces is created hyphenated, as Jira requires", async () => {
    await page.waitFor(ready);
    await page.key("l");
    await page.type("qa if spaced");
    await page.key("Enter");
    await page.waitFor(
      `[...document.querySelectorAll('[data-label-chip]')].some(n=>n.textContent==='qa-if-spaced')`,
    );
  });
  await test.step("R2-issue-fields-D6: Shift+R puts the caret at the end of the title", async () => {
    await page.waitFor(ready);
    await page.key("r", "shift");
    await page.waitFor(`document.activeElement?.id==='summary'`);
    expect(
      await page.eval(
        `[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.value.length]`,
      ),
    ).toEqual(await page.eval(`Array(3).fill(document.activeElement.value.length)`));
  });
});

test("Due date › Custom… is Linear's due-date dialog: typed dates preview on a two-month calendar, a day saves, Remove clears", async ({
  open,
}) => {
  const page = await open("?issue=TEST-1&view=page");
  const SET = '[role="dialog"][aria-label="Set due date"]';
  const EDIT = '[role="dialog"][aria-label="Edit due date"]';
  const custom = async () => {
    await page.eval("document.activeElement?.blur()");
    await page.key("d", "shift");
    await page.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Custom…"]');
  };
  await page.waitFor(ready);
  await test.step("the dialog: 562px, the field focused, two months, Jump to today hidden on today's month", async () => {
    await custom();
    await page.waitFor(`!!document.querySelector('${SET} .ui-calendar')`);
    await page.waitFor(`document.activeElement?.matches('${SET} input')`);
    expect(await page.eval(`document.querySelector('${SET}').getBoundingClientRect().width`)).toBe(562);
    expect(await page.eval(`document.querySelectorAll('${SET} .ui-calendar-grid').length`)).toBe(2);
    expect(await page.eval(`!!document.querySelector('${SET} [aria-label="Jump to today"]')`)).toBe(false);
    expect(await page.eval(`!!document.querySelector('${SET} [data-today]')`)).toBe(true);
  });
  await test.step("typing a date turns the calendar to its month and circles it; Enter saves it", async () => {
    await page.type("2030-03-20");
    await page.waitFor(`document.querySelector('${SET} .ui-calendar-caption-label')?.textContent==="March 2030"`);
    expect(await page.eval(`document.querySelector('${SET} [data-highlighted]')?.textContent`)).toBe("20");
    // Off today's months now: Jump to today shows, pointing back.
    expect(await page.eval(`!!document.querySelector('${SET} [aria-label="Jump to today"]')`)).toBe(true);
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('${SET}')`);
    expect(await page.waitFor<string>(`document.getElementById('prop-due')?.textContent`)).toBe("Mar 20, 2030");
  });
  await test.step("Edit due date opens on the chosen day; Next month moves one month; a day press saves at once", async () => {
    await custom();
    await page.waitFor(`!!document.querySelector('${EDIT} [data-selected]')`);
    expect(await page.eval(`document.querySelector('${EDIT} [data-selected]').textContent`)).toBe("20");
    await page.click(`${EDIT} [aria-label="Next month"]`);
    await page.waitFor(`document.querySelector('${EDIT} .ui-calendar-caption-label')?.textContent==="April 2030"`);
    // Focus stays in the field (the calendar's mousedown is prevented, as Linear's).
    expect(await page.eval(`document.activeElement?.matches('${EDIT} input')`)).toBe(true);
    await page.click(`${EDIT} [aria-label="Wednesday, April 10, 2030"]`);
    await page.waitFor(`!document.querySelector('${EDIT}')`);
    expect(await page.waitFor<string>(`document.getElementById('prop-due')?.textContent`)).toBe("Apr 10, 2030");
  });
  await test.step("Escape in the field moves to Close; Remove due date clears it", async () => {
    await custom();
    await page.waitFor(`document.activeElement?.matches('${EDIT} input')`);
    await page.key("Escape");
    expect(await page.eval(`document.activeElement?.getAttribute('aria-label')`)).toBe("Close");
    expect(await page.eval(`!!document.querySelector('${EDIT}')`)).toBe(true);
    await page.eval(`[...document.querySelectorAll('${EDIT} button')].find(b=>b.textContent==='Remove due date').click()`);
    await page.waitFor(`!document.querySelector('${EDIT}')`);
    expect(await page.eval(`document.getElementById('prop-due')?.textContent ?? ""`)).not.toContain("2030");
  });
  await page.close();
});
