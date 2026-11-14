import {
  expect,
  test,
  sleep,
  fixture,
  type App as Page,
  type OpenOptions,
} from "./app";

const inboxCalls = async () =>
  (await fixture.log()).requests.filter(
    (r) => r.path === "/api/inbox" && r.method === "POST",
  ).length;
const rows = `[...document.querySelectorAll('[data-inbox-row]')]`;
const rowText = `${rows}.map(r=>r.getAttribute('aria-label'))`;
const rowKeys = `${rowText}.map(l=>l.split(" ")[1]).join()`;
const badge = `(document.querySelector('[data-inbox-badge]')?.textContent ?? '')`;
const current = `(document.querySelector('[data-inbox-row][aria-current]')?.getAttribute('aria-label') ?? '')`;
const toastText = `(document.querySelector('[data-toast]')?.textContent ?? '')`;
const item = (menu: string, value: string) =>
  `[role=dialog][aria-label="${menu}"] [cmdk-item][data-value="${value}"]`;
const toggle = (label: string) =>
  `[...document.querySelectorAll('label')].find(l=>l.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input').click()`;
async function choose(p: Page, label: string, value: string) {
  await p.click(`button[aria-label^="${label}: "]`);
  await p.click(
    `[role=dialog][aria-label="${label}"] [cmdk-item][data-value$=" ${value}"]`,
  );
}
const rowMenu = (n: number) =>
  `(()=>{const n=document.querySelector('[data-inbox-row*="issue/${n}"]'),r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+40,clientY:r.y+20}))})()`;
const LOCAL =
  "better-jira:inbox-local:v1:https://example.atlassian.net/audit-me";
const jiraUnread = async (n: number) =>
  (
    (await (await fetch(`${fixture.url}api/inbox`)).json()).items as {
      id: string;
      unread: boolean;
    }[]
  ).find((i) => i.id === `ari:cloud:jira:fixture:issue/${n}`)?.unread;

/** A page on a fixture reset with these settings. */
type Open = (path?: string, options?: OpenOptions) => Promise<Page>;
async function fresh(
  open: Open,
  settings: object,
  path = "?inbox=1",
  options?: OpenOptions,
) {
  await fixture.reset(settings);
  return open(path, options);
}

