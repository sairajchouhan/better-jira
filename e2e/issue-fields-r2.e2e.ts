import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";
afterAll(stop);

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

test("R2-issue-fields-D2: Restore mirrored Jira version keeps the issue's Jira remote links", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: writable() });
  try {
    await p.waitFor(`${ready}&&document.body.textContent.includes('QA link')`);
    await p.key("d", "shift");
    await p.click('[role="dialog"][aria-label="Due date"] [cmdk-item][data-value="Tomorrow"]');
    await p.waitFor(`${ops}.some(o=>o.op==='fields')`);
    await p.click("#issue-options");
    await p.click('[cmdk-item][data-value="Restore mirrored Jira version"]');
    await p.waitFor(`document.body.textContent.includes('Restored mirrored Jira version')`);
    await Bun.sleep(300);
    // Restore adopts Jira's version and writes nothing (R2-D3), so it can never delete Jira's links.
    expect(await p.eval(`${ops}.filter(o=>o.op==='weblink')`)).toEqual([]);
    expect(await p.eval(`${ops}.filter(o=>o.op==='fields').length`)).toBe(1);
    expect(await p.eval(`document.body.textContent.includes('QA link')`)).toBe(true);
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D4: the reminder pill opens a focusable menu that Escape closes", async () => {
  const p = await open("?issue=TEST-2&view=page");
  try {
    await p.waitFor(ready);
    await p.key("h", "shift");
    await p.click(
      '[role="dialog"][aria-label="Remind me"] [cmdk-item][data-value="An hour from now"]',
    );
    await p.click('[aria-label^="Reminder scheduled"]');
    await p.waitFor(
      `!!document.activeElement?.closest('[role="dialog"][aria-label="Reminder options"]')`,
    );
    expect(await p.eval(items("Reminder options"))).toEqual([
      "Reschedule reminder",
      "Cancel reminder",
    ]);
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Reminder options"]')`);
    expect(await p.eval(`!!document.getElementById('summary')`)).toBe(true);
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D5: a new label with spaces is created hyphenated, as Jira requires", async () => {
  const p = await open("?issue=TEST-2&view=page");
  try {
    await p.waitFor(ready);
    await p.key("l");
    await p.type("qa if spaced");
    await p.key("Enter");
    await p.waitFor(
      `[...document.querySelectorAll('[data-label-chip]')].some(n=>n.textContent==='qa-if-spaced')`,
    );
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D6: Shift+R puts the caret at the end of the title", async () => {
  const p = await open("?issue=TEST-2&view=page");
  try {
    await p.waitFor(ready);
    await p.key("r", "shift");
    await p.waitFor(`document.activeElement?.id==='summary'`);
    expect(
      await p.eval(
        `[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.value.length]`,
      ),
    ).toEqual(await p.eval(`Array(3).fill(document.activeElement.value.length)`));
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D9: an issue Jira says I watch reads as subscribed before watchers load", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: writable({ watching: true }) });
  try {
    await p.waitFor(`!!document.querySelector('[aria-label="Unsubscribe from issue"]')`);
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D11/D12: the palette offers Un-assign from me and Copy as Markdown, not Remove due date without one", async () => {
  const p = await open("?issue=TEST-2&view=page", {
    setup: writable({ assignee: { id: "audit-me", name: "Audit user" }, due: null }),
  });
  try {
    await p.waitFor(ready);
    await p.key("k", "meta");
    const commands = await p.waitFor<string[]>(
      `(()=>{const v=[...document.querySelectorAll('[cmdk-item]')].map(n=>n.dataset.value);return v.length>5&&v})()`,
    );
    expect(commands).toContain("cmd:Un-assign from me");
    expect(commands).toContain("cmd:Copy issue as Markdown");
    expect(commands).not.toContain("cmd:Assign to me");
    expect(commands).not.toContain("cmd:Remove due date");
  } finally {
    await p.close();
  }
});

test("R2-issue-fields-D13: rapid status changes reach Jira as one transition to the last status", async () => {
  const p = await open("?issue=TEST-2&view=page", { setup: writable() });
  try {
    await p.waitFor(ready);
    for (const status of ["Doing", "Review", "Done", "Backlog"]) {
      await p.eval("document.activeElement?.blur()");
      await p.key("s");
      await p.click(
        `[role="dialog"][aria-label="Change status"] [cmdk-item][data-value="${status}"]`,
      );
      await p.waitFor(`!document.querySelector('[role="dialog"][aria-label="Change status"]')`);
    }
    await p.waitFor(`${ops}.some(o=>o.op==='status')`);
    await Bun.sleep(800);
    expect(await p.eval(`${ops}.filter(o=>o.op==='status').map(o=>o.status)`)).toEqual(["backlog"]);
  } finally {
    await p.close();
  }
});
