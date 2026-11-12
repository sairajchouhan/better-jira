import { activityFields } from "@/shared/issue-model";
import type { ActivityField, Actor, PropertyActivity } from "@/shared/issue-model";
export type { ActivityField, Actor, PropertyActivity };
import { type ImageComment, type MediaEdit } from "@/shared/issue-model";

import type { IssueResource } from "@/shared/issue-resource";
/** Local property history, kept the way Linear keeps an actor's edits (observed on RAJ-52, 2026-11-07/08):
 * an edit joins the actor's latest group while that group was last edited under GROUP_MS ago, and the group keeps its first time;
 * a field already in the group is updated, and hidden (but kept) when it returns to its value before the group. */
/** Linear's order of a history record's entries (`Qo` in its issue-history chunk): team, status, cycle, the small changes,
 *  milestone, labels, title, parent, relations, attachments, due date; Jira-only kinds follow. */
const FIELD_ORDER: readonly ActivityField[] = [
  "team",
  "status",
  "cycle",
  "assignee",
  "priority",
  "estimate",
  "project",
  "labels",
  "milestone",
  "title",
  "parent",
  "relation",
  "attachment",
  "weblink",
  "due",
  "type",
  "component",
  "resolution",
  "flag",
  "description",
  "comment",
  "field",
];
/** The kinds Linear lists together on one row (`ss`): "set priority to Urgent and removed label test", two to a row. */
const SMALL_FIELDS: ReadonlySet<ActivityField> = new Set(["assignee", "project", "priority", "estimate", "labels"]);
const order = (field: ActivityField) => FIELD_ORDER.indexOf(field);
/** Linear's grouped entries (`Xc`): adjacent entries of these kinds become one row that expands to each, at the latest
 *  one's time (`Yc` moves the group's date to each joining entry). Status, priority and labels join one actor's entries
 *  only (`sameActorOnly`); cycles and titles join anyone's. */
const GROUPED: Partial<Record<ActivityField, { sameActor: boolean }>> = {
  status: { sameActor: true },
  priority: { sameActor: true },
  labels: { sameActor: true },
  cycle: { sameActor: false },
  title: { sameActor: false },
};
/** The labels a change added and removed. */
export function labelDelta(before: unknown, after: unknown) {
  const was = new Set((before as string[] | null) ?? []),
    now = new Set((after as string[] | null) ?? []);
  return { added: [...now].filter((l) => !was.has(l)), removed: [...was].filter((l) => !now.has(l)) };
}
import type { Relation } from "@/shared/relations";
export type { Relation };
/** The other issue's role, as Linear's Issue options › Remove names it (RAJ-52): a blocked-by relation lists the "Blocking issue". */
export { RELATION_ISSUE } from "@/shared/relations";
// RAJ-52: edits 30.5 min, 5 min and about 60 min after the group's last edit joined it; one 62.7 min after started a new group.
// ponytail: the cut-off is in [60, 62.7] min; 60 is the round number inside it.
export const GROUP_MS = 60 * 60_000;

const identity = (value: unknown): unknown =>
  Array.isArray(value)
    ? [...new Set(value)].sort()
    : value && typeof value === "object" && "id" in value
      ? (value as { id: unknown }).id
      : (value ?? null);
export const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(identity(a)) === JSON.stringify(identity(b));

/** Events that changed something; a field edited back to its value before the group is not shown. */
export const visibleActivity = (events: readonly PropertyActivity[]) => events.filter(changed);

export function recordActivity(
  events: readonly PropertyActivity[],
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  actor: { id: string; name: string },
  now: string,
  id: () => string,
): readonly PropertyActivity[] {
  const changes = activityFields.filter(
    (field) => field in patch && !sameValue(before[field], patch[field]),
  );
  const properties = events.filter((event) => event.field !== "relation"),
    last = properties.at(-1),
    group = last
      ? properties.filter((event) => event.at === last.at && event.actor.id === last.actor.id)
      : [];
  const touched = Math.max(...group.map((event) => Date.parse(event.updated ?? event.at)));
  const open = !!last && last.actor.id === actor.id && Date.parse(now) - touched < GROUP_MS;
  // A description edit is not listed, but (RAJ-52, 21:07Z) it moves the actor's open group to its time.
  const bump = open && "description" in patch && !sameValue(before.description, patch.description);
  if (!changes.length && !bump) return events;
  const at = open && !bump ? last!.at : now;
  let next = open
    ? events.map((event) => (group.includes(event) ? { ...event, at, updated: now } : event))
    : [...events];
  for (const field of changes) {
    const index = next.findIndex(
        (event) => event.at === at && event.actor.id === actor.id && event.field === field,
      ),
      after = structuredClone(patch[field] ?? null);
    if (index < 0)
      next.push({
        id: id(),
        field,
        before: structuredClone(before[field] ?? null),
        after,
        actor: { ...actor },
        at,
        updated: now,
      });
    else next[index] = { ...next[index]!, after, updated: now };
  }
  return next;
}

