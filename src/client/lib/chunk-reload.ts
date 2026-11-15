/**
 * A lazy chunk that has gone (`bun start` rebuilt dist/app under new hashed names while this tab was open) reloads the
 * tab once its writes are safe, at most a couple of times. Linear's guard, from startup-entry.Dt5YDWdY.js:
 * - `M8` (a dynamic import failed): reload only when online, not already tried on this page (`y8`, the
 *   `sw-cache-recovery-attempted` flag) and under `b8` = 2 tries (`chunk-failure-reload-attempts`), both kept in
 *   sessionStorage so they survive the reload.
 * - `loadingDone`: one minute (`FSe`) after a clean load with no chunk failure, `GSe` renews the budget.
 * - `reloadAfterPendingWrites`: waits for queued writes to flush, and until a minute after the last `beforeunload`
 *   (`N8` sets `x8`), then reloads.
 * - From `recordConnectionLostReload` (Linear's database-lost reload): no second reload within 5 minutes (`tEe`), and none
 *   at all when sessionStorage won't keep the timestamp (read back), so a browser that drops it cannot loop.
 */

const MAX_TRIES = 2;
const RENEW_AFTER = 60_000;
const UNLOAD_GRACE = 60_000;
const RELOAD_GAP = 5 * 60_000;
const SETTLE_POLL = 250;
const ATTEMPTED = "chunk-reload-attempted";
const TRIES = "chunk-reload-attempts";
const RELOADED_AT = "chunk-reload-at";

/** TanStack Router's `isModuleNotFoundError` prefixes (router-core utils.js): Chromium, Firefox and Safari. */
const MISSING = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
];
export const isChunkMissing = (error: unknown) => {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" && MISSING.some((prefix) => message.startsWith(prefix));
};

/** Thrown in place of the browser's error, so TanStack's `lazyRouteComponent` doesn't reload on its own, unguarded. */
export class ChunkGoneError extends Error {
  constructor(cause: unknown, reloading: boolean) {
    super(reloading ? "This tab is out of date. Reloading…" : "This tab is out of date. Reload to continue.", { cause });
    this.name = "ChunkGoneError";
  }
}

export type ChunkReloadPorts = {
  /** sessionStorage, or a getter that throws where the browser refuses it. */
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem">;
  online: () => boolean;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (timer: unknown) => void;
  reload: () => void;
  log: (message: string, detail?: object) => void;
};

export function createChunkReload(ports: ChunkReloadPorts) {
  const read = (key: string) => {
    try {
      return ports.storage().getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string | null) => {
    try {
      if (value === null) ports.storage().removeItem(key);
      else ports.storage().setItem(key, value);
    } catch {}
  };
  let attempted = read(ATTEMPTED) === "true",
    tries = Number.parseInt(read(TRIES) ?? "0", 10) || 0,
    failures = 0,
    unloadingUntil = 0,
    reloading = false,
    renewal: unknown,
    settled = () => true;

  const reloadAfterPendingWrites = async () => {
    for (;;) {
      while (!settled()) await ports.sleep(SETTLE_POLL);
      while (ports.now() < unloadingUntil) await ports.sleep(Math.max(0, unloadingUntil - ports.now()));
      if (settled()) break;
    }
    ports.log("Reloading after a missing chunk", { attempt: tries });
    ports.reload();
  };

  return {
    /** A chunk import failed with a missing-module error. True when a reload is under way. */
    failed(error: unknown): boolean {
      failures++;
      ports.log(`Failed loading dynamic import (${ports.online() ? "online" : "offline"})`, { error });
      if (reloading) return true;
      if (!ports.online()) return false;
      if (attempted || tries >= MAX_TRIES) {
        ports.log("Not reloading for a missing chunk: tries used up", { attempts: tries });
        return false;
      }
      const last = Number(read(RELOADED_AT));
      if (last && ports.now() - last < RELOAD_GAP) {
        ports.log("Not reloading for a missing chunk: reloaded moments ago", { sinceLastReload: ports.now() - last });
        return false;
      }
      attempted = true;
      tries++;
      const at = String(ports.now());
      write(ATTEMPTED, "true");
      write(TRIES, String(tries));
      write(RELOADED_AT, at);
      if (read(RELOADED_AT) !== at) {
        ports.log("Not reloading for a missing chunk: sessionStorage can't keep the guard");
        return false;
      }
      reloading = true;
      void reloadAfterPendingWrites().catch(() => (reloading = false));
      return true;
    },
    /** The app finished loading: a minute on with no chunk failure, the tries are renewed (Linear's `loadingDone`). */
    loadingDone() {
      ports.clearTimer(renewal);
      renewal = ports.setTimer(() => {
        if (failures) return;
        attempted = false;
        tries = 0;
        write(ATTEMPTED, null);
        write(TRIES, null);
      }, RENEW_AFTER);
    },
    /** `beforeunload` fired: the page may be leaving, so a reload waits a minute (Linear's `N8`). */
    unloading() {
      unloadingUntil = ports.now() + UNLOAD_GRACE;
    },
    /** What must hold before reloading: no local save running or failed, no Jira write unsent. */
    whenSettled(predicate: () => boolean) {
      settled = predicate;
    },
  };
}

const browser = typeof window !== "undefined";
export const chunkReload = createChunkReload({
  storage: () => sessionStorage,
  online: () => !browser || navigator.onLine !== false,
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  reload: () => location.reload(),
  log: (message, detail) => console.info(message, detail ?? ""),
});
if (browser) addEventListener("beforeunload", () => chunkReload.unloading());

/**
 * Every lazy import goes through this. A chunk that has gone starts the guarded reload and rejects with a
 * `ChunkGoneError`; any other failure rejects unchanged. Linear's import rejects too: a promise that never settled would
 * hang the screen whenever writes never settle.
 */
export async function retryImport<T>(load: () => Promise<T>, reload = chunkReload): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (!isChunkMissing(error)) throw error;
    throw new ChunkGoneError(error, reload.failed(error));
  }
}
