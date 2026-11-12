/** Phase 2 contract: view-settings edits the temporary overlay while a view is active. Issue
 * results use useEffectiveSettings (saved base AND overlay). Display edits persist to the view. Draft helpers are detached: Cancel simply discards the draft; duplicate
 * has no id until saveViewDraft. Async mutations reject on failure and return the saved id.
 * createViewDraft supplies the editor's unsaved flow.
 * Favorites use the existing toggleFavorite(`view:${id}`) and are browser/account scoped.
 */
import { get, set, useStore } from "./store";
import { navigate, openAllIssues, clearOverlay } from "./app-navigation";
import { savedViewClient } from "./saved-view-client";
import { effectiveSettings } from "./view-settings";
import { rememberViewDetails, savedViewsKey } from "./browser-preferences";
import { favoritesWithout, liveFavorites } from "./favorites";
import { canMergeOverlay, mergeFilters, MERGE_CONFLICT, type SavedView, type ViewDraft } from "./saved-view-model";
export type { SavedView, ViewDraft } from "./saved-view-model";
export { encodeOverlay, decodeOverlay, mergeFilters, emptyOverlay, canMergeOverlay, MERGE_CONFLICT, viewPath } from "./saved-view-model";
export { openSavedView, clearOverlay } from "./app-navigation";
export { toggleFavorite } from "./favorites";
export const useActiveView = () =>
  useStore((s) => s.savedViews.find((v) => v.id === s.activeViewId) ?? null);
export const activeView = () =>
  get().savedViews.find((v) => v.id === get().activeViewId) ?? null;
export const useOverlayFilters = () => useStore((s) => s.overlayFilters);
export const useSavedViews = () => useStore((s) => s.savedViews);
export const useEffectiveMine = () =>
  useStore((s) => s.mine || !!s.savedViews.find((v) => v.id === s.activeViewId)?.mine);

/** Shows why a view could not be saved. */
export const viewError = (e: unknown) =>
  set({ perf: e instanceof Error ? e.message : "Could not save view" });
const viewClient = savedViewClient(
  { read: () => get().savedViews, write: (savedViews) => set({ savedViews }) },
  savedViewsKey,
  {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
  },
  (input, init) => fetch(input, init),
);
/** Loads the account's views, first importing ones an older build kept in this browser. */
export const loadSavedViews = () => viewClient.load(true);
export async function refreshSavedViews() {
  const savedViews = await viewClient.refresh();
  if (!savedViews) return;
  set({ savedViews, favorites: liveFavorites(savedViews) });
  if (get().activeViewId && !savedViews.some((v) => v.id === get().activeViewId))
    navigate({ board: get().board });
}
export function createViewDraft(
  kind: SavedView["kind"] = "custom",
  board = get().board,
): ViewDraft {
  const p = effectiveSettings(board);
  return structuredClone({
    board,
    kind,
    name: "",
    description: "",
    icon: "custom-view", // Linear's new-view default (#CustomView)
    color: "gray",
    filters: p.filters,
    // Linear: a new custom view starts as a list with its details open; a tab keeps the board's layout.
    display: kind === "custom" ? { ...p.display, layout: "list" } : p.display,
    scope: p.scope,
    mine: get().mine,
  });
}
export function editViewDraft(id: string): ViewDraft {
  const v = get().savedViews.find((v) => v.id === id);
  if (!v) throw new Error("View not found");
  const { createdAt: _created, updatedAt: _updated, ...draft } = structuredClone(v);
  return draft;
}
export function duplicateViewDraft(id: string): ViewDraft {
  const { id: _id, ...draft } = editViewDraft(id);
  return { ...draft, name: "", description: "", sourceId: id };
}
export async function createSavedView(draft: ViewDraft): Promise<string> {
  const view = await viewClient.create(draft);
  if (view.kind === "custom") rememberViewDetails(view.id, true);
  set({ savedViews: [...get().savedViews.filter((v) => v.id !== view.id), view] });
  return view.id;
}
export const updateSavedView = viewClient.update;
export async function saveViewDraft(draft: ViewDraft): Promise<string> {
  return draft.id ? updateSavedView(draft.id, draft) : createSavedView(draft);
}
export async function deleteSavedView(id: string) {
  await viewClient.remove(id);
  rememberViewDetails(id, false);
  if (get().activeViewId === id) openAllIssues(get().board);
  set({
    savedViews: get().savedViews.filter((v) => v.id !== id),
    favorites: favoritesWithout(`view:${id}`),
  });
}
export async function saveOverlayToView() {
  const v = get().savedViews.find((v) => v.id === get().activeViewId);
  if (!v) return;
  if (!canMergeOverlay(v.filters, get().overlayFilters)) throw new Error(MERGE_CONFLICT);
  await updateSavedView(v.id, {
    filters: mergeFilters(v.filters, get().overlayFilters),
  });
  clearOverlay();
}
