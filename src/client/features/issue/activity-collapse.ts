/**
 * Linear's Activity collapse (`ActivityHistoryCollapse` in its bundle, read 2026-11-12). A run of history entries between
 * discussions folds its middle into one "Show N events: changed status and priority, added links…" row, keeping the run's
 * first entries and its recent ones. How much folds depends on where the run sits.
 */
import type { ActivityField, PropertyActivity } from "./issue-activity";

export type RunPosition = "only" | "first" | "last" | "middle";
const HOUR = 3_600_000,
  DAY = 24 * HOUR;

/** `partition`: entries since 4h ago are recent. So are those up to 5 minutes before the next discussion, when that is
 *  under 4 days old. The run folds from `start` until its recent tail. Fewer than `minHidden` folded means nothing folds. */
export function partition<T>(
  entries: readonly T[],
  options: {
    position: RunPosition;
    now: number;
    at: (entry: T) => string | undefined;
    nextDiscussion?: string;
    minHidden?: number;
  },
): { before: T[]; hidden: T[]; after: T[] } {
  const { position, now, at, minHidden = 2 } = options;
  const next = options.nextDiscussion ? Date.parse(options.nextDiscussion) : undefined;
  const nearNext = next !== undefined && next >= now - 4 * DAY ? next - 5 * 60_000 : undefined;
  const firstRecent = entries.findIndex((entry) => {
    const time = at(entry);
    if (time === undefined) return true;
    const ms = Date.parse(time);
    return ms >= now - 4 * HOUR || (nearNext !== undefined && ms >= nearNext);
  });
  const recent = firstRecent === -1 ? 0 : entries.length - firstRecent;
  const [fold, start, end] = {
    only: [entries.length >= 9, 3, Math.max(3, recent)],
    first: [entries.length >= 5, 3, recent],
    last: [entries.length >= 4, 0, Math.max(2, recent)],
    middle: [entries.length >= 2, 0, recent],
  }[position] as [boolean, number, number];
  if (!fold || entries.length - start - end < minHidden) return { before: [...entries], hidden: [], after: [] };
  const cut = entries.length - end;
  return { before: entries.slice(0, start), hidden: entries.slice(start, cut), after: entries.slice(cut) };
}

/** One entry's part in the summary (`ll`): what was done, to what, and how much it matters (1 high … 3 low). */
export type SummaryItem = { action?: "changed" | "added"; value: string; weight: 1 | 2 | 3 };
const ITEMS: Record<ActivityField, SummaryItem> = {
  status: { action: "changed", value: "status", weight: 1 },
  assignee: { action: "changed", value: "assignee", weight: 1 },
  project: { action: "changed", value: "project", weight: 1 },
  priority: { action: "changed", value: "priority", weight: 1 },
  estimate: { action: "changed", value: "estimate", weight: 2 },
  team: { action: "changed", value: "team", weight: 2 },
  title: { action: "changed", value: "title", weight: 2 },
  labels: { action: "changed", value: "labels", weight: 2 },
  due: { action: "changed", value: "due date", weight: 2 },
  weblink: { action: "added", value: "links", weight: 2 },
  milestone: { action: "changed", value: "milestone", weight: 3 },
  cycle: { action: "changed", value: "cycles", weight: 3 },
  relation: { action: "changed", value: "related issues", weight: 3 },
  parent: { action: "changed", value: "related issues", weight: 3 },
  // Jira-only kinds, in the same pattern.
  type: { action: "changed", value: "issue type", weight: 2 },
  resolution: { action: "changed", value: "resolution", weight: 2 },
  description: { action: "changed", value: "description", weight: 2 },
  attachment: { action: "changed", value: "attachments", weight: 2 },
  component: { action: "changed", value: "components", weight: 3 },
  flag: { action: "changed", value: "flag", weight: 3 },
  field: { action: "changed", value: "fields", weight: 3 },
};
export const summaryItems = (events: readonly PropertyActivity[]): SummaryItem[] =>
  events.map((event) => ITEMS[event.field]);

/** Linear's list join: "a", "a and b", "a, b, and c". */
const list = (values: string[]) =>
  values.length < 3 ? values.join(" and ") : `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
const ACTIONS = ["changed", "added", undefined] as const;
const byWeight = (a: SummaryItem, b: SummaryItem) => a.weight - b.weight;

/** The folded row's words: "Show 5 events: changed priority, status, and related issues, added links…". */
export function collapseLabel(count: number, items: readonly SummaryItem[]): string {
  const show = `Show ${count} ${count === 1 ? "event" : "events"}`;
  const ranked = ACTIONS.flatMap((action) => {
    const seen = new Set<string>();
    return items
      .filter((item) => item.action === action && !seen.has(item.value) && seen.add(item.value))
      .sort(byWeight);
  })
    .sort(byWeight)
    .slice(0, 5);
  const groups = ACTIONS.flatMap((action) => {
    const values = ranked.filter((item) => item.action === action).map((item) => item.value);
    return values.length ? [action ? `${action} ${list(values)}` : list(values)] : [];
  });
  return groups.length ? `${show}: ${groups.join(", ")}…` : show;
}
