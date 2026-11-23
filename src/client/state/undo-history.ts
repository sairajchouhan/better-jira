import { copyIssueField, isIssueField, type Issue } from "@/shared/issue-model";
/**
 * Undo history: this tab's local edits as undoable steps, kept across a reload (R2-inbox-D3) but never shared with
 * another tab, as Linear's per-client history is. `record` makes one step of whatever `fn` changes; undo and redo send
 * Jira only that step's inverse, and with Jira writes revert only the fields the step changed, so newer Jira values
 * and other people's additions survive.
 */
import { dismissNotificationsWithout } from "./app-notifications";
import { navigate, ui } from "@/client/features/navigation/app-navigation";

import type { LocalEdit, LocalState, Snapshot } from "./local-data";
import {
  countEdit,
  isLocalIssue,
  markChanged,
  markStale,
  restoreSnapshots,
  snapshot,
} from "./local-edits";
import { get, set } from "./store";
import { currentKey, hasPendingWrite, send, touch } from "./jira-sync";
import { queueSave } from "./local-database";

const undo: LocalEdit[] = [],
  redo: LocalEdit[] = [];
/** This tab across reloads (sessionStorage is per tab), so its undo history survives a reload and never reaches another tab.
 *  ponytail: a duplicated tab copies sessionStorage and shares the history; mint a new id on `pageshow` duplicates if that matters. */
const undoTab = (() => {
  try {
    return (sessionStorage["better-jira:undo-tab"] ??= crypto.randomUUID()) as string;
  } catch {
    return crypto.randomUUID();
  }
})();

/** Takes this tab's steps from the saved data. Returns the counts to show. */
export function loadHistory(local: Pick<LocalState, "undo" | "redo">) {
  undo.splice(0, undo.length, ...local.undo.filter((e) => e.tab === undoTab));
  redo.splice(0, redo.length, ...local.redo.filter((e) => e.tab === undoTab));
  return { undoCount: undo.length, redoCount: redo.length };
}
/** The steps to save. */
export const savedHistory = () => ({ undo: [...undo], redo: [...redo] });
/** Rewrites every step, e.g. when Jira gives a created issue or comment its id. */
export function rewriteHistory(fn: (edits: LocalEdit[]) => LocalEdit[]) {
  for (const list of [undo, redo]) list.splice(0, list.length, ...fn(list));
}
/** Updates the issue in every step's snapshots with a fact that is not an edit (a delivered reminder, a link preview). */
export function rewriteHistoricIssue(key: string, fn: (issue: Issue) => Issue) {
  for (const edit of [...undo, ...redo])
    for (const entry of [...edit.before, ...edit.after])
      if (entry.issue?.key === key) entry.issue = fn(entry.issue);
}
/** Drops the newest step if it is `label` (an edit that can't be undone after all). */
export function forgetLastEdit(label: string) {
  if (undo.at(-1)?.label !== label) return;
  undo.pop();
  set({ undoCount: undo.length });
  queueSave();
}
let lastEditGroup: string | undefined;
let transaction: { label: string; before: Map<string, Snapshot> } | null = null;
/** Makes one undo step of what `fn` changes to the issues `key` names, and sends it to Jira unless `quiet`. Nested calls join the
 *  outer step; consecutive calls with the same `group` (an editing session) merge into one. */
