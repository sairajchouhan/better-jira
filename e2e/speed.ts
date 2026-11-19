/** The app's core actions, each timed inside the page from the user's input to the frame that shows its result. Shared by
 *  `bun run speed` (scripts/speed.ts) and the e2e speed budget (speed-budget.e2e.ts).
 *
 *  The clock: a capture listener on window takes the trusted input event's `timeStamp` (on the page's performance clock), and
 *  the action is done in the first frame after its condition holds: checked on every DOM mutation and every animation frame,
 *  then one `requestAnimationFrame` and a task after it, which runs once that frame is painted. Nothing crosses the automation
 *  channel inside the timed span. A cold open counts from the navigation's time origin. */
import type { Browser, Page } from "@playwright/test";

/** The input events a timed span can start on: the one the app acts on (a click's `click`, a key's `keydown`, typing's `input`). */
type StartEvent = "click" | "keydown" | "input";

/** Installs `window.speedClock` in the page. Runs as an init script, so it is there before the app's first line. */
export function speedTimer() {
  const w = window as any;
  if (w.speedClock) return;
  let run: any = null;
  const check = () => {
    if (!run || run.start === undefined || run.seen !== undefined || !run.done()) return;
    run.seen = performance.now();
    const r = run;
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        r.end = performance.now();
        performance.measure(`speed:${r.label}`, { start: r.start, end: r.end });
        r.resolve({ ms: r.end - r.start, start: r.start, seen: r.seen, end: r.end });
      };
      channel.port2.postMessage(null);
    });
  };
  const frames = () => {
    if (!run || run.end !== undefined) return;
    check();
    requestAnimationFrame(frames);
  };
  for (const type of ["click", "keydown", "input"])
    addEventListener(
      type,
      (e) => {
        if (run && run.start === undefined && e.isTrusted && run.events.includes(e.type)) {
          run.start = e.timeStamp;
          queueMicrotask(check);
        }
      },
      true,
    );
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  const arm = (label: string, done: () => boolean, events: string[] | null) => {
    if (done()) throw new Error(`speed ${label}: already done before the input`);
    let resolve: (r: unknown) => void = () => {};
    const promise = new Promise((r) => (resolve = r));
    run = { label, done, events: events ?? [], resolve, promise, start: events ? undefined : 0 };
    requestAnimationFrame(frames);
  };
  w.speedClock = {
    arm,
    /** The armed span's result; rejects after `timeout` ms naming what never happened. */
    result: (timeout: number) =>
      Promise.race([
        run.promise,
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(`speed ${run.label}: ${run.start === undefined ? "the input never arrived" : "the result never showed"}`),
              ),
            timeout,
          ),
        ),
      ]),
    /** The run's start, for spans that end on a later event (the status write's answer). */
    started: () => run?.start,
  };
}

/** Times `act` from the input it sends until `done(arg)` holds in the page and a frame shows it. */
export async function timed<A>(
  page: Page,
  label: string,
  done: (arg: A) => boolean,
  arg: A,
  start: StartEvent,
  act: () => Promise<unknown>,
  timeout = 20_000,
): Promise<number> {
  await page.evaluate(
    `window.speedClock.arm(${JSON.stringify(label)}, () => (${done})(${JSON.stringify(arg)}), ${JSON.stringify([start])})`,
  );
  await act();
  const { ms } = (await page.evaluate(`window.speedClock.result(${timeout})`)) as { ms: number };
  return ms;
}

// Done conditions. They run in the page, so they use only their argument and the DOM.

/** A board card, the first thing a user can act on. */
function cardShows() {
  return [...document.querySelectorAll("[role=grid] [role=row]")].some((r) => r.getClientRects().length > 0);
}
/** The issue panel shows `key` with its title. */
function issueShows({ key, title }: { key: string; title: string }) {
  const box = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Issue title"]');
  return (
    !!box && box.getClientRects().length > 0 && box.value === title && new URL(location.href).searchParams.get("issue") === key
  );
}
/** The panel is closed. */
function issueClosed() {
  return !document.querySelector('textarea[aria-label="Issue title"]');
}
/** Board `id` is open and shows a card only it holds. */
function boardShows({ id, keys }: { id: number; keys: string[] }) {
  if (!location.pathname.startsWith(`/board/${id}/`)) return false;
  return [...document.querySelectorAll("[role=grid] [role=row]")].some(
    (r) => r.getClientRects().length > 0 && keys.includes((r.getAttribute("aria-label") ?? "").split(" ")[0]!),
  );
}
/** Search lists `key` for exactly the query `q`. */
function searchFinds({ key, q }: { key: string; q: string }) {
  const dialog = document.querySelector('[role=dialog][aria-label="Search issues"]');
  const box = dialog?.querySelector<HTMLInputElement>('input[aria-label="Search issues"]');
  if (!dialog || box?.value !== q) return false;
  return [...dialog.querySelectorAll("[role=menuitem]")].some(
    (item) => item.getClientRects().length > 0 && (item.textContent ?? "").includes(key),
  );
}
/** `key`'s card sits in column `status` and its status control names it. */
function statusShows({ key, status }: { key: string; status: string }) {
  const control = document.querySelector(`[aria-label="Status on ${key}"]`);
  const column = control?.closest("[role=grid]");
  return !!control && control.getClientRects().length > 0 && control.getAttribute("title") === status && column?.getAttribute("aria-label") === status;
}

