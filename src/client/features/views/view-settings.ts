import { isMyIssues } from "@/client/features/navigation/navigation";
/** A board's view settings: filters, display, scope, hidden and collapsed groups.
 *
 * Callers say what they want ("remove this rule", "clear filters", "hide this group"); this module decides where
 * it goes. Filters are the temporary filter of the page on screen (each board tab, saved view and personal page tab keeps
 * its own, shared/page-filters.ts); a saved view's own filters are never edited here. Everything else goes to the board's
 * preferences on a plain board, and to the view while a saved view is open, as Linear keeps them in the view's
 * preferences. While the view editor is open, everything goes to the editor's draft. Any other board's settings are its
 * own preferences, which hold no filter.
 */
import { get, set, useStore } from "@/client/state/store";
import { navigate, setOverlay, setViewDraft } from "@/client/features/navigation/app-navigation";
import { updateSavedView } from "./saved-views";
import { saveDefaults } from "@/client/state/browser-preferences";
import {
  defaultDisplay,
  defaultPreferences,
  collapseAllFrom,
  hasEstimates,
  resetDisplayPreferences,
  storedGroupOrder,
  updateFilter,
  type Display,
  type FilterGroup,
  type Preferences,
  type Rule,
} from "@/shared/view-model";

type State = ReturnType<typeof get>;
const fallback = defaultPreferences();
/** The preferences a plain board (or My issues, key 0) stores: no filter. */
const stored = (s: State, board: number) => s.preferences[board === s.board && isMyIssues(s) ? 0 : board] ?? fallback;
const edited = (s: State, board: number) => (board === s.board ? s.viewPreferences : null) ?? stored(s, board);
const effective = (s: State, board: number) => (board === s.board ? s.effectiveViewPreferences : null) ?? stored(s, board);

/** The settings the view controls show and edit. Inside a saved view, `filters` is only its overlay. */
export const viewSettings = (board: number, s = get()) => edited(s, board);
export const useViewSettings = (board: number) => useStore((s) => edited(s, board));
/** The settings the issues are selected with. Inside a saved view, `filters` is its base AND its overlay. */
export const effectiveSettings = (board: number) => effective(get(), board);
export const useEffectiveSettings = (board: number) => useStore((s) => effective(s, board));
/** Whether the issues a board shows carry estimates: My issues shows every board's. */
const estimates = (s: State, board: number) => hasEstimates(s.issues, board === s.board && isMyIssues(s) ? undefined : board);
export const boardHasEstimates = (board: number) => estimates(get(), board);
export const useBoardHasEstimates = (board: number) => useStore((s) => estimates(s, board));

function write(board: number, patch: Partial<Preferences>) {
  const s = get();
  if (s.editorDraft && board === s.board) {
    setViewDraft({ ...s.editorDraft, ...patch });
    return;
  }
  const { filters, ...rest } = patch;
  // Only the page on screen has a temporary filter to set.
  if (filters && board === s.board) setOverlay(filters);
  if (!Object.keys(rest).length) return;
  if (s.activeViewId && board === s.board) {
    void updateSavedView(s.activeViewId, rest).catch((e: unknown) =>
      set({ perf: e instanceof Error ? e.message : "Could not save view" }),
    );
    return;
  }
  const prefs = { ...stored(s, board), ...rest };
  set({ preferences: { ...s.preferences, [board === s.board && isMyIssues(s) ? 0 : board]: prefs } });
  if (board === s.board) navigate({ view: prefs.display.openIn });
}
const filters = (board: number, change: (f: FilterGroup) => FilterGroup) =>
  write(board, { filters: change(viewSettings(board).filters) });

/** Patches a rule or group by id; `null` removes it. */
export const updateRule = (board: number, id: string, change: Partial<Rule & FilterGroup> | null) =>
  filters(board, (f) => updateFilter(f, id, change));
/** Replaces the top-level rule with this id in place, or adds it at the end. */
export const setRule = (board: number, rule: Rule) =>
  filters(board, (f) => ({
    ...f,
    children: f.children.some((c) => c.id === rule.id)
      ? f.children.map((c) => (c.id === rule.id ? rule : c))
      : [...f.children, rule],
  }));
/** Makes this the only top-level rule on its field, at the end. */
export const setOnlyRule = (board: number, rule: Rule) =>
  filters(board, (f) => ({
    ...f,
    children: [...f.children.filter((c) => !("field" in c && c.field === rule.field)), rule],
  }));
/** Clears the filters being edited; a saved view keeps its base filters. */
export const clearFilters = (board: number) => write(board, { filters: defaultPreferences().filters });

/** Board layout always has columns, and rows never repeat the column grouping. */
export function setDisplay(board: number, patch: Partial<Display>) {
  const display = { ...viewSettings(board).display, ...patch };
  if (display.layout === "board" && display.columns === "none") display.columns = "status";
  if (display.rows === display.columns) display.rows = "none";
  write(board, { display });
}
/** Linear's Reset: back to the display saved as this browser's default for the board, else the app's, dropping the hidden
 *  groups and group order with it (resetDisplayPreferences). */
export const resetDisplay = (board: number) =>
  write(board, resetDisplayPreferences(get().defaults[board] ?? defaultDisplay()));

/** Hidden and collapsed groups, and the group order, belong to the current column grouping. */
const grouped = (board: number, key: "hidden" | "collapsed" | "order", change: (ids: string[]) => string[]) => {
  const p = viewSettings(board),
    by = p.display.columns;
  write(board, { [key]: { ...p[key], [by]: change(p[key][by] ?? []) } });
};
export const hideGroup = (board: number, id: string) => grouped(board, "hidden", (ids) => [...ids, id]);
export const showGroup = (board: number, id: string) =>
  grouped(board, "hidden", (ids) => ids.filter((x) => x !== id));
/** The Group ordering panel's drop: `order` is every current group in its new order (Linear's `setGroupOrder`). */
export const setGroupOrder = (board: number, order: string[]) =>
  grouped(board, "order", (stored) => storedGroupOrder(order, stored));
/** Collapses these groups, or expands them when all are already collapsed. */
export const toggleCollapsed = (board: number, groups: string[]) =>
  grouped(board, "collapsed", (ids) =>
    groups.every((id) => ids.includes(id))
      ? ids.filter((id) => !groups.includes(id))
      : [...new Set([...ids, ...groups])],
  );
/** Every group in `groups` takes the opposite of `ref`'s state (Linear's toggle-all, `collapseAllFrom`). */
export const toggleAllCollapsed = (board: number, groups: string[], ref: string) =>
  grouped(board, "collapsed", (ids) => collapseAllFrom(ids, groups, ref));
/** "Save as default": the board's display becomes its default in this browser. Not while a view is open. */
export async function saveDefault(board: number) {
  if (get().activeViewId) return;
  const display = viewSettings(board).display;
  try {
    const defaults = { ...get().defaults, [board]: structuredClone(display) };
    saveDefaults(defaults);
    set({ defaults, perf: "Saved your default in this browser" });
  } catch {
    set({ perf: "Could not save your default in this browser" });
  }
}
