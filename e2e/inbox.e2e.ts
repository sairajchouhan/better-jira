import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);

/** Fresh feed per test; before the first open() the fixture is not up yet and is fresh anyway. */
const reset = () => fetch(`${APP}__fixture`, { method: "POST", body: "{}" }).catch(() => {});

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

test("Filter, unread-only and a notification outside the mirror", async () => {
  await reset();
  const p = await open("?inbox=1");
  try {
    await p.waitFor(`${rows}.length === 7`);
    await p.click(`[aria-label="Filter"]`);
    await p.click("text=Direct");
    await p.waitFor(`${rowText}.map(l=>l.split(' ')[1]).join() === "TEST-2,TEST-1,TEST-5"`);
    await p.click(`[aria-label="Filter"]`);
    await p.click("text=All notifications");
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
