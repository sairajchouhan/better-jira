import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);

/** Fresh feed per test; before the first open() the fixture is not up yet and is fresh anyway. */
const reset = (settings = {}) =>
  fetch(`${APP}__fixture`, { method: "POST", body: JSON.stringify(settings) }).catch(() => {});

const inboxCalls = async () =>
  (
    (await (await fetch(`${APP}__fixture`)).json()).requests as { method: string; path: string }[]
  ).filter((r) => r.path === "/api/inbox" && r.method === "POST").length;
const rows = `[...document.querySelectorAll('[data-inbox-row]')]`;
const rowText = `${rows}.map(r=>r.getAttribute('aria-label'))`;
const badge = `document.querySelector('[data-inbox-badge]')?.textContent ?? ''`;
const current = `(document.querySelector('[data-inbox-row][aria-current]')?.getAttribute('aria-label') ?? '')`;

test("Inbox lists Jira notifications per issue in Linear's words and clears the bell", async () => {
  await reset();
  const p = await open();
  try {
    await p.waitFor(`${badge} === "5"`);
    await p.click("nav button:has([data-inbox-badge])");
    await p.waitFor(`${rows}.length === 7`);
    expect(await p.eval(`location.search`)).toContain("inbox=1");
    const labels: string[] = await p.eval(rowText);
    expect(labels.map((l) => l.split(" ")[1])).toEqual([
      "TEST-2",
      "TEST-1",
      "TEST-3",
      "TEST-4",
      "TEST-5",
      "TEST-6",
      "OUT-9",
    ]);
    expect(labels[0]).toContain("Unread TEST-2 Browser fixture 2 Alex assigned the issue to you");
    expect(labels[1]).toContain("Alex mentioned you: Can you check this?");
    expect(labels[2]).toContain("Marked as completed by Sam");
    expect(labels[3]).toStartWith("Read TEST-4");
    expect(labels[3]).toContain("Sam commented: Looks good to me");
    expect(labels[4]).toContain("Alex reacted to your comment");
    expect(labels[5]).toContain("Sam created a new issue");
    expect(await p.eval(`${rows}.map(r=>r.innerText.split('\\n').at(-1))`)).toEqual([
      "5m",
      "30m",
      "2h",
      "1d",
      "3d",
      "1w",
      "1y",
    ]);
    expect(await p.eval(`document.body.innerText`)).toContain("5 unread notifications");
    // Opening the inbox clears Jira's unseen count (the bell), once.
    await p.waitFor(
      `fetch('/__fixture').then(r=>r.json()).then(d=>d.requests.some(r=>r.method==='POST'&&r.path==='/api/inbox'))`,
    );
    expect(await inboxCalls()).toBe(1);
  } finally {
    await p.close();
  }
});

test("j/k select rows, mark them read in Jira and open the issue; U, E, Enter and Escape act like Linear", async () => {
  await reset();
  const p = await open("?inbox=1");
  try {
    await p.waitFor(`${rows}.length === 7`);
    await p.key("j");
    await p.waitFor(`${current}.startsWith("Read TEST-2")`);
    await p.waitFor(
      `document.querySelector('.issue-detail')?.dataset.mode === 'side' && document.querySelector('.issue-detail').innerText.includes('TEST-2')`,
    );
    await p.waitFor(`${badge} === "4"`);
    await p.key("j");
    await p.waitFor(`${current}.startsWith("Read TEST-1")`);
    await p.key("k");
    await p.waitFor(`${current}.startsWith("Read TEST-2")`);
    await p.key("u");
    await p.waitFor(`${current}.startsWith("Unread TEST-2")`);
    await p.waitFor(`${badge} === "4"`); // TEST-2 unread again, TEST-1 read
    await p.key("e");
    await p.waitFor(`${rows}.length === 6 && ${current}.includes("TEST-1")`);
    await p.key("Enter");
    await p.waitFor(
      `document.querySelector('.issue-detail')?.dataset.mode === 'page' && !document.querySelector('[data-inbox-row]')`,
    );
    await p.key("Escape");
    await p.waitFor(
      `document.querySelector('.issue-detail')?.dataset.mode === 'side' && ${rows}.length === 6`,
    );
    // The read state is Jira's: a fresh tab sees it, the delete stays local to this browser.
    await p.reload();
    await p.waitFor(
      `${rows}.length === 6 && ${rowText}.some(l=>l.startsWith("Read TEST-1")) && !${rowText}.some(l=>l.includes("TEST-2"))`,
    );
  } finally {
    await p.close();
  }
});

