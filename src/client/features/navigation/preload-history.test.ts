import { afterEach, expect, test } from "bun:test";
import { get, set } from "@/client/state/store";
import { historyWarmer } from "@/client/features/issue/history-warm";
import { preloadOnHover, router } from "./app-navigation";

const realFetch = globalThis.fetch;
const before = (({ full, issues, boards, fullErrors }) => ({ full, issues, boards, fullErrors }))(get());
afterEach(() => {
  preloadOnHover(null);
  globalThis.fetch = realFetch;
  set(before);
});
const BOARD = 7;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const requests: string[] = [];
/** Issues whose details are already here (so the details read is skipped) and a server that records history reads. */
function setup(keys: string[]) {
  const full = new Map(get().full),
    issues = new Map(get().issues);
  for (const key of keys) {
    full.set(key, { key, fields: { updated: "t1" } } as never);
    issues.set(key, { key, summary: key, boards: [BOARD] } as never);
  }
  set({ full, issues, boards: [{ id: BOARD, name: "Wire" } as never] });
  const history: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(String(url));
    const match = /\/api\/issues\/([^/]+)\/history$/.exec(String(url));
    if (match) history.push(match[1]!);
    return new Response(match ? "[]" : "{}", { status: match ? 200 : 404 });
  }) as unknown as typeof fetch;
  return history;
}

test("the route's issue preload also reads the issue's Jira history", async () => {
  const history = setup(["WIRE-1"]);
  await router.options.context!.preload("WIRE-1");
  await sleep(10);
  expect(history).toEqual(["WIRE-1"]);
});

test("a pointer resting on an issue preloads its history; one sweeping over issues preloads none", async () => {
  const keys = Array.from({ length: 20 }, (_, i) => `SWEEP-${i}`);
  const history = setup([...keys, "REST-1"]);
  for (const [i, key] of keys.entries()) {
    preloadOnHover({ board: BOARD, selected: key, panel: true }, { x: 10, y: 10 + i * 40 });
    await sleep(10);
  }
  preloadOnHover(null);
  await sleep(200);
  expect(history).toEqual([]);
  preloadOnHover({ board: BOARD, selected: "REST-1", panel: true }, { x: 10, y: 10 });
  await sleep(200);
  expect(history).toEqual(["REST-1"]);
});

test("a j/k selection on an issue whose details Jira refused asks for neither its details nor its history again", async () => {
  setup([]);
  requests.length = 0;
  set({ fullErrors: new Map(get().fullErrors).set("BROKEN-1", "Could not load issue details") });
  historyWarmer.warmSoon("BROKEN-1");
  await sleep(250);
  expect(requests).toEqual([]);
});

test("the board's j/k selection and the inbox's next row call the shared warmer", async () => {
  const board = await Bun.file(new URL("../../routes/board-view.tsx", import.meta.url)).text();
  expect(board).toContain("historyWarmer.warmSoon(selected);");
  const inbox = await Bun.file(new URL("../../routes/inbox.tsx", import.meta.url)).text();
  expect(inbox).toContain("nextIssue(rows, selected, (key) => s.issues.has(key))");
  expect(inbox).toContain("if (nextKey) historyWarmer.warmSoon(nextKey);");
});
