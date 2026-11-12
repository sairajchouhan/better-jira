/**
 * Preferences kept in this browser's localStorage, per Jira site and account once `scopePreferences` names them. Reads
 * never throw: a missing, unreadable or malformed value reads as the default. Issue data lives in IndexedDB instead
 * (local-database.ts); a preference failure never touches it.
 */
import { parsePreferences, type Display, type Preferences } from "@/shared/view-model";
import type { View } from "./store";

const VIEWS = "better-jira:views:v1",
  SIDEBAR = "better-jira:sidebar",
  FAVORITES = "better-jira:favorites:v1",
  DEFAULTS = "better-jira:defaults:v1",
  SAVED_VIEWS = "better-jira:saved-views:v1",
  VIEW_DETAILS = "better-jira:view-details:v1",
  OWNER = "better-jira:preferences-owner";
let namespace = "";
const scoped = (key: string) => (namespace ? `${key}:${namespace}` : key);
function read(key: string): string | null {
  try {
    return localStorage.getItem(scoped(key));
  } catch {
    return null;
  }
}
function readJson<T>(key: string, fallback: T, parse: (value: any) => T): T {
  try {
    return parse(JSON.parse(read(key) ?? "null") ?? fallback);
  } catch {
    return fallback;
  }
}

/** Keys preferences by site and account from now on. The first account in this browser takes over the unscoped ones. */
export function scopePreferences(scope: string) {
  namespace = scope;
  try {
    const owner = localStorage.getItem(OWNER);
    if (!owner) localStorage.setItem(OWNER, scope);
    if (!owner || owner === scope)
      for (const key of [VIEWS, "board", "view", SAVED_VIEWS, FAVORITES, DEFAULTS]) {
        const old = localStorage.getItem(key);
        if (old !== null && localStorage.getItem(scoped(key)) === null)
          localStorage.setItem(scoped(key), old);
      }
  } catch {
    /* The mirror can still load if browser preferences are unavailable. */
  }
}

/** The board open last (NaN or 0 when none). */
export const savedBoard = () => Number(read("board"));
export const savedOpenIn = (): View => (read("view") === "page" ? "page" : "side");
/** Not per site: it is read before the site is known, so the first paint has the right layout. */
export function savedSidebarHidden() {
  try {
    return localStorage.getItem(SIDEBAR) === "hidden";
  } catch {
    return false;
  }
}
/** Each board's view preferences. */
export const savedViewPreferences = (): Record<number, Preferences> =>
  readJson(VIEWS, {}, (saved) =>
    Object.fromEntries(Object.entries(saved).map(([id, p]) => [id, parsePreferences(p)])),
  );
/** Each board's default display ("Save as default"). */
export const savedDefaults = (): Record<number, Display> =>
  readJson(DEFAULTS, {}, (saved) =>
    saved && typeof saved === "object" && !Array.isArray(saved)
      ? Object.fromEntries(
          Object.entries(saved).map(([id, display]) => [id, parsePreferences({ display }).display]),
        )
      : {},
  );
/** Throws when the browser refuses to store them. */
export function saveDefaults(defaults: Record<number, Display>) {
  localStorage.setItem(scoped(DEFAULTS), JSON.stringify(defaults));
}
/** Boards are favourited once, not per tab; older `board:<id>:<tab>` entries collapse into `board:<id>`. */
export const savedFavorites = (): string[] =>
  readJson(FAVORITES, [], (values) =>
    Array.isArray(values)
      ? [
          ...new Set(
            values
              .filter((v) => typeof v === "string")
              .map((v: string) => v.replace(/^(board:\d+):.*$/, "$1")),
          ),
        ]
      : [],
  );
/** Calls `fn` when another tab changes the favorites. */
export function onFavoritesChange(fn: () => void) {
  if (typeof addEventListener === "function")
    addEventListener("storage", (event: StorageEvent) => {
      if (event.key === scoped(FAVORITES)) fn();
    });
}
/** Where saved views are cached for the current account. */
export const savedViewsKey = () => scoped(SAVED_VIEWS);

const detailViews = () =>
  readJson<string[]>(VIEW_DETAILS, [], (ids) => (Array.isArray(ids) ? ids : []));
/** Whether a custom view's details panel was left open; boards and tab views share one setting instead. */
export const viewDetailsOpen = (id: string) => detailViews().includes(id);
export function rememberViewDetails(id: string, open: boolean) {
  try {
    const ids = detailViews().filter((v) => v !== id);
    localStorage.setItem(scoped(VIEW_DETAILS), JSON.stringify(open ? [...ids, id] : ids));
  } catch {
    /* Preference failure is separate from durable issue storage. */
  }
}

/** Stores the preference fields of a state change. Returns what to tell the user when the browser refused one. */
export function persistPreferences(patch: {
  board?: number;
  view?: View;
  sidebarHidden?: boolean;
  preferences?: Record<number, Preferences>;
  favorites?: string[];
}): string | undefined {
  let failed: string | undefined;
  try {
    if (patch.board) localStorage.setItem(scoped("board"), String(patch.board));
    if (patch.view) localStorage.setItem(scoped("view"), patch.view);
    if (patch.sidebarHidden !== undefined)
      localStorage.setItem(SIDEBAR, patch.sidebarHidden ? "hidden" : "shown");
  } catch {
    /* Preference failure is separate from durable issue storage. */
  }
  if (patch.preferences)
    try {
      localStorage.setItem(scoped(VIEWS), JSON.stringify(patch.preferences));
    } catch {
      failed = "Could not save view preferences in this browser";
    }
  if (patch.favorites)
    try {
      localStorage.setItem(scoped(FAVORITES), JSON.stringify(patch.favorites));
    } catch {
      failed = "Could not save favorites in this browser";
    }
  return failed;
}
