import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { mentionNode } from "./rich-document";

/** The "@query" being typed right before the caret: from is the "@", to the caret. */
export type MentionTrigger = { from: number; to: number; query: string };

// "@" at a word start, then a name of up to 30 characters with single spaces ("@Sairaj Ch"); two spaces or another "@" end it.
const TRIGGER = /(?:^|[\s(])@((?:[^\s@￼](?:[^\S\n]?[^\s@￼])*[^\S\n]?)?)$/;

export function mentionTrigger(state: EditorState): MentionTrigger | null {
  const { selection } = state,
    $from = selection.$from;
  if (!selection.empty || !$from.parent.inlineContent || $from.parent.type.spec.code) return null;
  if ($from.marks().some((mark) => mark.type.spec.code)) return null;
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 40),
    $from.parentOffset,
    undefined,
    "￼",
  );
  const query = TRIGGER.exec(before)?.[1];
  if (query === undefined || query.length > 30) return null;
  return { from: $from.pos - query.length - 1, to: $from.pos, query };
}

const key = new PluginKey<number | null>("mention");
/** The open trigger, unless Esc dismissed it; typing on keeps it dismissed until a new "@". */
export function activeMention(state: EditorState): MentionTrigger | null {
  const trigger = mentionTrigger(state);
  return trigger && trigger.from !== key.getState(state) ? trigger : null;
}
export const dismissMention = (state: EditorState): Transaction =>
  state.tr.setMeta(key, mentionTrigger(state)?.from ?? null);

/** Replaces the "@query" with Jira's mention node and a space, like Linear. */
export function insertMention(
  state: EditorState,
  trigger: MentionTrigger,
  person: { id: string; name: string },
): Transaction {
  return state.tr.replaceWith(trigger.from, trigger.to, [
    mentionNode(person),
    state.schema.text(" "),
  ]);
}

/** `keys` handles the picker's keys (arrows, Enter, Tab, Esc) while it is open and returns whether it used the key. */
export const mentionPlugin = (keys: (view: EditorView, event: KeyboardEvent) => boolean) =>
  new Plugin<number | null>({
    key,
    state: {
      init: () => null,
      apply(tr, dismissed, _old, next) {
        const meta = tr.getMeta(key);
        if (meta !== undefined) return meta;
        if (dismissed === null) return null;
        const at = tr.mapping.map(dismissed);
        return mentionTrigger(next)?.from === at ? at : null;
      },
    },
    props: {
      handleKeyDown(view, event) {
        if (!activeMention(view.state) || !keys(view, event)) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
  });
