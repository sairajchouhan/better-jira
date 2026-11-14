/**
 * Jira's changelog as Activity events (BJ-13). Each changelog item maps to a Linear activity field where Linear has one
 * (status, assignee, priority, labels, due date, parent, type, relations, title, estimate, cycle, project, milestone),
 * and to an honest Jira-only change where it has none (resolution, component, team, custom fields). Each changelog entry
 * is one Linear history record (`historyEvents`), so every change stays reachable in Activity, and an edit made here is
 * shown once: Jira's echo of it replaces the local event.
 */
import type { HistoryEntry, HistoryItem } from "@/shared/jira-history";
import {
  changed,
  historyEvents,
  sameValue,
  type ActivityField,
  type Change,
  type PropertyActivity,
  type Relation,
} from "./issue-activity";

/** A Jira field with no Linear property: its name and display value. */
export type FieldValue = { name: string; value: string };
/** A file, version, component or web link: added or removed one at a time. */
export type NamedValue = { id: string; name: string; key?: string };

/** Jira's remote link text, 'This work item links to "Fix it (Web Link)"': the link's title, then its source in brackets. */
const REMOTE_LINK = /links to "(.*?)(?: \(([^()]*)\))?"$/s;
/** A web link from Jira's changelog: its remote link id and title, without Jira's sentence or source suffix. */
export function remoteLink(id: string | null, text: string | null): NamedValue | null {
  if (id === null && text === null) return null;
  const title = text?.match(REMOTE_LINK)?.[1] ?? text ?? id ?? "";
  return { id: id ?? title, name: title };
}

/** Jira's link phrases ("This work item blocks X", older "This issue …") to Linear's relation kinds. Others keep their phrase. */
const LINK_KINDS: Record<string, string> = {
  blocks: "blocking",
  "is blocked by": "blocked",
  "relates to": "related",
  duplicates: "duplicate",
  "is duplicated by": "duplicated",
};
const LINK = /^This (?:work item|issue) (.+) ([A-Z][A-Z0-9_]*-\d+)$/;
export function linkRelation(text: string | null, key: string | null): Relation | null {
  if (!text && !key) return null;
  const match = text?.match(LINK);
  const phrase = match?.[1] ?? "relates to";
  return {
    key: match?.[2] ?? key ?? "",
    kind: LINK_KINDS[phrase] ?? phrase,
  };
}

/** Changes Linear never shows (board order, card colour) and halves of a move shown elsewhere (the new key). */
const SKIPPED = new Set(["Rank", "Epic Color", "Issue color", "Key", "Epic Status", "Epic Name"]);

const split = (text: string | null) => (text ? text.split(" ").filter(Boolean) : []);
const named = (id: string | null, name: string | null): NamedValue | null =>
  id === null && name === null ? null : { id: id ?? name ?? "", name: name ?? id ?? "" };
/** Jira's Sprint value lists every sprint an unfinished issue rolled through: ids "1, 2" and names "Sprint 1, Sprint 2". */
const sprints = (ids: string | null, names: string | null): NamedValue[] | null => {
  const idList = ids ? ids.split(", ").filter(Boolean) : [],
    nameList = names ? names.split(", ") : [];
  return idList.length ? idList.map((id, i) => ({ id, name: nameList[i] ?? id })) : null;
};
const nonEmpty = (text: string | null) => (text === null || text === "" ? null : text);