/** The boards and issues the running app holds (read over its API, outside any timed span). */
export type Dataset = {
  boards: { id: number; keys: string[] }[];
  issues: Map<string, { key: string; summary: string }>;
  total: number;
};
export async function readDataset(base: string): Promise<Dataset> {
  const [boards, issues] = (await Promise.all(
    ["/api/boards", "/api/issues"].map(async (path) => {
      const response = await fetch(base + path);
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      return response.json();
    }),
  )) as [{ id: number }[], { key: string; summary: string; boards: number[] }[]];
  return {
    boards: boards.map((b) => ({ id: b.id, keys: issues.filter((i) => i.boards.includes(b.id)).map((i) => i.key) })),
    issues: new Map(issues.map((i) => [i.key, i])),
    total: issues.length,
  };
}

/** The cards a board shows now, in order, as `KEY title` row names. */
const shownCards = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[role=grid] [role=row][aria-label]")]
      .filter((r) => r.getClientRects().length > 0)
      .map((r) => r.getAttribute("aria-label")!),
  );
const keyOf = (card: string) => card.split(" ")[0]!;
const boardUrl = (base: string, id: number) => `${base}/board/${id}/all`;

/** Waits, untimed, until `condition(arg)` holds. */
const until = <A>(page: Page, condition: (arg: A) => boolean, arg: A) =>
  page.waitForFunction(`(${condition})(${JSON.stringify(arg)})`, undefined, { timeout: 20_000 });

/** 1. Cold open: a fresh browser (no HTTP cache, no stored data) loads the board until a card shows. Then `reopen`: a reload of
 *  the same tab, with the stored data and HTTP cache the first load left. */
export async function coldOpen(browser: Browser, base: string, board: number, runs: number, { reopens = true } = {}) {
  const cold: number[] = [],
    reopen: number[] = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      await page.addInitScript(speedTimer);
      await page.addInitScript(`window.speedClock.arm("open", ${cardShows}, null)`);
      for (const into of reopens ? [cold, reopen] : [cold]) {
        if (into === cold) await page.goto(boardUrl(base, board));
        else await page.reload();
        const { ms } = (await page.evaluate("window.speedClock.result(30000)")) as { ms: number };
        into.push(ms);
        // Let the first load finish writing what it stores before the reload reads it back.
        if (reopens) await page.waitForTimeout(1500);
      }
    } finally {
      await context.close();
    }
  }
  return { cold, reopen };
}

/** Opens `base` on board `board` in `page` and waits until its cards show. */
export async function openBoard(page: Page, base: string, board: number) {
  await page.goto(boardUrl(base, board));
  await until(page, cardShows, null);
}

/** 2. Opening an issue: a click on a card's title until the panel shows that issue. Each run opens the next card, then closes. */
export async function openIssue(page: Page, data: Dataset, runs: number) {
  const cards = (await shownCards(page)).slice(0, Math.max(1, Math.min(runs, 8)));
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const key = keyOf(cards[i % cards.length]!);
    const title = data.issues.get(key)!.summary;
    const row = page.getByRole("row", { name: `${key} ${title}`, exact: true });
    samples.push(await timed(page, "open-issue", issueShows, { key, title }, "click", () => row.getByText(title, { exact: true }).click()));
    await page.keyboard.press("Escape");
    await until(page, issueClosed, null);
  }
  return samples;
}

/** 3. Moving between issues: with an issue open, J until the next issue shows, then K back. An untimed pass learns the order, so
 *  each timed step waits for the issue it should reach; a reload then forgets what that pass rendered, so every J lands on an
 *  issue not yet shown in this page, as on a first walk through a board. K steps back over those. */