/** Linear (RAJ-52): each relation change is its own Activity row, and removing a relation added under GROUP_MS ago drops that row.
 *  ponytail: Linear's row for removing an older relation was not observed; ours reads "removed <kind> issue". */
export function recordRelation(
  events: readonly PropertyActivity[],
  relation: Relation,
  remove: boolean,
  actor: { id: string; name: string },
  now: string,
  id: () => string,
): readonly PropertyActivity[] {
  const same = (value: unknown) =>
    !!value &&
    (value as Relation).key === relation.key &&
    (value as Relation).kind === relation.kind;
  const added = remove
    ? events.findLastIndex(
        (event) =>
          event.field === "relation" &&
          event.before === null &&
          same(event.after) &&
          event.actor.id === actor.id &&
          Date.parse(now) - Date.parse(event.at) < GROUP_MS,
      )
    : -1;
  if (added >= 0) return events.toSpliced(added, 1);
  return [
    ...events,
    {
      id: id(),
      field: "relation",
      before: remove ? { ...relation } : null,
      after: remove ? null : { ...relation },
      actor: { ...actor },
      at: now,
    },
  ];
}

/** One changelog item as it happened: its record's time and actor. `delta` marks a one-at-a-time change (a file, a
 *  relation, an edit whose text the server drops), which is a change even when its two sides read the same. */
export type Change = {
  id: string;
  field: ActivityField;
  before: unknown;
  after: unknown;
  delta?: boolean;
  actor: Actor;
  at: string;
};
/** Kinds whose values the server keeps out of the history: every item is an edit, though both sides read "". */
const EDITS: ReadonlySet<ActivityField> = new Set(["description"]);
/** Whether an event changed anything a reader can see. */
export const changed = (event: { field: ActivityField; before: unknown; after: unknown }) =>
  EDITS.has(event.field) || !sameValue(event.before, event.after);

/** Linear's title coalescing (`La`, `Ia = 6e4`): one actor's title edits under a minute apart read as one, at the last. */
const TITLE_MS = 60_000;
/** Jira's changelog as Linear history records. Linear gives every entry of one record its `createdAt` (`Qo`), and a Jira
 *  changelog entry is one record: each change keeps its own entry's time, and nothing merges or cancels across entries,
 *  so every change stays reachable. Adjacent entries group at render (`activityRows`). Only title edits under a minute
 *  apart coalesce, as Linear's `La` does. */
export function historyEvents(changes: readonly Change[]): PropertyActivity[] {
  const events: PropertyActivity[] = [];
  for (const change of [...changes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    const { delta: _, ...event } = change;
    const last = events.at(-1);
    if (
      change.field === "title" &&
      last?.field === "title" &&
      last.actor.id === change.actor.id &&
      Date.parse(change.at) - Date.parse(last.updated ?? last.at) <= TITLE_MS
    ) {
      last.after = change.after;
      last.at = change.at;
      last.updated = change.at;
      continue;
    }
    events.push({ ...event });
  }
  return events;
}

/** One Activity row. Linear (RAJ-52, `Qo`/`ss`) gives each change of a record its own row, except the small kinds
 *  (assignee, project, priority, estimate, labels), which share a row two at a time ("removed priority and added label").
 *  Adjacent rows of a grouped kind (`GROUPED`) join the first: its `chain` holds the later ones, and the row takes the
 *  latest time ("moved to Review, then to Done"). */
export type ActivityRow = {
  id: string;
  actor: Actor;
  at: string;
  field: ActivityField | "multi";
  events: PropertyActivity[];
  chain: PropertyActivity[];
};
/** The kind a row groups as, if it groups: a row of one change. Linear's `ss` makes a labels change that both adds and
 *  removes an aggregated entry, which never groups. */
function groupKind(row: ActivityRow): ActivityField | undefined {
  const [event] = row.events;
  if (row.events.length !== 1 || !event || !GROUPED[event.field]) return;
  if (event.field === "labels") {
    const { added, removed } = labelDelta(event.before, event.after);
    if (added.length && removed.length) return;
  }
  return event.field;
}
/** The rows of the issue's events. `breaks` are the times of entries between them that are not history (comments,
 *  attached links): Linear groups only adjacent entries of one run between comments. */
export function activityRows(
  events: readonly PropertyActivity[],
  breaks: readonly string[] = [],
): ActivityRow[] {
  const records = new Map<string, PropertyActivity[]>();
  for (const event of [...visibleActivity(events)].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      order(a.field) - order(b.field),
  )) {
    const key = `${event.actor.id} ${event.at}${event.field === "relation" ? ` ${event.id}` : ""}`;
    records.set(key, [...(records.get(key) ?? []), event]);
  }
  const between = (from: string, to: string) =>
    breaks.some((time) => Date.parse(from) < Date.parse(time) && Date.parse(time) <= Date.parse(to));
  const rows: ActivityRow[] = [];
  for (const record of records.values()) {
    const small = record.filter((event) => SMALL_FIELDS.has(event.field)),
      chunks = [small.slice(0, 2), small.slice(2, 4), small.slice(4)].filter((chunk) => chunk.length);
    const own: ActivityRow[] = [
      ...record.filter((event) => !SMALL_FIELDS.has(event.field)).map((event) => [event]),
      ...chunks,
    ]
      .sort((a, b) => order(a[0]!.field) - order(b[0]!.field))
      .map((list) => ({
        id: list[0]!.id,
        actor: list[0]!.actor,
        at: list[0]!.at,
        field: list.length > 1 ? ("multi" as const) : list[0]!.field,
        events: list,
        chain: [],
      }));
    // Linear (`Jc`) lists a record's entries of the previous entry's kind first, so they can join its group.
    const last = rows.at(-1)?.field;
    for (const row of [...own.filter((r) => r.field === last), ...own.filter((r) => r.field !== last)]) {
      const previous = rows.at(-1),
        kind = groupKind(row);
      if (
        kind &&
        previous &&
        groupKind(previous) === kind &&
        (!GROUPED[kind]!.sameActor || previous.actor.id === row.actor.id) &&
        !between(previous.at, row.at)
      ) {
        previous.chain.push(row.events[0]!);
        previous.at = row.at;
      } else rows.push(row);
    }
  }
  return rows;
}