type Mapped = { field: ActivityField; before: unknown; after: unknown; delta?: boolean };
/** One changelog item as the Activity field it changes, or nothing for noise. */
export function mapItem(item: HistoryItem, entry: readonly HistoryItem[]): Mapped | null {
  const { field, fieldId, from, fromText, to, toText } = item;
  const id = fieldId ?? field;
  if (SKIPPED.has(field)) return null;
  switch (id) {
    case "status":
      return { field: "status", before: named(from, fromText), after: named(to, toText) };
    case "assignee":
      return { field: "assignee", before: named(from, fromText), after: named(to, toText) };
    case "priority":
      return { field: "priority", before: nonEmpty(fromText), after: nonEmpty(toText) };
    case "labels":
      return { field: "labels", before: split(fromText), after: split(toText) };
    case "duedate":
      return { field: "due", before: nonEmpty(from), after: nonEmpty(to) };
    case "issuetype":
      return { field: "type", before: nonEmpty(fromText), after: nonEmpty(toText) };
    case "summary":
      return { field: "title", before: fromText, after: toText };
    case "description":
      return { field: "description", before: fromText, after: toText };
    case "project": {
      const key = entry.find((other) => other.field === "Key" || other.fieldId === "key");
      return { field: "project", before: from || fromText ? { ...named(from, fromText)!, key: key?.fromText ?? key?.from ?? undefined } : null,
        after: to || toText ? { ...named(to, toText)!, key: key?.toText ?? key?.to ?? undefined } : null };
    }
    case "timeestimate":
    case "timespent":
    case "timeoriginalestimate": {
      const value = (text: string | null) => text === null || text === "" ? null : { name: field, value: jiraDuration(text) };
      return { field: "field", before: value(fromText ?? from), after: value(toText ?? to) };
    }
    case "resolution":
      // A resolution set by the transition it came with is that status change; Linear has no resolution.
      return entry.some((other) => (other.fieldId ?? other.field) === "status")
        ? null
        : { field: "resolution", before: nonEmpty(fromText), after: nonEmpty(toText) };
    case "attachment":
      return { field: "attachment", before: named(from, fromText), after: named(to, toText), delta: true };
    case "fixVersions":
      return { field: "milestone", before: named(from, fromText), after: named(to, toText), delta: true };
    case "components":
      return { field: "component", before: named(from, fromText), after: named(to, toText), delta: true };
    case "comment":
    case "Comment":
      // Jira logs a deleted comment; Linear's history has no comment deletions, so neither does Activity (R3-comments-D4).
      return null;
  }
  switch (field) {
    case "IssueParentAssociation":
    case "Parent":
    case "Epic Link":
      return { field: "parent", before: nonEmpty(fromText ?? from), after: nonEmpty(toText ?? to) };
    case "Link":
      return {
        field: "relation",
        before: linkRelation(fromText, from),
        after: linkRelation(toText, to),
        delta: true,
      };
    case "RemoteWorkItemLink":
      return { field: "weblink", before: remoteLink(from, fromText), after: remoteLink(to, toText), delta: true };
    case "Sprint":
      return { field: "cycle", before: sprints(from, fromText), after: sprints(to, toText) };
    case "Story Points":
    case "Story point estimate":
      return {
        field: "estimate",
        before: nonEmpty(fromText) && Number(fromText),
        after: nonEmpty(toText) && Number(toText),
      };
    case "Team":
      return { field: "team", before: nonEmpty(fromText), after: nonEmpty(toText) };
    case "Flagged":
      return { field: "flag", before: nonEmpty(fromText), after: nonEmpty(toText) };
  }
  const value = (text: string | null): FieldValue | null =>
    text === null ? null : { name: field, value: text };
  return { field: "field", before: value(fromText), after: value(toText) };
}

const UNKNOWN = { id: "unknown", name: "Someone" };
/** The changelog as raw changes, oldest first: one per item that means something in the Activity. */
export function historyChanges(history: readonly HistoryEntry[]): Change[] {
  return withoutRemovedLinks(history.flatMap((entry) => {
    const actor = entry.actor ?? UNKNOWN;
    return entry.items.flatMap((item, index) => {
      const mapped = mapItem(item, entry.items);
      if (!mapped || (mapped.before === null && mapped.after === null)) return [];
      if (!mapped.delta && !changed(mapped)) return [];
      return [{ id: `jira-${entry.id}-${index}`, ...mapped, actor, at: entry.at }];
    });
  }));
}

/** Linear's link entry (`ls` in its history chunk) exists only while the link does, and it has no entry for a removal:
 *  a removed web link drops out of the Activity, its "linked" row too. */
function withoutRemovedLinks(changes: Change[]): Change[] {
  const removed = new Set(
    changes.flatMap((change) => (change.field === "weblink" && change.after === null ? [(change.before as NamedValue).id] : [])),
  );
  return changes.filter(
    (change) => change.field !== "weblink" || (change.after !== null && !removed.has((change.after as NamedValue).id)),
  );
}

/** Jira writes an edit after this browser made it; a little clock skew is allowed either way. */
const ECHO_SKEW_MS = 60_000;
/** Whether Jira's changelog holds this local event: same person, same field, same new value, at or after the edit. */
const echoed = (event: PropertyActivity, jira: readonly Change[]) =>
  jira.some(
    (change) =>
      change.actor.id === event.actor.id &&
      change.field === event.field &&
      Date.parse(change.at) >= Date.parse(event.made ?? event.at) - ECHO_SKEW_MS &&
      (event.field === "relation"
        ? sameValue(change.after, event.after) && sameValue(change.before, event.before)
        : sameValue(change.after, event.after)),
  );

/** The issue's Activity events: Jira's whole history, one record per changelog entry, plus the local edits Jira doesn't
 *  have yet (pending, refused, or made on a read-only site). */
export function mergeHistory(
  local: readonly PropertyActivity[],
  history: readonly HistoryEntry[],
): PropertyActivity[] {
  const jira = historyChanges(history);
  if (!jira.length) return [...local];
  return [...historyEvents(jira), ...local.filter((event) => !echoed(event, jira))];
}

/** Jira's default time tracking uses 5 working days/week and 8 working hours/day.
 * Keep minutes (Jira's smallest input/display unit), rather than treating a day as 24 elapsed hours. */
export function jiraDuration(value: string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return value;
  let minutes = Math.round(seconds / 60);
  const parts: string[] = [];
  for (const [unit, size] of [["w", 2400], ["d", 480], ["h", 60], ["m", 1]] as const) {
    const count = Math.floor(minutes / size);
    if (count) parts.push(`${count}${unit}`);
    minutes %= size;
  }
  return parts.join(" ") || "0m";
}
