import { isMyIssues } from "./navigation";
/** A board's view settings: filters, display, scope, hidden and collapsed groups.
 *
 * Callers say what they want ("remove this rule", "clear filters", "hide this group"); this module decides where
 * it goes. On a plain board it goes to the board's preferences. While a saved view is open, filters go to the view's
 * temporary overlay (its saved base filters are never edited here), and display and scope are saved to the view.
 * While the view editor is open, everything goes to the editor's draft. Any other board's settings are its own
 * preferences.
 */
import { get, navigate, set, setOverlay, setViewDraft, updateSavedView, useStore } from "./store";
import {
  defaultDisplay,
  defaultPreferences,
  updateFilter,
  type Display,
  type FilterGroup,
  type Preferences,
  type Rule,
} from "./view-model";
import { emptyOverlay } from "./saved-view-model";

type State = ReturnType<typeof get>;
const fallback = defaultPreferences();
const edited = (s: State, board: number) =>
  (board === s.board ? s.viewPreferences : null) ?? s.preferences[board === s.board && isMyIssues(s) ? 0 : board] ?? fallback;
const effective = (s: State, board: number) =>
  (board === s.board ? s.effectiveViewPreferences : null) ?? s.preferences[board === s.board && isMyIssues(s) ? 0 : board] ?? fallback;

/** The settings the view controls show and edit. Inside a saved view, `filters` is only its overlay. */
export const viewSettings = (board: number) => edited(get(), board);
export const useViewSettings = (board: number) => useStore((s) => edited(s, board));
/** The settings the issues are selected with. Inside a saved view, `filters` is its base AND its overlay. */
export const effectiveSettings = (board: number) => effective(get(), board);
export const useEffectiveSettings = (board: number) => useStore((s) => effective(s, board));

function write(board: number, patch: Partial<Preferences>) {
  const s = get();
  if (s.editorDraft && board === s.board) {
    setViewDraft({ ...s.editorDraft, ...patch });
    return;
  }
  if (s.activeViewId && board === s.board) {
    if (patch.filters) setOverlay(patch.filters);
    const { display, scope } = patch;
    if (display || scope)
      void updateSavedView(s.activeViewId, {
        ...(display ? { display } : {}),
        ...(scope ? { scope } : {}),
      }).catch((e: unknown) =>
        set({ perf: e instanceof Error ? e.message : "Could not save view" }),
      );
    return;
  }
  const prefs = { ...viewSettings(board), ...patch };
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
export function clearFilters(board: number) {
  const s = get();
  if (s.activeViewId && !s.editorDraft && board === s.board) setOverlay(emptyOverlay());
  else write(board, { filters: defaultPreferences().filters });
}

/** Board layout always has columns, and rows never repeat the column grouping. */
export function setDisplay(board: number, patch: Partial<Display>) {
  const display = { ...viewSettings(board).display, ...patch };
  if (display.layout === "board" && display.columns === "none") display.columns = "status";
  if (display.rows === display.columns) display.rows = "none";
  write(board, { display });
}
/** Back to the display saved as this browser's default for the board, else the app's. */
export const resetDisplay = (board: number) =>
  setDisplay(board, get().defaults[board] ?? defaultDisplay());
export const setScope = (board: number, scope: Preferences["scope"]) => write(board, { scope });

/** Hidden and collapsed groups belong to the current column grouping. */
const grouped = (board: number, key: "hidden" | "collapsed", change: (ids: string[]) => string[]) => {
  const p = viewSettings(board),
    by = p.display.columns;
  write(board, { [key]: { ...p[key], [by]: change(p[key][by] ?? []) } });
};
export const hideGroup = (board: number, id: string) => grouped(board, "hidden", (ids) => [...ids, id]);
export const showGroup = (board: number, id: string) =>
  grouped(board, "hidden", (ids) => ids.filter((x) => x !== id));
/** Collapses these groups, or expands them when all are already collapsed. */
export const toggleCollapsed = (board: number, groups: string[]) =>
  grouped(board, "collapsed", (ids) =>
    groups.every((id) => ids.includes(id))
      ? ids.filter((id) => !groups.includes(id))
      : [...new Set([...ids, ...groups])],
  );