/** Jira rejected a write and the issue rolled back from `local` to `jira`: the actor's events for the rejected changes are undone,
 *  so Activity never shows a change Jira doesn't have. A property event takes Jira's value (and drops out when that is its `before`). */
export function rollbackActivity(
  events: readonly PropertyActivity[],
  local: Record<string, unknown>,
  jira: Record<string, unknown>,
  actor: string,
): readonly PropertyActivity[] {
  let next = [...events];
  for (const field of activityFields) {
    if (sameValue(local[field], jira[field])) continue;
    const index = next.findLastIndex(
      (event) =>
        event.field === field && event.actor.id === actor && sameValue(event.after, local[field]),
    );
    if (index < 0) continue;
    const event = { ...next[index]!, after: structuredClone(jira[field] ?? null) };
    next = sameValue(event.before, event.after)
      ? next.toSpliced(index, 1)
      : next.with(index, event);
  }
  const relations = (value: unknown) => (value as Relation[] | undefined) ?? [],
    has = (list: Relation[], r: Relation) => list.some((x) => x.key === r.key && x.kind === r.kind);
  const same = (value: unknown, r: Relation) =>
    !!value && (value as Relation).key === r.key && (value as Relation).kind === r.kind;
  const drop = (match: (event: PropertyActivity) => boolean) => {
    const index = next.findLastIndex(
      (event) => event.field === "relation" && event.actor.id === actor && match(event),
    );
    if (index >= 0) next = next.toSpliced(index, 1);
  };
  for (const r of relations(local.relations))
    if (!has(relations(jira.relations), r))
      drop((event) => event.before === null && same(event.after, r));
  for (const r of relations(jira.relations))
    if (!has(relations(local.relations), r))
      drop((event) => event.after === null && same(event.before, r));
  return next.length === events.length && next.every((event, i) => event === events[i])
    ? events
    : next;
}

/** An Activity entry other than a comment thread, at its time, for the threads to interleave with. */
export type ActivityEvent =
  | { kind: "image-thread"; id: string; at: string; edit: MediaEdit & { comments: ImageComment[] } }
  | { kind: "property"; id: string; at: string; row: ActivityRow }
  | { kind: "link"; id: string; at: string; resource: IssueResource & { created: string } };
/** The issue's image comment threads (one per image, at its first comment), property rows, and attached links. Linear lists a
 *  link while it is attached and drops the row once it is removed (RAJ-52, 2026-11-07). */
export function activityEvents(
  issue: {
    mediaEdits?: Record<string, MediaEdit>;
    activity?: readonly PropertyActivity[];
    resources?: readonly IssueResource[];
  },
  comments: readonly string[] = [],
): ActivityEvent[] {
  // Comments, image threads and attached links sit between history entries, so no group spans them.
  const breaks = [
    ...comments,
    ...Object.values(issue.mediaEdits ?? {}).flatMap((edit) => edit.comments?.[0]?.at ?? []),
    ...(issue.resources ?? []).flatMap((resource) => (resource.kind === "link" && resource.created ? [resource.created] : [])),
  ];
  return [
    ...Object.entries(issue.mediaEdits ?? {}).flatMap(([id, edit]) =>
      edit.comments?.length
        ? [
            {
              kind: "image-thread" as const,
              id,
              at: edit.comments[0]!.at,
              edit: { ...edit, comments: edit.comments },
            },
          ]
        : [],
    ),
    ...activityRows(issue.activity ?? [], breaks).map((row) => ({
      kind: "property" as const,
      id: row.id,
      at: row.at,
      row,
    })),
    ...(issue.resources ?? []).flatMap((resource) =>
      resource.kind === "link" && resource.created
        ? [
            {
              kind: "link" as const,
              id: resource.id,
              at: resource.created,
              resource: { ...resource, created: resource.created },
            },
          ]
        : [],
    ),
  ];
}
