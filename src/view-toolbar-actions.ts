import { createViewDraft } from "./saved-views";
import { get } from "./store";
import { openViewEditor } from "./view-editor";
import { viewSettings } from "./view-settings";

/** The toolbar's new view takes what is on screen: the effective filters and the current display, layout included. */
export function createToolbarView() {
  const board = get().board;
  const draft = createViewDraft("custom", board);
  draft.display = viewSettings(board).display;
  openViewEditor(draft);
}