test("reading the inbox: Linear's rows, the bell, tabs, filters, and the keys that select, read and open", async ({
  open,
}) => {
  const p = await open();
  await test.step("Inbox lists Jira notifications per issue in Linear's words and clears the bell", async () => {
    await p.waitFor(`${badge} === "5"`);
    await p.click("nav a:has([data-inbox-badge])");
    await p.waitFor(`${rows}.length === 7`);
    expect(await p.eval(`location.pathname`)).toBe("/inbox");
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
    // TEST-2 is a group: Jira's newest, "Sam updated a task", leads; Linear's prioritize promotes only mentions (R3 G15).
    // The summary names whom Jira names (its additionalActors). The status is the one the row's icon shows, the issue's
    // current one (R3 G22).
    expect(labels[0]).toBe(
      "Unread TEST-2 Browser fixture 2 · Task, Todo Sam updated a task · +1 update from Alex",
    );
    expect(await p.eval(`document.querySelector('[data-inbox-row*="issue/2"] [data-inbox-status]')?.title`)).toBe("Todo");
    expect(labels[1]).toContain("Alex mentioned you in a comment: Can you check this?");
    expect(labels[2]).toContain("Marked as completed by Sam: Doing → Done");
    expect(labels[3]).toStartWith("Read TEST-4");
    expect(labels[3]).toContain("Sam commented: Looks good to me");
    expect(labels[4]).toContain("Alex reacted to your comment");
    expect(labels[5]).toContain("Sam created a new task");
    expect(labels[6]).toContain("+2 updates from Kim and others");
    expect(
      await p.eval(`${rows}.map(r=>r.innerText.split('\\n').at(-1))`),
    ).toEqual(["5m", "30m", "2h", "1d", "3d", "1w", "1y"]);
    expect(await p.eval(`document.body.innerText`)).toContain(
      "5 unread notifications",
    );
    // Opening the inbox clears Jira's unseen count (the bell), once.
    await p.waitFor(
      `fetch('/__fixture').then(r=>r.json()).then(d=>d.requests.some(r=>r.method==='POST'&&r.path==='/api/inbox'))`,
    );
    expect(await inboxCalls()).toBe(1);
  });
  await test.step("Priority inbox tabs, Linear's filters with chips, and Focus grouping", async () => {
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
    await choose(p, "Group unreads by", "focus");
    await p.waitFor(
      `[...document.querySelectorAll('[data-inbox-group]')].map(g=>g.dataset.inboxGroup).join() === "Mentions,Other,Read"`,
    );
    await choose(p, "Ordering", "priority");
    // TEST-4 is the only Urgent issue; it is read, so it leads the Read group.
    await p.waitFor(
      `${rowKeys}.startsWith("TEST-1,") && ${rowKeys}.includes("TEST-4,TEST-5")`,
    );
    await choose(p, "Group unreads by", "none");
    await choose(p, "Ordering", "newest");
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
    await p.waitFor(
      `${rows}.length === 7 && !document.querySelector('[data-inbox-chip]')`,
    );
    // CORE-17: a click opens Linear's filter menu left-aligned under Filter, its "Add Filter…" search showing, no row highlighted.
    await p.click("#inbox-filter");
    const FILTER_MENU = '[role=dialog][aria-label="Filter"]';
    await p.waitFor(`document.activeElement?.placeholder === "Add Filter…"`);
    expect(
      await p.eval(
        `(()=>{const b=document.getElementById("inbox-filter").getBoundingClientRect(),m=document.querySelector('${FILTER_MENU}'),i=m.querySelector("input");return [Math.round(m.getBoundingClientRect().left-b.left),!i.closest(".sr-only")&&i.getBoundingClientRect().width>100,m.querySelector("[data-pristine]")!==null]})()`,
      ),
    ).toEqual([0, true, true]);
    await p.type("prio");
    await p.waitFor(
      `(v=>v.length>0&&v.every(x=>x.startsWith("Issue priority")))([...document.querySelectorAll('${FILTER_MENU} [cmdk-item]')].map(n=>n.dataset.value))`,
    );
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('${FILTER_MENU}')`);
    // Filters persist across reloads, like Linear's view.
    await p.key("f");
    await p.click(`[cmdk-item][data-value="Project"]`);
    await p.click(item("Project", "OUT"));
    await p.waitFor(`${rowKeys} === "OUT-9"`);
    await p.reload();
    await p.waitFor(`${rowKeys} === "OUT-9"`);
    await p.click(`text=Clear`);
    await p.waitFor(
      `${rows}.length === 7 && !document.querySelector('[data-inbox-chip]')`,
    );
  });
  await test.step("j/k select rows, mark them read in Jira and open the issue; U, E, Enter and Escape act like Linear", async () => {
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
  });
  await test.step("Keyboard: arrows in the snooze and ··· menus, F then Enter, Enter after a click, the row menu's H", async () => {
    // TEST-2 is deleted and TEST-1 selected from the step before: 6 rows.
    await p.waitFor(`${current}.includes("TEST-1")`);
    await p.key("j");
    await p.key("h");
    const snooze = `document.querySelector('[data-snooze][data-selected=true]')?.dataset.snooze`;
    await p.waitFor(`${snooze} === "An hour from now"`);
    await p.key("ArrowDown");
    // The second choice is "In 3 hours", or "This evening" from 15:00 (Linear's order by time), in the browser's time zone.
    await p.waitFor(
      `${snooze} === document.querySelectorAll('[data-snooze]')[1]?.dataset.snooze`,
    );
    await p.key("Enter");
    await p.waitFor(
      `${rows}.length === 5 && ${toastText}.includes("Notification snoozed")`,
    );
    await p.key("z");
    await p.waitFor(`${rows}.length === 6`);
    await p.click(`[aria-label="Notification actions"]`);
    const action = `document.querySelector('[role=dialog][aria-label="Notification actions"] [cmdk-item][data-selected=true]')?.dataset.value`;
    await p.key("ArrowDown");
    await p.waitFor(`${action} === "Mark all as read"`);
    await p.key("ArrowDown");
    await p.waitFor(`${action} === "Delete all"`);
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role=dialog]')`);
    // Linear's filter menu opens on its first field.
    await p.key("f");
    await p.key("Enter");
    await p.waitFor(
      `!!document.querySelector('${item("Notification type", "Mentions")}')`,
    );
    await p.key("Escape");
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role=dialog]')`);
    // The row menu shows Snooze's H.
    await p.eval(rowMenu(3));
    await p.waitFor(
      `document.querySelector('[aria-label="Notification options"] [cmdk-item][data-value="Snooze"]')?.textContent.endsWith("H")`,
    );
    await p.key("Escape");
    await p.waitFor(`!document.querySelector('[role=dialog]')`);
    // Enter after clicking a row opens the full page.
    await p.click(`[data-inbox-row*="issue/1"]`);
    await p.waitFor(`${current}.includes("TEST-1")`);
    await p.key("Enter");
    await p.waitFor(
      `document.querySelector('.issue-detail')?.dataset.mode === 'page'`,
    );
  });
  await test.step("A reload keeps the selected row and shows the last feed before Jira answers", async () => {
    await p.key("Escape");
    await p.waitFor(`${rows}.length === 6 && ${current}.includes("TEST-1")`);
    await p.key("e");
    await p.waitFor(
      `${rows}.length === 5 && !${rowText}.some(l=>l.includes("TEST-1"))`,
    );
    await fixture.reset({ inboxDelay: 3000 });
    await p.reload();
    await p.waitFor(`${rows}.length === 5`, 1500);
  });
});

