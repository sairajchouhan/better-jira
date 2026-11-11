import { activeView, createViewDraft, mergeFilters } from "./saved-views";
import { get, preferencesFor } from "./store";
import { openViewEditor } from "./view-editor";

export function createToolbarView() {
  const board = get().board;
  const current = preferencesFor(board);
  const view = activeView();
  const draft = createViewDraft("custom", board);
  draft.filters = view
    ? mergeFilters(view.filters, current.filters)
    : current.filters;
  draft.display = current.display;
  openViewEditor(draft);
}
