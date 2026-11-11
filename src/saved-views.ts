/** Phase 2 contract: usePreferences/changePreferences edit the temporary overlay while a view
 * is active. Issue results use useEffectivePreferences (saved base AND overlay). Display edits
 * persist to the view. Draft helpers are detached: Cancel simply discards the draft; duplicate
 * has no id until saveViewDraft. Async mutations reject on failure and return the saved id.
 * createViewDraft supplies the editor's unsaved flow.
 * Favorites use the existing toggleFavorite(`view:${id}`) and are browser/account scoped.
 */
import { get, useStore } from "./store";
export type { SavedView, ViewDraft } from "./saved-view-model";
export { encodeOverlay, decodeOverlay, mergeFilters, emptyOverlay, canMergeOverlay, MERGE_CONFLICT, viewPath } from "./saved-view-model";
export {
  usePreferences,
  preferencesFor,
  changePreferences,
  changeDisplay,
  openSavedView,
  createSavedView,
  updateSavedView,
  deleteSavedView,
  createViewDraft,
  editViewDraft,
  duplicateViewDraft,
  saveViewDraft,
  clearOverlay,
  saveOverlayToView,
  refreshSavedViews,
  toggleFavorite,
  useEffectivePreferences,
  effectivePreferencesFor,
} from "./store";
export const useActiveView = () =>
  useStore((s) => s.savedViews.find((v) => v.id === s.activeViewId) ?? null);
export const activeView = () =>
  get().savedViews.find((v) => v.id === get().activeViewId) ?? null;
export const useOverlayFilters = () => useStore((s) => s.overlayFilters);
export const useSavedViews = () => useStore((s) => s.savedViews);
export const useEffectiveMine = () =>
  useStore((s) => s.mine || !!s.savedViews.find((v) => v.id === s.activeViewId)?.mine);