test("triaging rows: unread-only, toast undo, other tabs, rows outside the mirror, snoozes, fast U and per-tab undo", async ({
  open,
}) => {
  await test.step("A failed ⌥U shows the rows unread again", async () => {
    const p = await fresh(open, { inboxFail: true });
    await p.waitFor(`${rows}.length === 7`);
    await p.key("u", "alt");
    await p.waitFor(
      `document.body.innerText.includes("Could not update Jira")`,
    );
    await p.waitFor(
      `${rowText}.filter(l=>l.startsWith("Unread")).length === 5`,
    );
  });
  await test.step("An expired snooze brings the row back unread, in Jira too", async () => {
    // TEST-4 is read, and its snooze ended a second ago.
    const setup = `if(!sessionStorage.seeded){sessionStorage.seeded=1;localStorage.setItem(${JSON.stringify(LOCAL)},JSON.stringify({"fixture-4-1560":{snoozed:Date.now()-1000}}))}`;
    const p = await fresh(open, {}, "?inbox=1", { setup });
    await p.waitFor(
      `${rows}.length === 7 && ${rowText}.some(l=>l.startsWith("Unread TEST-4"))`,
    );
    await p.waitFor(`${badge} === "6"`);
    await p.reload();
    await p.waitFor(`${rowText}.some(l=>l.startsWith("Unread TEST-4"))`);
  });
  const p = await fresh(open, {});
  await p.waitFor(`${rows}.length === 7`);
  await test.step("Unread-only and a notification outside the mirror", async () => {
    await p.click(`[aria-label="Show unreads only"]`);
    await p.waitFor(
      `${rows}.length === 5 && ${rowText}.every(l=>l.startsWith("Unread"))`,
    );
    await p.click(`[data-inbox-row*="issue/9"]`);
    await p.waitFor(
      `document.body.innerText.includes("Open in Jira") && document.body.innerText.includes("Outside the mirror")`,
    );
    // Unread-only keeps the selected row once read; it drops when the selection moves on.
    await p.waitFor(
      `${current}.startsWith("Read OUT-9") && ${rows}.length === 5`,
    );
    await p.key("k");
    await p.waitFor(
      `${current}.startsWith("Read TEST-6") && ${rows}.length === 4`,
    );
    await p.click(`[aria-label="Show read"]`);
    await p.waitFor(`${rows}.length === 7`);
  });
  await test.step("The toast's Undo undoes its own action, not the newest", async () => {
    await p.click(`[data-inbox-row*="issue/2"]`);
    // Read once it has been selected for 300 ms (Linear's `MarkNotificationAsRead`).
    await p.waitFor(`${current}.startsWith("Read TEST-2")`);
    await p.key("e");
    await p.waitFor(
      `${rows}.length === 6 && ${current}.includes("TEST-1") && ${toastText}.includes("Notification deleted")`,
    );
    await p.key("u");
    await p.waitFor(`${current}.startsWith("Unread TEST-1")`);
    await p.click(`[data-toast] button`);
    await p.waitFor(
      `${rows}.length === 7 && ${rowText}.some(l=>l.startsWith("Unread TEST-1")) && ${current}.includes("TEST-2")`,
    );
  });
  await test.step("Another tab's local changes survive this tab's writes, and its storage event shows them", async () => {
    // TEST-2 is selected from the step before.
    await p.key("e");
    await p.waitFor(`${rows}.length === 6 && ${current}.includes("TEST-1")`);
    // Another tab undoes the delete; this tab has not heard yet.
    await p.eval(`localStorage.setItem(${JSON.stringify(LOCAL)}, "{}")`);
    await p.key("e");
    await p.reload();
    await p.waitFor(
      `${rows}.length === 6 && ${rowText}.some(l=>l.includes("TEST-2")) && !${rowText}.some(l=>l.includes("TEST-1"))`,
    );
    await p.eval(
      `localStorage.setItem(${JSON.stringify(LOCAL)}, "{}"); dispatchEvent(new StorageEvent("storage", { key: ${JSON.stringify(LOCAL)} }))`,
    );
    await p.waitFor(`${rows}.length === 7`);
  });
  await test.step("R2-inbox-D6: a selected row outside the mirror stays selected over a reload", async () => {
    await p.click(`[data-inbox-row*="issue/9"]`);
    await p.waitFor(
      `${current}.includes("OUT-9") && location.search.includes("notification=")`,
    );
    await p.reload();
    await p.waitFor(
      `${current}.includes("OUT-9") && document.body.innerText.includes("Open in Jira")`,
    );
    // Leaving the inbox drops it from the URL.
    await p.click(`[data-inbox-row*="issue/1"]`);
    await p.waitFor(
      `${current}.includes("TEST-1") && !location.search.includes("notification=")`,
    );
  });
  await test.step("R2-inbox-D7: a past custom snooze time shows its error in the dialog, which goes with it", async () => {
    await p.key("j");
    await p.key("h");
    await p.click(`[cmdk-item][data-value="Custom…"]`);
    const setValue = (v: string) =>
      p.eval(
        `(()=>{const i=[...document.querySelectorAll('[role=dialog] input')].find(i=>i.labels?.[0]?.textContent==='Snooze until');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
    await setValue("2020-01-01T09:00");
    await p.click(`[role=dialog] button[type=submit]`);
    await p.waitFor(
      `document.querySelector('[role=dialog] [role=alert]')?.textContent === "Choose a future snooze time"`,
    );
    await setValue("2099-01-01T09:00");
    await p.click(`[role=dialog] button[type=submit]`);
    await p.waitFor(
      `${rows}.length === 6 && !document.querySelector('[role=dialog]')`,
    );
    expect(
      await p.eval(
        `document.body.innerText.includes("Choose a future snooze time")`,
      ),
    ).toBe(false);
  });
  await test.step("R2-inbox-D1: U three times fast ends unread here and in Jira, though Jira would apply overlapping writes out of order", async () => {
    // The second write waits in Jira: sent at once, the read lands after the last unread.
    await fixture.reset({ inboxWriteDelays: [0, 600, 0] });
    await p.click(`[data-inbox-row*="issue/4"]`);
    await p.waitFor(`${current}.startsWith("Read TEST-4")`);
    for (const state of ["Unread", "Read", "Unread"]) {
      await p.key("u");
      await p.waitFor(`${current}.startsWith("${state} TEST-4")`);
    }
    await sleep(1500); // every write, the held one too, has landed: Jira must still end unread
    expect(await jiraUnread(4)).toBe(true);
    expect(await p.eval<string>(current)).toStartWith("Unread TEST-4");
  });
  await test.step("R2-inbox-D3: undo history is this tab's own: a reload keeps it, another tab loaded after the edit has nothing to undo", async () => {
    const undoOff = `document.querySelector('[aria-label="Undo"]').disabled`;
    const commented = `document.querySelector('[data-comment]')?.textContent.includes("Edit in another tab")`;
    await p.goto("?issue=TEST-2&view=page");
    await p.waitFor(`!!document.getElementById('comment')`);
    await p.click("#comment");
    await p.type("Edit in another tab");
    await p.key("Enter", "meta");
    await p.waitFor(commented);
    await p.waitFor(
      `!${undoOff} && document.querySelector('[aria-label="Local save status"]')?.textContent==="Saved locally"`,
    );
    await p.reload();
    await p.waitFor(`${commented} && !${undoOff}`);
    // Another tab: same saved edits, its own (empty) sessionStorage.
    await p.eval(`sessionStorage.clear()`);
    await p.reload();
    await p.waitFor(commented);
    expect(await p.eval(undoOff)).toBe(true);
    await p.key("z", "meta");
    await sleep(300); // ⌘Z must undo nothing
    expect(await p.eval(commented)).toBe(true);
  });
});

test("a long inbox: older pages on scroll, undo by Z and toast, the row menu, ⌥U and Delete all past page 1", async ({
  open,
}) => {
  await test.step("Older notifications load on scroll; Z and the toast undo delete, snooze and read; ⌫ deletes; the row menu", async () => {
    const p = await fresh(open, { inboxExtra: 40 });
    await p.waitFor(`${rows}.length === 20`);
    await sleep(300); // the end of the list is out of view: no older page loads
    expect(await p.eval(`${rows}.length`)).toBe(20);
    await p.eval(`document.querySelector('[data-inbox-end]').scrollIntoView()`);
    await p.waitFor(`${rows}.length === 40`);
    await p.eval(`document.querySelector('[data-inbox-end]').scrollIntoView()`);
    await p.waitFor(`${rows}.length === 47`);
    const gets = (await fixture.log()).requests
      .filter((r) => r.method === "GET" && r.path.startsWith("/api/inbox"))
      .map((r) => r.path);
    expect(gets).toContain("/api/inbox?after=20");
    expect(gets).toContain("/api/inbox?after=40");
    await p.eval(`document.querySelector('[data-inbox-row]').scrollIntoView()`);
    // E deletes with Linear's toast; Z brings the row back and selects it again.
    await p.key("j");
    await p.waitFor(`${current}.startsWith("Read TEST-2")`);
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
    // BJ-47: the header's bell toggles the subscription to the open issue.
    const bell = `document.querySelector(':is([aria-label="Unsubscribe from issue"],[aria-label="Subscribe to issue"]):not(.issue-activity *)')?.getAttribute("aria-label")`;
    const before = await p.waitFor<string>(bell);
    await p.click(`[aria-label="${before}"]:not(.issue-activity *)`);
    await p.waitFor(`${bell} && ${bell} !== ${JSON.stringify(before)}`);
    // Right-click: Linear's row menu, acting on that row without selecting it.
    await p.eval(rowMenu(3));
    await p.waitFor(
      `["Mark as read","Delete notification","Snooze","Favorite","Copy"].every(v=>document.querySelector('[role=dialog][aria-label="Notification options"] [cmdk-item][data-value="'+v+'"]'))`,
    );
    await p.click(`[cmdk-item][data-value="Favorite"]`);
    await p.waitFor(
      `!document.querySelector('[aria-label="Notification options"]')`,
    );
    await p.eval(rowMenu(3));
    await p.waitFor(
      `!!document.querySelector('[cmdk-item][data-value="Remove from favorites"]')`,
    );
    await p.click(`[cmdk-item][data-value="Delete notification"]`);
    await p.waitFor(
      `${rows}.length === 46 && !${rowText}.some(l=>l.includes("TEST-3")) && ${current}.includes("TEST-2")`,
    );
    // Deletes and snoozes are this browser's own (Jira has neither); they survive a reload.
    await p.reload();
    await p.waitFor(
      `${rows}.length === 19 && !${rowText}.some(l=>l.includes("TEST-3"))`,
    );
  });
  const p = await fresh(open, { inboxExtra: 40, inboxExtraUnread: true });
  await test.step("The badge counts unread rows past page 1; ⌥U then Z restores every one of them in Jira", async () => {
    await p.waitFor(`${rows}.length === 20`);
    // 5 + 13 unread rows are loaded; Jira has 45.
    await p.waitFor(`${badge} === "45"`);
    await p.key("u", "alt");
    await p.waitFor(
      `${badge} === "" && ${rowText}.every(l=>l.startsWith("Read"))`,
    );
    await p.key("z");
    await p.waitFor(`${badge} === "45"`);
  });
  await test.step("R2-inbox-D2: Delete all hides older pages too, and Z brings every row back", async () => {
    await p.reload();
    await p.waitFor(`${rows}.length === 20 && ${badge} === "45"`);
    await p.click(`[aria-label="Notification actions"]`);
    await p.click(`[cmdk-item][data-value="Delete all"]`);
    // R3-inbox-D6: Linear's confirmation dialog, not the browser's confirm().
    const confirmDialog = `[role=dialog][aria-label="Delete all notifications?"]`;
    await p.waitFor(`document.querySelector('${confirmDialog}')?.innerText.includes("This will delete all notifications in your inbox.")`);
    await p.click(`${confirmDialog} button[data-autofocus]`);
    await p.waitFor(`document.body.innerText.includes("No notifications")`);
    await sleep(1000); // no older page may bring rows back
    expect(await p.eval(`${rows}.length`)).toBe(0);
    expect(await p.eval(badge)).toBe("");
    await p.key("z");
    await p.waitFor(`${rows}.length === 47 && ${badge} === "45"`);
  });
});

test("BJ-192 8.8 8.9: filter values: fewer than ten inline with no zero counts; ten or more behind Linear's footer", async ({ open }) => {
  await fixture.reset({
    writable: true,
    catalog: { users: ["Ada Example", "Ben Example", "Cy Example", "Dee Example", "Eve Example", "Fay Example", "Gus Example", "Hal Example", "Ivy Example", "Jo Example"] },
  });
  const p = await open("?inbox=1");
  await p.waitFor(`${rows}.length > 0`);
  const footer = '[cmdk-item][data-value^="Show "][data-value$="with no matches"]';
  await test.step("Issue status type: all seven values inline; one nothing matches shows no count", async () => {
    await p.click("#inbox-filter");
    await p.hover('[cmdk-item][data-value="Issue status type"]');
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="Duplicate"]')`);
    expect(await p.eval(`!!document.querySelector('${footer}')`)).toBe(false);
    expect(await p.eval(`document.querySelector('[cmdk-item][data-value="Duplicate"] .menu-hint')`)).toBe(null);
    await p.key("Escape");
  });
  await test.step("From: matched senders, the footer; revealed, a divider, the rest without counts and the field's name as the search placeholder", async () => {
    await p.click("#inbox-filter");
    await p.hover('[cmdk-item][data-value="From"]');
    await p.waitFor(`!!document.querySelector('${footer}')`);
    expect(await p.eval(`!!document.querySelector('[cmdk-item][data-value="Ada Example"]')`)).toBe(false);
    await p.click(footer);
    await p.waitFor(`!!document.querySelector('[cmdk-item][data-value="Ada Example"]')`);
    expect(await p.eval(`!!document.querySelector('${footer}')`)).toBe(false);
    expect(await p.eval(`document.querySelector('[cmdk-item][data-value="Ada Example"] .menu-hint')`)).toBe(null);
    expect(
      await p.eval(`(()=>{const items=[...document.querySelectorAll('[cmdk-item]')],ada=items.find(n=>n.dataset.value==="Ada Example");return ada.previousElementSibling?.hasAttribute('cmdk-separator')||ada.parentElement.querySelector('[cmdk-separator]')!==null})()`),
    ).toBe(true);
    expect(
      await p.eval(`[...document.querySelectorAll('[cmdk-input]')].map(i=>i.placeholder).includes('From')`),
    ).toBe(true);
  });
});