const rowKeys = `${rowText}.map(l=>l.split(" ")[1]).join()`;
const item = (menu: string, value: string) =>
  `[role=dialog][aria-label="${menu}"] [cmdk-item][data-value="${value}"]`;
const toggle = (label: string) =>
  `[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input').click()`;
const choose = (label: string, value: string) =>
  `(()=>{const s=document.querySelector('select[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'${value}');s.dispatchEvent(new Event('change',{bubbles:true}))})()`;

test("Priority inbox tabs, Linear's filters with chips, and Focus grouping", async () => {
  await reset();
  const p = await open("?inbox=1");
  try {
    await p.waitFor(`${rows}.length === 7`);
    // Display options: the priority inbox splits Jira's Direct (Priority) from Watching (Other); ⌥2 / ⌥1 switch.
    await p.click(`[aria-label="Display options"]`);
    await p.eval(toggle("Enable priority inbox"));
    await p.waitFor(`${rowKeys} === "TEST-2,TEST-1,TEST-5"`);
    await p.key("Escape");
    await p.key("2", "alt");
    await p.waitFor(`${rowKeys} === "TEST-3,TEST-4,TEST-6,OUT-9"`);
    await p.click(`[role=tab][aria-selected=false]`);
    await p.waitFor(`${rowKeys} === "TEST-2,TEST-1,TEST-5"`);
    await p.click(`[aria-label="Display options"]`);
    await p.eval(toggle("Enable priority inbox"));
    await p.waitFor(`${rows}.length === 7`);
    // Focus grouping: unread rows by focus group, then the read ones.
    await p.eval(choose("Group unreads by", "focus"));
    await p.waitFor(
      `[...document.querySelectorAll('[data-inbox-group]')].map(g=>g.dataset.inboxGroup).join() === "Mentions,Other,Read"`,
    );
    await p.eval(choose("Ordering", "priority"));
    // TEST-4 is the only Urgent issue; it is read, so it leads the Read group.
    await p.waitFor(`${rowKeys}.startsWith("TEST-1,") && ${rowKeys}.includes("TEST-4,TEST-5")`);
    await p.eval(choose("Group unreads by", "none"));
    await p.eval(choose("Ordering", "newest"));
    await p.key("Escape");
    // F opens Linear's filter menu; each field lists the values the rows have, with counts.
    await p.key("f");
    await p.click(`[cmdk-item][data-value="Notification type"]`);
    await p.waitFor(
      `document.querySelector('${item("Notification type", "Mentions")}')?.textContent.includes("1 notification")`,
    );
    await p.click(item("Notification type", "Mentions"));
    await p.waitFor(`${rowKeys} === "TEST-1"`);
    await p.waitFor(
      `document.querySelector('[data-inbox-chip="type"]')?.textContent === "Notification type isMentions"`,
    );
    await p.click(`[aria-label="Add filter"]`);
    await p.click(`[cmdk-item][data-value="Notification type"]`);
    await p.click(item("Notification type", "Comments and replies"));
    await p.waitFor(`${rowKeys} === "TEST-1,TEST-4"`);
    await p.waitFor(
      `document.querySelector('[data-inbox-chip="type"]')?.textContent.includes("is any of")`,
    );
    await p.click(`[aria-label="Add filter"]`);
    await p.click(`[cmdk-item][data-value="Issue priority"]`);
    await p.click(item("Issue priority", "Urgent"));
    await p.waitFor(`${rowKeys} === "TEST-4"`);
    await p.click(`[aria-label="Remove Notification type filter"]`);
    await p.waitFor(`${rowKeys} === "TEST-4"`);
    await p.click(`text=Clear`);
    await p.waitFor(`${rows}.length === 7 && !document.querySelector('[data-inbox-chip]')`);
    // Filters persist across reloads, like Linear's view.
    await p.key("f");
    await p.click(`[cmdk-item][data-value="Project"]`);
    await p.click(item("Project", "OUT"));
    await p.waitFor(`${rowKeys} === "OUT-9"`);
    await p.reload();
    await p.waitFor(`${rowKeys} === "OUT-9"`);
  } finally {
    await p.close();
  }
});

