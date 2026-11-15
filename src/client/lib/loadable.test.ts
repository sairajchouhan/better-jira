import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createLoadables, ROUTE_ORDER } from "./loadable";

const passThrough = <T,>(load: () => Promise<T>) => load();
/** Runs idle callbacks on demand, as the browser would between frames. */
function idleQueue() {
  const queue: (() => void)[] = [];
  return {
    idle: (run: () => void) => void queue.push(run),
    /** Runs one idle period and lets its preload finish. */
    async tick() {
      queue.shift()?.();
      for (let i = 0; i < 3; i++) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    get waiting() {
      return queue.length;
    },
  };
}

test("a loadable fetches once, keeps the module, and forgets a failure so the next use asks again", async () => {
  const { loadable } = createLoadables(passThrough);
  let calls = 0,
    fail = true;
  const chunk = loadable("x", async () => {
    calls++;
    if (fail) throw new Error("gone");
    return { value: 1 };
  });
  expect(chunk.load()).rejects.toThrow("gone");
  await new Promise((resolve) => setTimeout(resolve, 0));
  fail = false;
  const [a, b] = await Promise.all([chunk.load(), chunk.load()]);
  expect(a).toBe(b);
  expect(chunk.loaded()).toEqual({ value: 1 });
  expect(calls).toBe(2);
});

test("the walk goes by order, one loadable per idle period, skipping `skip` and clamping to `last`", async () => {
  const { loadable, preloadAtIdle, startupLoadables } = createLoadables(passThrough);
  const fetched: string[] = [];
  const add = (name: string, order?: Parameters<typeof loadable>[2]) =>
    loadable(name, async () => void fetched.push(name), order);
  add("grammar", "last");
  add("route");
  add("huge", 20_000);
  add("editor", 10);
  add("never", "skip");
  add("filters", 30);
  add("issue", 10);
  expect(startupLoadables()).toEqual([
    { name: "editor", order: 10 },
    { name: "issue", order: 10 },
    { name: "filters", order: 30 },
    { name: "route", order: ROUTE_ORDER },
    { name: "grammar", order: 9000 },
    { name: "huge", order: 9000 },
  ]);
  const idle = idleQueue();
  let finished = false;
  void preloadAtIdle({ canPreload: () => true, online: () => true, idle: idle.idle, log: () => {} }).then(() => (finished = true));
  await idle.tick();
  expect(fetched).toEqual(["editor"]);
  for (let i = 0; i < 6; i++) await idle.tick();
  expect(fetched).toEqual(["editor", "issue", "filters", "route", "grammar", "huge"]);
  expect(finished).toBe(true);
});

test("the walk waits while a navigation runs or a menu is open", async () => {
  const { loadable, preloadAtIdle } = createLoadables(passThrough);
  const fetched: string[] = [];
  loadable("a", async () => void fetched.push("a"), 10);
  const idle = idleQueue();
  let busy = true;
  void preloadAtIdle({ canPreload: () => !busy, online: () => true, idle: idle.idle, log: () => {} });
  await idle.tick();
  await idle.tick();
  expect(fetched).toEqual([]);
  expect(idle.waiting).toBe(1);
  busy = false;
  await idle.tick();
  expect(fetched).toEqual(["a"]);
});

test("offline, the walk stops; a failed preload is logged and the walk goes on", async () => {
  const { loadable, preloadAtIdle } = createLoadables(passThrough);
  const fetched: string[] = [],
    logs: string[] = [];
  loadable("broken", () => Promise.reject(new Error("gone")), 10);
  loadable("fine", async () => void fetched.push("fine"), 20);
  const idle = idleQueue();
  let online = true;
  void preloadAtIdle({ canPreload: () => true, online: () => online, idle: idle.idle, log: (m) => void logs.push(m) });
  await idle.tick();
  await idle.tick();
  expect(fetched).toEqual(["fine"]);
  expect(logs).toContain("Failed preloading startup loadable");

  const later = createLoadables(passThrough);
  later.loadable("x", async () => void fetched.push("x"), 10);
  online = false;
  const done = later.preloadAtIdle({ canPreload: () => true, online: () => online, idle: idle.idle, log: (m) => void logs.push(m) });
  await done;
  expect(fetched).toEqual(["fine"]);
  expect(logs).toContain("Skipping preloading startup loadable as client is offline");
});

test("a loadable registered by a chunk the walk loaded joins the walk", async () => {
  const { loadable, preloadAtIdle } = createLoadables(passThrough);
  const fetched: string[] = [];
  loadable(
    "editor",
    async () => {
      fetched.push("editor");
      loadable("emoji", async () => void fetched.push("emoji"), 100);
    },
    10,
  );
  loadable("route", async () => void fetched.push("route"));
  const idle = idleQueue();
  void preloadAtIdle({ canPreload: () => true, online: () => true, idle: idle.idle, log: () => {} });
  for (let i = 0; i < 3; i++) await idle.tick();
  expect(fetched).toEqual(["editor", "emoji", "route"]);
});

test("the highlighter is registered ahead of its grammars, all last in the walk", async () => {
  const { GRAMMARS, highlighterChunk } = await import("@/client/features/editor/code-grammars");
  const { startupLoadables } = await import("./loadable");
  const names = startupLoadables().map((entry) => entry.name);
  expect(highlighterChunk.loaded()).toBeUndefined();
  const grammars = names.filter((name) => name.startsWith("grammar:"));
  expect(new Set(Object.values(GRAMMARS).map(([name]) => `grammar:${name}`))).toEqual(new Set(grammars));
  expect(names.indexOf("code-highlight")).toBeLessThan(names.indexOf(grammars[0]!));
  expect(startupLoadables().filter((entry) => entry.name.startsWith("grammar:")).every((entry) => entry.order === 9000)).toBe(true);
});

// Every dynamic import is a loadable (so the idle walk fetches it and a gone chunk reloads safely) or goes through
// retryImport. These three are the exceptions, and why.
const ALLOWED = new Map([
  ["client/App.tsx", "router devtools: development only, dropped from production builds"],
  ["client/components/error-boundary.tsx", "the backup must work when the module graph is broken; local-database is already loaded at start-up"],
  ["client/state/jira-media.ts", "local-database is already loaded at start-up (app-load imports it), so nothing is fetched"],
]);
test("every dynamic import in src goes through a loadable or retryImport", () => {
  const root = path.join(import.meta.dir, "..", "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const relative = path.relative(root, file);
        if (ALLOWED.has(relative)) continue;
        const code = readFileSync(file, "utf8");
        for (const match of code.matchAll(/import\(\s*["'][^"']+["']\s*\)/g)) {
          const before = code.slice(Math.max(0, match.index - 160), match.index),
            after = code.slice(match.index + match[0].length);
          // A type position (`import("x").Name`, `typeof import("x")`) fetches nothing.
          if (/typeof\s*$/.test(before) || /^\.(?!then\b)\w/.test(after)) continue;
          const statement = before.slice(before.lastIndexOf(";") + 1);
          if (!/\b(loadable|retryImport|grammar)\(/.test(statement))
            offenders.push(`${relative}:${code.slice(0, match.index).split("\n").length}`);
        }
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
