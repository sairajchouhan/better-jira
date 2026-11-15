/**
 * Every lazy chunk is a loadable: fetched once on first use, and fetched anyway at idle after start-up, so a later
 * rebuild of dist/app can't break the tab. Linear's ComponentLoader (startup-entry.Dt5YDWdY.js `F8.protectedLoadable`):
 * each loadable is filed under its `preloadOrder` (`"last"` = `P8` 9000, larger numbers clamp to it, `"skip"` is never
 * preloaded; routes default to 500); LoadApplicationLayout.C6gKgsF9.js `Tr` then walks them in order, one per
 * `requestIdleCallback`, skipping the walk while offline and logging a failure without stopping.
 */
import { retryImport } from "./chunk-reload";

export type PreloadOrder = number | "last" | "skip";
const LAST = 9000;
/** Linear's default for a lazy route (`e.handle?.preloadOrder??500`). */
export const ROUTE_ORDER = 500;

export type Loadable<T> = {
  /** Fetches the chunk once; a failed fetch is forgotten, so the next use asks again. */
  load: () => Promise<T>;
  /** The module once loaded, so a later render needn't suspend. */
  loaded: () => T | undefined;
};
export type IdlePreload = {
  /** Linear's gate: no navigation under way and no menu open; otherwise the walk waits for the next idle period. */
  canPreload: () => boolean;
  online?: () => boolean;
  idle?: (run: () => void) => void;
  log?: (message: string, detail?: object) => void;
};
type Entry = { name: string; order: number; preload: () => Promise<unknown>; walked: boolean };

const whenIdle = (run: () => void) =>
  typeof requestIdleCallback === "function" ? void requestIdleCallback(() => run()) : void setTimeout(run, 200);

export function createLoadables(load: typeof retryImport = retryImport) {
  const startup: Entry[] = [];
  const preloadAtStartup = (name: string, order: number | "last", preload: () => Promise<unknown> | undefined) =>
    void startup.push({ name, order: order === "last" ? LAST : Math.min(order, LAST), preload: async () => preload(), walked: false });
  return {
    loadable<T>(name: string, factory: () => Promise<T>, preloadOrder: PreloadOrder = ROUTE_ORDER): Loadable<T> {
      let pending: Promise<T> | undefined, value: T | undefined;
      const fetch = () =>
        (pending ??= load(factory).then(
          (module) => (value = module),
          (error: unknown) => {
            pending = undefined;
            throw error;
          },
        ));
      if (preloadOrder !== "skip") preloadAtStartup(name, preloadOrder, fetch);
      return { load: fetch, loaded: () => value };
    },

    /** Files a preload of its own in the walk: a lazy route's `preload`, so its component renders without suspending
     *  (Linear files each lazy route's `e.lazy` the same way). */
    preloadAtStartup,

    /** Preloads every registered loadable by order, one per idle period. Resolves when the walk ends. */
    preloadAtIdle({
      canPreload,
      online = () => navigator.onLine !== false,
      idle = whenIdle,
      log = (message, detail) => console.debug(message, detail ?? ""),
    }: IdlePreload): Promise<void> {
      return new Promise((done) => {
        const run = async () => {
          // The lowest order not yet walked, first registered first, as Linear's per-order lists keep it. Read live, so
          // a loadable registered by a chunk this walk loaded (the emoji data inside the editor) joins the walk.
          const entry = startup.reduce<Entry | undefined>(
            (best, e) => (!e.walked && (!best || e.order < best.order) ? e : best),
            undefined,
          );
          if (!entry) return done();
          entry.walked = true;
          try {
            await entry.preload();
          } catch (error) {
            log("Failed preloading startup loadable", { name: entry.name, error });
          }
          next();
        };
        const next = () => {
          if (!online()) {
            log("Skipping preloading startup loadable as client is offline");
            return done();
          }
          idle(() => (canPreload() ? void run() : next()));
        };
        next();
      });
    },

    /** The registered loadables in walk order. */
    startupLoadables: () => startup.toSorted((a, b) => a.order - b.order).map(({ name, order }) => ({ name, order })),
  };
}

const app = createLoadables();
export const loadable = app.loadable;
export const preloadAtIdle = app.preloadAtIdle;
export const preloadAtStartup = app.preloadAtStartup;
export const startupLoadables = app.startupLoadables;
