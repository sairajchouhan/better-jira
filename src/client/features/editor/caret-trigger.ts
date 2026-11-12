import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

/** The "<char>query" typed right before the caret: from is the trigger character, to the caret. */
export type CaretTrigger = { from: number; to: number; query: string };

/** A menu that opens while text before the caret matches `pattern` (its group 1 is the query after a one-character
 * trigger such as @, / or :). Esc dismisses it until a new trigger is typed. Never inside code. */
export function caretTrigger(name: string, pattern: RegExp, maxQuery = 30) {
  const key = new PluginKey<number | null>(name);
  const find = (state: EditorState): CaretTrigger | null => {
    const { selection } = state,
      $from = selection.$from;
    if (!selection.empty || !$from.parent.inlineContent || $from.parent.type.spec.code) return null;
    if ($from.marks().some((mark) => mark.type.spec.code)) return null;
    const before = $from.parent.textBetween(
      Math.max(0, $from.parentOffset - maxQuery - 10),
      $from.parentOffset,
      undefined,
      "￼",
    );
    const query = pattern.exec(before)?.[1];
    if (query === undefined || query.length > maxQuery) return null;
    return { from: $from.pos - query.length - 1, to: $from.pos, query };
  };
  /** The open trigger, unless Esc dismissed it; typing on keeps it dismissed until a new trigger. */
  const active = (state: EditorState): CaretTrigger | null => {
    const trigger = find(state);
    return trigger && trigger.from !== key.getState(state) ? trigger : null;
  };
  const dismiss = (state: EditorState): Transaction => state.tr.setMeta(key, find(state)?.from ?? null);
  /** `keys` handles the menu's keys (arrows, Enter, Tab, Esc) while it is open and returns whether it used the key. */
  const plugin = (keys: (view: EditorView, event: KeyboardEvent) => boolean) =>
    new Plugin<number | null>({
      key,
      state: {
        init: () => null,
        apply(tr, dismissed, _old, next) {
          const meta = tr.getMeta(key);
          if (meta !== undefined) return meta;
          if (dismissed === null) return null;
          const at = tr.mapping.map(dismissed);
          return find(next)?.from === at ? at : null;
        },
      },
      props: {
        handleKeyDown(view, event) {
          if (!active(view.state) || !keys(view, event)) return false;
          event.preventDefault();
          event.stopPropagation();
          return true;
        },
      },
    });
  return { find, active, dismiss, plugin };
}