test("prod parity: a group's earlier notifications unfold in the pane, and a comment notification opens at its comment", async ({ open }) => {
  const p = await fresh(open, { writable: true, threadedComments: true });
  await p.waitFor(`${rows}.length === 7`);
  await test.step("#14/#16: the row marks the issue type and how many updates Jira folded in", async () => {
    expect(await p.eval(`document.querySelector('[data-inbox-row*="issue/9"] [data-inbox-more]')?.textContent`)).toBe("+2");
    expect(await p.eval(`document.querySelector('[data-inbox-row*="issue/9"] [data-inbox-more]')?.title`)).toBe(
      "+2 updates from Kim and others",
    );
  });
  await test.step("#15: outside the mirror, the pane lists the group's notifications with the comment", async () => {
    await p.click(`[data-inbox-row*="issue/9"]`);
    await p.waitFor(`document.body.innerText.includes("+2 updates from Kim and others")`);
    await p.click(`button[aria-label="Show grouped notifications"]`);
    await p.waitFor(`document.querySelectorAll('[data-inbox-note]').length === 3`);
    const text = await p.eval<string>(`document.querySelector('[aria-label="Notifications on this issue"]').innerText`);
    expect(text).toContain("Kim commented");
    expect(text).toContain("Earlier comment");
    expect(text).toContain("Status updated by Lee: To Do → Doing");
    // R3 G20: the feed sent the group's first page with the row, so it opened without a request of its own.
    expect((await fixture.log()).requests.some((r) => r.path.startsWith("/api/inbox/group"))).toBe(false);
  });
  await test.step("#15: above an open issue, the same list", async () => {
    await p.click(`[data-inbox-row*="issue/2"]`);
    await p.waitFor(`document.body.innerText.includes("+1 update from Alex")`);
    await p.click(`button[aria-label="Show grouped notifications"]`);
    await p.waitFor(`document.querySelectorAll('[data-inbox-note]').length === 2`);
    // R3 G15 #27: the group scrolls with the issue in one scroller, so a long group never hides the issue.
    expect(await p.eval(`!!document.querySelector('[data-inbox-issue-group]')?.closest('.issue-detail-body')`)).toBe(true);
    // R3 G15: no board position counter in the inbox's issue header (Linear's is the issue list's own).
    expect(await p.eval(`!!document.querySelector('[aria-label="Issue position"]')`)).toBe(false);
  });
  await test.step("#9/#13: a comment notification opens the issue at the comment Jira links to", async () => {
    await p.click(`[data-inbox-row*="issue/4"]`);
    await p.waitFor(`location.hash === "#comment-10101" && !!document.querySelector('[data-comment="10101"]')`);
    expect(await p.eval(`document.querySelector('[data-inbox-row*="issue/4"]').getAttribute("href")`)).toContain(
      "focusedCommentId=10101",
    );
  });
});

test("R3 G22 #29: outside the mirror, the pane's head comment card is three lines at most, even for a long rich comment", async ({ open }) => {
  const p = await fresh(open, { inboxRichOutside: true });
  await p.click(`[data-inbox-row*="issue/9"]`);
  const clamp = `document.querySelector('[data-comment-card] [data-lines]')`;
  await p.waitFor(`${clamp}?.textContent.includes("Made-up finding 1")`);
  const box = await p.eval<{ height: number; line: number; full: number }>(
    // One line's height: the first character's box (the small variant's line-height is "normal").
    `(()=>{const e=${clamp},t=document.createTreeWalker(e,NodeFilter.SHOW_TEXT).nextNode(),r=document.createRange();r.setStart(t,0);r.setEnd(t,1);return {height:e.getBoundingClientRect().height,line:r.getBoundingClientRect().height,full:e.scrollHeight}})()`,
  );
  // Clamped: at most three lines tall, while the comment itself runs much longer.
  expect(box.height).toBeLessThanOrEqual(box.line * 3 + 1);
  expect(box.full).toBeGreaterThan(box.line * 3 + 1);
});

