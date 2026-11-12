import { activityFields } from "@/shared/issue-model";
import type { ActivityField, PropertyActivity } from "@/shared/issue-model";
import { type ImageComment, type MediaEdit } from "@/shared/issue-model";

import type { IssueResource } from "@/shared/issue-resource";
/** Local property history, kept the way Linear keeps an actor's edits (observed on RAJ-52, 2026-11-07/08):
 * an edit joins the actor's latest group while that group was last edited under GROUP_MS ago, and the group keeps its first time;
 * a field already in the group is updated, and hidden (but kept) when it returns to its value before the group. */
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
export const visibleActivity = (events: readonly PropertyActivity[]) =>
  events.filter((event) => !sameValue(event.before, event.after));

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

/** One Activity row. Linear (RAJ-52) gives a status change its own row; the group's other changes share one row ("removed priority and added label").
 *  A row of one change that follows the same actor's row of the same field, with nothing else in either group, joins it: "set priority to Low, then removed priority", at the later time. */
export type ActivityRow = {
  id: string;
  actor: { id: string; name: string };
  at: string;
  field: ActivityField | "multi";
  events: PropertyActivity[];
  chain: PropertyActivity[];
};
export function activityRows(events: readonly PropertyActivity[]): ActivityRow[] {
  const groups = new Map<string, PropertyActivity[]>();
  for (const event of [...visibleActivity(events)].sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      (activityFields as readonly string[]).indexOf(a.field) -
        (activityFields as readonly string[]).indexOf(b.field),
  )) {
    const key = `${event.actor.id} ${event.at}${event.field === "relation" ? ` ${event.id}` : ""}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const rows: ActivityRow[] = [];
  let previous: ActivityRow | undefined;
  for (const group of groups.values()) {
    const status = group.filter((event) => event.field === "status"),
      rest = group.filter((event) => event.field !== "status");
    const own = [...status.map((event) => [event]), ...(rest.length ? [rest] : [])].map((list) => ({
      id: list[0]!.id,
      actor: list[0]!.actor,
      at: list[0]!.at,
      field: list.length > 1 ? ("multi" as const) : list[0]!.field,
      events: list,
      chain: [],
    }));
    const single = own.length === 1 && own[0]!.events.length === 1 ? own[0]! : undefined;
    if (
      single &&
      single.field !== "relation" &&
      previous &&
      previous === rows.at(-1) &&
      previous.actor.id === single.actor.id &&
      previous.field === single.field
    ) {
      previous.chain.push(single.events[0]!);
      previous.at = single.at;
      continue;
    }
    rows.push(...own);
    previous = single;
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
export function activityEvents(issue: {
  mediaEdits?: Record<string, MediaEdit>;
  activity?: readonly PropertyActivity[];
  resources?: readonly IssueResource[];
}): ActivityEvent[] {
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
    ...activityRows(issue.activity ?? []).map((row) => ({
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