test("Older notifications load on scroll; Z and the toast undo delete, snooze and read; ⌫ deletes; the row menu", async () => {
  await reset({ inboxExtra: 40 });
  const p = await open("?inbox=1");
  try {
    await p.waitFor(`${rows}.length === 20`);
    await Bun.sleep(300);
    expect(await p.eval(`${rows}.length`)).toBe(20); // the end of the list is out of view
    await p.eval(`document.querySelector('[data-inbox-end]').scrollIntoView()`);
    await p.waitFor(`${rows}.length === 40`);
    await p.eval(`document.querySelector('[data-inbox-end]').scrollIntoView()`);
    await p.waitFor(`${rows}.length === 47`);
    const gets: string[] = (await (await fetch(`${APP}__fixture`)).json()).requests
      .filter((r: any) => r.method === "GET" && r.path.startsWith("/api/inbox"))
      .map((r: any) => r.path);
    expect(gets).toContain("/api/inbox?after=20");
    expect(gets).toContain("/api/inbox?after=40");
    await p.eval(`document.querySelector('[data-inbox-row]').scrollIntoView()`);
    // E deletes with Linear's toast; Z brings the row back and selects it again.
    await p.key("j");
    await p.waitFor(`${current}.includes("TEST-2")`);
    await p.key("e");
    await p.waitFor(
      `${rows}.length === 46 && document.querySelector('[data-toast]')?.textContent.includes("Notification deleted")`,
    );
    await p.key("z");
    await p.waitFor(`${rows}.length === 47 && ${current}.includes("TEST-2")`);
    // ⌫ deletes too; the toast's Undo restores.
    await p.key("Backspace");
    await p.waitFor(`${rows}.length === 46 && ${current}.includes("TEST-1")`);
    await p.click(`[data-toast] button`);
    await p.waitFor(`${rows}.length === 47 && ${current}.includes("TEST-2")`);
    // H snoozes for an hour; Z unsnoozes.
    await p.key("h");
    await p.click(`[data-snooze="An hour from now"]`);
    await p.waitFor(
      `${rows}.length === 46 && document.querySelector('[data-toast]')?.textContent.includes("Notification snoozed")`,
    );
    await p.key("z");
    await p.waitFor(`${rows}.length === 47`);
    // U marks unread in Jira; Z marks it read again.
    await p.key("u");
    await p.waitFor(`${current}.startsWith("Unread TEST-2")`);
    await p.key("z");
    await p.waitFor(`${current}.startsWith("Read TEST-2")`);
    // Snooze and delete in the open issue's header.
    await p.click(`[aria-label="Delete notification"]`);
    await p.waitFor(`${rows}.length === 46 && ${current}.includes("TEST-1")`);
    await p.key("z");
    await p.waitFor(`${rows}.length === 47`);
    // Right-click: Linear's row menu, acting on that row without selecting it.
    await p.eval(
      `(()=>{const r=document.querySelector('[data-inbox-row*="issue/3"]').getBoundingClientRect();document.querySelector('[data-inbox-row*="issue/3"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+40,clientY:r.y+20}))})()`,
    );
    await p.waitFor(
      `["Mark as read","Delete notification","Snooze","Favorite","Copy"].every(v=>document.querySelector('[role=dialog][aria-label="Notification options"] [cmdk-item][data-value="'+v+'"]'))`,
    );
    await p.click(`[cmdk-item][data-value="Favorite"]`);
    await p.waitFor(`!document.querySelector('[aria-label="Notification options"]')`);
    await p.eval(
      `(()=>{const n=document.querySelector('[data-inbox-row*="issue/3"]'),r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+40,clientY:r.y+20}))})()`,
    );
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="Remove from favorites"]')`);
    await p.click(`[cmdk-item][data-value="Delete notification"]`);
    await p.waitFor(
      `${rows}.length === 46 && !${rowText}.some(l=>l.includes("TEST-3")) && ${current}.includes("TEST-2")`,
    );
    // Deletes and snoozes are this browser's own (Jira has neither); they survive a reload.
    await p.reload();
    await p.waitFor(`${rows}.length === 19 && !${rowText}.some(l=>l.includes("TEST-3"))`);
  } finally {
    await p.close();
  }
});

test("Unread-only and a notification outside the mirror", async () => {
  await reset();
  const p = await open("?inbox=1");
  try {
    await p.waitFor(`${rows}.length === 7`);
    await p.click(`[aria-label="Show unreads only"]`);
    await p.waitFor(`${rows}.length === 5 && ${rowText}.every(l=>l.startsWith("Unread"))`);
    await p.click(`[data-inbox-row*="issue/9"]`);
    await p.waitFor(
      `document.body.innerText.includes("Open in Jira") && document.body.innerText.includes("Outside the mirror")`,
    );
    // Unread-only keeps the selected row once read; it drops when the selection moves on.
    await p.waitFor(`${current}.startsWith("Read OUT-9") && ${rows}.length === 5`);
    await p.key("k");
    await p.waitFor(`${current}.startsWith("Read TEST-6") && ${rows}.length === 4`);
  } finally {
    await p.close();
  }
});
