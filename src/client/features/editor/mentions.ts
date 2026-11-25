import { InputRule, inputRules } from "prosemirror-inputrules";
import type { EditorState, Transaction } from "prosemirror-state";
import { caretTrigger, type CaretTrigger } from "./caret-trigger";
import { inlineCardNode, mentionNode } from "./rich-document";

export type MentionTrigger = CaretTrigger;

// "@" (or a full-width "＠", as Linear) at a word start, then a name of up to 30 characters with single spaces ("@Alex Ri");
// two spaces or another "@" end it.
const mention = caretTrigger("mention", /(?:^|[\s(])[@＠]((?:[^\s@＠￼](?:[^\S\n]?[^\s@＠￼])*[^\S\n]?)?)$/);
export const mentionTrigger = mention.find;
export const activeMention = mention.active;
export const dismissMention = mention.dismiss;
export const mentionPlugin = mention.plugin;

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

/** Replaces the "@query" with a reference to an issue: Jira's smart link to it, as Jira's own editor inserts. */
export function insertIssueReference(state: EditorState, trigger: MentionTrigger, url: string): Transaction {
  return state.tr.replaceWith(trigger.from, trigger.to, [inlineCardNode(url), state.schema.text(" ")]);
}

/** An issue key typed out ("KAN-12" then Space) becomes a reference to that issue when `url` knows it, like Linear. */
export const issueReferenceRules = (url: (key: string) => string | null) =>
  inputRules({
    rules: [
      new InputRule(
        /(?:^|[\s(])([A-Z][A-Z0-9_]*-\d+)\s$/,
        (state, match, _start, end) => {
          const href = url(match[1]!),
            from = end - match[1]!.length;
          if (!href || state.doc.rangeHasMark(from, end, state.schema.marks.link!)) return null;
          return state.tr.replaceWith(from, end, [inlineCardNode(href), state.schema.text(match[0].slice(-1))]);
        },
        { inCodeMark: false },
      ),
    ],
  });
