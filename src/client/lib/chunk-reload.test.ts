import { expect, test } from "bun:test";
import { isModuleNotFoundError } from "@tanstack/router-core";
import { ChunkGoneError, createChunkReload, isChunkMissing, retryImport, type ChunkReloadPorts } from "./chunk-reload";

const MISSING = new TypeError("Failed to fetch dynamically imported module: https://x.test/dist/app/emoji-data-1a2b.js");

/** A tab on a fake clock: `storage` is its sessionStorage, carried into the next page by passing it on. */
function tab(options: { storage?: Map<string, string>; online?: boolean; drops?: boolean; refuses?: boolean } = {}) {
  const storage = options.storage ?? new Map<string, string>();
  const timers: { at: number; run: () => void }[] = [];
  let now = 1_000_000,
    reloads = 0,
    reloadedAt = 0;
  const ports: ChunkReloadPorts = {
    storage: () => {
      if (options.refuses) throw new Error("SecurityError");
      return {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => void (!options.drops && storage.set(key, value)),
        removeItem: (key) => void storage.delete(key),
      };
    },
    online: () => options.online ?? true,
    now: () => now,
    // A macrotask, as a real timer is: the wait loop must not starve the test.
    sleep: (ms) => new Promise((resolve) => setTimeout(() => resolve(void (now += Math.max(ms, 1))), 0)),
    setTimer: (run, ms) => timers.push({ at: now + ms, run }),
    clearTimer: () => {},
    reload: () => void (reloads++, (reloadedAt = now)),
    log: () => {},
  };
  const guard = createChunkReload(ports);
  return {
    guard,
    storage,
    reloads: () => reloads,
    reloadedAt: () => reloadedAt,
    now: () => now,
    advance(ms: number) {
      now += ms;
      for (const timer of timers.splice(0)) if (timer.at <= now) timer.run();
    },
    /** Lets the wait loop run a few turns. */
    settle: async () => {
      for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

test("isChunkMissing matches TanStack's three missing-module messages and nothing else", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://x.test/a.js",
    "error loading dynamically imported module: https://x.test/a.js",
    "Importing a module script failed.",
  ]) {
    expect(isChunkMissing(new TypeError(message))).toBe(true);
    expect(isModuleNotFoundError(new TypeError(message))).toBe(true);
  }
  expect(isChunkMissing(new Error("Network down"))).toBe(false);
  expect(isChunkMissing(null)).toBe(false);
});

test("retryImport passes modules and other errors through untouched", async () => {
  const t = tab();
  expect(await retryImport(async () => ({ value: 1 }), t.guard)).toEqual({ value: 1 });
  const other = new SyntaxError("Unexpected token");
  expect(retryImport(() => Promise.reject(other), t.guard)).rejects.toBe(other);
  await t.settle();
  expect(t.reloads()).toBe(0);
});

test("a missing chunk rejects with an error TanStack's lazyRouteComponent won't reload on, and reloads once writes settle", async () => {
  const t = tab();
  let settled = false;
  t.guard.whenSettled(() => settled);
  const error = await retryImport(() => Promise.reject(MISSING), t.guard).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ChunkGoneError);
  expect((error as Error).cause).toBe(MISSING);
  expect(isModuleNotFoundError(error)).toBe(false);
  await t.settle();
  expect(t.reloads()).toBe(0); // A Jira write is still unsent.
  settled = true;
  await t.settle();
  await t.settle();
  expect(t.reloads()).toBe(1);
  // A second failure on the same page doesn't start another reload.
  await retryImport(() => Promise.reject(MISSING), t.guard).catch(() => {});
  await t.settle();
  expect(t.reloads()).toBe(1);
});

test("a reload waits a minute after beforeunload", async () => {
  const t = tab();
  const start = t.now();
  t.guard.unloading();
  expect(t.guard.failed(MISSING)).toBe(true);
  await t.settle();
  expect(t.reloads()).toBe(1);
  expect(t.reloadedAt()).toBeGreaterThanOrEqual(start + 60_000);
});

test("offline, nothing reloads", async () => {
  const t = tab({ online: false });
  expect(t.guard.failed(MISSING)).toBe(false);
  await t.settle();
  expect(t.reloads()).toBe(0);
});

test("the reloaded page doesn't reload again until a clean load renews the budget", async () => {
  const first = tab();
  expect(first.guard.failed(MISSING)).toBe(true);
  // The reloaded page, same sessionStorage: already tried.
  const second = tab({ storage: first.storage });
  expect(second.guard.failed(MISSING)).toBe(false);
  // A third page loads cleanly; a minute on, the tries renew. Five minutes after the reload, one is allowed again.
  const third = tab({ storage: first.storage });
  third.guard.loadingDone();
  third.advance(60_000);
  expect(third.guard.failed(MISSING)).toBe(false); // Within five minutes of the last reload.
  const fourth = tab({ storage: first.storage });
  fourth.guard.loadingDone();
  fourth.advance(5 * 60_000);
  expect(fourth.guard.failed(MISSING)).toBe(true);
});

test("a page with a chunk failure doesn't renew the budget", () => {
  const first = tab();
  first.guard.failed(MISSING);
  first.guard.loadingDone();
  first.advance(10 * 60_000);
  expect(first.storage.get("chunk-reload-attempted")).toBe("true");
});

test("two tries at most, even when the per-page flag was lost", () => {
  const storage = new Map([["chunk-reload-attempts", "2"]]);
  const t = tab({ storage });
  expect(t.guard.failed(MISSING)).toBe(false);
});

test("no reload when sessionStorage can't keep the guard, so a broken browser can't loop", () => {
  expect(tab({ drops: true }).guard.failed(MISSING)).toBe(false);
  expect(tab({ refuses: true }).guard.failed(MISSING)).toBe(false);
});