export function record(
  key: string | string[],
  label: string,
  fn: () => void,
  group?: string,
  quiet = false,
) {
  if (!get().canEdit) {
    set({ perf: "Local editing is paused until saved data is available" });
    return;
  }
  const keys = typeof key === "string" ? [key] : key;
  const nested = transaction !== null;
  transaction ??= { label, before: new Map() };
  for (const key of keys)
    if (!transaction.before.has(key)) transaction.before.set(key, snapshot(key));
  if (nested) {
    fn();
    return;
  }
  try {
    fn();
    const changed = [...transaction.before.keys()].filter((key) => {
      const before = transaction!.before.get(key)!,
        after = snapshot(key);
      return before.issue !== after.issue || before.full !== after.full;
    });
    if (!changed.length) return;
    for (const key of changed) {
      markChanged(key);
      countEdit(key);
    }
    touch(...changed);
    if (!quiet) send(changed.map((key) => [key, transaction!.before.get(key)!, snapshot(key)]));
    const previous = undo.at(-1);
    if (
      group &&
      group === lastEditGroup &&
      previous &&
      JSON.stringify(previous.keys) === JSON.stringify(changed)
    )
      previous.after = changed.map(snapshot);
    else
      undo.push({
        tab: undoTab,
        keys: changed,
        label,
        before: changed.map((key) => transaction!.before.get(key)!),
        after: changed.map(snapshot),
      });
    lastEditGroup = group;
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    set({ undoCount: undo.length, redoCount: 0 });
    queueSave();
  } finally {
    transaction = null;
  }
}
function restore(edit: LocalEdit, snapshots: Snapshot[]) {
  lastEditGroup = undefined;
  // Jira gets this edit's inverse alone, so comments, labels, files or links others added since are never removed.
  const [from, to] =
    snapshots === edit.before ? [edit.after, edit.before] : [edit.before, edit.after];
  const current = edit.keys.map(snapshot);
  // With Jira writes, undo reverts only the fields this edit changed, so it never overwrites newer Jira values.
  if (get().writable)
    snapshots = edit.keys.map((key, index) => {
      const target = snapshots[index]!,
        now = current[index]!,
        before = edit.before[index]!,
        after = edit.after[index]!;
      if (!target.issue || !now.issue) return target;
      const changed = (a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined, field: string) =>
        JSON.stringify(a?.[field]) !== JSON.stringify(b?.[field]);
      const issue = { ...now.issue };
      for (const field of new Set([
        ...Object.keys(before.issue ?? {}),
        ...Object.keys(after.issue ?? {}),
      ]))
        if (isIssueField(field) && changed(before.issue, after.issue, field))
          copyIssueField(issue, target.issue, field);
      const full =
        now.full && target.full ? { ...now.full, fields: { ...now.full.fields } } : target.full;
      // Comment edits and deletes live in commentStates; once Jira has them, undo needs the comment list back too.
      const commentEdit = changed(before.issue, after.issue, "commentStates");
      if (full && now.full)
        for (const field of new Set([
          ...Object.keys(before.full?.fields ?? {}),
          ...Object.keys(after.full?.fields ?? {}),
        ]))
          if (
            changed(before.full?.fields, after.full?.fields, field) ||
            (field === "comment" && commentEdit)
          )
            full.fields[field] = target.full!.fields[field];
      return { ...target, issue, full };
    });
  for (const key of edit.keys)
    try {
      const prefix = `better-jira:resource-draft:${get().namespace}:${key}:`;
      for (const name of Object.keys(localStorage))
        if (name.startsWith(prefix)) localStorage.removeItem(name);
    } catch {}
  touch(...edit.keys);
  // Undo and redo are edits too: a Restore reading Jira's version meanwhile must not discard them (sync review 7).
  for (const key of edit.keys) countEdit(key);
  restoreSnapshots(edit.keys, snapshots);
  ui.send({ type: "overlay.close" });
  send(edit.keys.map((key, index) => [key, from[index]!, to[index]!]));
  // The write's answer brings Jira's copy; a refresh before it lands would show the undone value again (R1-D16).
  for (const key of edit.keys)
    if (get().issues.has(key) && !isLocalIssue(key) && !hasPendingWrite(key)) markStale(key);
  const { selected, issues } = get();
  if (selected && !issues.has(selected)) navigate({ selected: null, panel: false });
}
/** Jira can't restore a deleted issue; undo or redo would only create a copy under a new key. Issues made here (PREFIX-NEWn) can be re-created. */
function revivesJiraIssue(edit: LocalEdit, target: Snapshot[]) {
  const source = target === edit.before ? edit.after : edit.before;
  return (
    get().writable &&
    edit.keys.some(
      (key, index) => target[index]?.issue && !source[index]?.issue && !/-NEW\d+$/.test(key),
    )
  );
}
export function undoEdit() {
  const edit = undo.pop();
  if (!edit) return;
  if (revivesJiraIssue(edit, edit.before)) {
    set({
      undoCount: undo.length,
      perf: `Can't undo ${edit.label}: Jira can't restore deleted issues.`,
    });
    queueSave();
    return;
  }
  restore(edit, edit.before);
  redo.push(edit);
  set({ undoCount: undo.length, redoCount: redo.length, perf: `Undid ${edit.label}` });
  // Undoing a create removes the issue its toast offers to open.
  dismissNotificationsWithout((key) => get().issues.has(currentKey(key)));
  queueSave();
}
export function redoEdit() {
  const edit = redo.pop();
  if (!edit) return;
  if (revivesJiraIssue(edit, edit.after)) {
    set({
      redoCount: redo.length,
      perf: `Can't redo ${edit.label}: Jira can't restore a deleted issue; create it again to get a new key.`,
    });
    queueSave();
    return;
  }
  restore(edit, edit.after);
  undo.push(edit);
  set({ undoCount: undo.length, redoCount: redo.length, perf: `Redid ${edit.label}` });
  queueSave();
}