export async function stepIssues(page: Page, data: Dataset, runs: number) {
  const board = Number(new URL(page.url()).pathname.split("/")[2]);
  const steps = Math.max(1, Math.min(runs, data.boards.find((b) => b.id === board)!.keys.length - 1));
  const openFirst = async () => {
    const [first] = await shownCards(page);
    const key = keyOf(first!);
    const title = data.issues.get(key)!.summary;
    await page.getByRole("row", { name: first, exact: true }).getByText(title, { exact: true }).click();
    await until(page, issueShows, { key, title });
    // Shortcuts act on the open issue while the pointer rests on its title, not on a card.
    await page.getByRole("textbox", { name: "Issue title" }).hover();
    return key;
  };
  const order = [await openFirst()];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("j");
    await page.waitForFunction((prev) => new URL(location.href).searchParams.get("issue") !== prev, order.at(-1));
    order.push(new URL(page.url()).searchParams.get("issue")!);
  }
  await page.goto(page.url().replace(/[?&]issue=[^&]*/, ""));
  await until(page, cardShows, null);
  await openFirst();
  const walk = [...order.slice(1).map((key) => ["j", key] as const), ...order.slice(0, -1).reverse().map((key) => ["k", key] as const)];
  const samples: number[] = [];
  for (const [press, key] of walk.slice(0, runs)) {
    const title = data.issues.get(key)!.summary;
    samples.push(await timed(page, `step-${press}`, issueShows, { key, title }, "keydown", () => page.keyboard.press(press)));
  }
  await page.keyboard.press("Escape");
  await until(page, issueClosed, null);
  return samples;
}

/** 4. Switching boards: a click on the other board in the sidebar until a card only that board holds shows. Alternates. */
export async function switchBoards(page: Page, data: Dataset, runs: number, from: number, to: number) {
  const only = (id: number, other: number) => {
    const theirs = new Set(data.boards.find((b) => b.id === other)!.keys);
    return data.boards.find((b) => b.id === id)!.keys.filter((k) => !theirs.has(k));
  };
  const keys = { [from]: only(from, to), [to]: only(to, from) };
  const samples: number[] = [];
  let target = to;
  for (let i = 0; i < runs; i++) {
    const link = page.locator(`nav a[href="/board/${target}/all"]`).first();
    samples.push(await timed(page, "switch-board", boardShows, { id: target, keys: keys[target]! }, "click", () => link.click()));
    target = target === to ? from : to;
  }
  if (target === from) await page.locator(`nav a[href="/board/${from}/all"]`).first().click();
  await until(page, boardShows, { id: from, keys: keys[from]! });
  return samples;
}

/** 5. Search: with Search open and all but the last letter typed, the last keystroke until the issue it names is listed. */
export async function search(page: Page, data: Dataset, runs: number) {
  const keys = (await shownCards(page)).slice(0, Math.max(1, Math.min(runs, 8))).map(keyOf);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const key = keys[i % keys.length]!;
    const q = data.issues.get(key)!.summary;
    await page.keyboard.press("/");
    const box = page.getByRole("dialog", { name: "Search issues" }).getByRole("textbox", { name: "Search issues" });
    await box.waitFor();
    await box.pressSequentially(q.slice(0, -1));
    await page.waitForTimeout(150);
    samples.push(await timed(page, "search", searchFinds, { key, q }, "keydown", () => box.press(q.at(-1)!)));
    await page.keyboard.press("Escape");
    await box.waitFor({ state: "detached" });
  }
  return samples;
}

/** 6. Changing status: picking another status in a card's status menu until the card shows it in that column, and the time
 *  until Jira answered the write (the app's `/ops` request ended). Every run goes there and back, so the issue ends as it began. */
export async function changeStatus(page: Page, key: string, runs: number) {
  const control = page.locator(`[aria-label="Status on ${key}"]`);
  const original = (await control.getAttribute("title"))!;
  const columns = await page.evaluate(() => [...document.querySelectorAll("[role=grid]")].map((g) => g.getAttribute("aria-label")!));
  const other = columns.find((c) => c !== original)!;
  const shown: number[] = [],
    saved: number[] = [];
  let current = original;
  const pick = async (status: string) => {
    await control.click();
    const item = page.getByRole("menuitem", { name: new RegExp(`^${status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) });
    await item.waitFor();
    shown.push(await timed(page, "status", statusShows, { key, status }, "click", () => item.click()));
    saved.push(await savedAfterStart(page, key));
    current = status;
  };
  try {
    for (let i = 0; i < runs; i++) await pick(current === original ? other : original);
  } finally {
    if (current !== original) await pick(original);
  }
  return { shown, saved };
}

/** Milliseconds from the timed span's input to the end of the first write for `key` sent after it, as the page saw it. */
const savedAfterStart = (page: Page, key: string) =>
  page.evaluate(
    (key) =>
      new Promise<number>((resolve, reject) => {
        const start = (window as any).speedClock.started();
        const path = `/api/issues/${encodeURIComponent(key)}/ops`;
        const find = () =>
          performance
            .getEntriesByType("resource")
            .find((e) => e.startTime >= start && new URL(e.name).pathname === path) as PerformanceResourceTiming | undefined;
        const give = setTimeout(() => reject(new Error(`no write for ${key} reached Jira`)), 30_000);
        const poll = () => {
          const entry = find();
          if (entry && entry.responseEnd > 0) {
            clearTimeout(give);
            resolve(entry.responseEnd - start);
          } else setTimeout(poll, 50);
        };
        poll();
      }),
    key,
  );

/** Nearest-rank percentile. */
export const percentile = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
};
