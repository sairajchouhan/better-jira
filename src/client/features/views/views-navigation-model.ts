import { type Issue } from "@/shared/issue-model";

/** The page an empty result is on: a saved view (or the view editor), a board tab, or a personal page tab. */
export type ResultPage = "view" | "tab" | "person";
/**
 * What a view says about its results, `baseline` counting what it shows with no temporary filter (`temporary`).
 * - `empty`: the page holds no issue at all, so it draws its own empty state (Linear's `zeroStateFallback`: a board tab's
 *   ViewEmptyState, My issues' MyIssuesEmptyPage, which MyIssuesViewPage `pe` shows whenever the tab has no issues,
 *   filtered or not).
 * - `saved`: a saved view whose own definition matches nothing: only "No matching issues" (HiddenIndicator, no fallback).
 * - `filtered`: a filter leaves nothing; `hidden` is how many it hides, 0 when the page was empty before it.
 * - `partial`: some issues show and `hidden` more are filtered out.
 * Every kind but `partial` is the zero state: it stands in for the groups (view-model.ts `drawnGroups`).
 */
export type ResultFeedback =
  | { kind: "empty" }
  | { kind: "saved"; text: string }
  | { kind: "filtered" | "partial"; text: string; hidden: number };

export function resultFeedback(count: number, baseline: number, page: ResultPage, temporary: boolean): ResultFeedback | null {
  if (!count) {
    if (page === "person" && !baseline) return { kind: "empty" };
    if (page === "view" && (!temporary || !baseline)) return { kind: "saved", text: "No matching issues" };
    // HiddenIndicator: no filter and nothing hidden shows the page's fallback; a filter with nothing hidden says so.
    if (!baseline && !temporary) return { kind: "empty" };
    return { kind: "filtered", text: "No issues matching the filters", hidden: baseline };
  }
  const hidden = Math.max(0, baseline - count);
  return hidden ? { kind: "partial", text: `${hidden} issue${hidden === 1 ? "" : "s"} hidden by filters`, hidden } : null;
}
export function viewSummaries(issues: Issue[]) {
  const assignees = new Map<string, number>(), labels = new Map<string, number>();
  for (const issue of issues) {
    const name = issue.assignee?.name ?? "Unassigned";
    assignees.set(name, (assignees.get(name) ?? 0) + 1);
    for (const label of new Set(issue.labels)) labels.set(label, (labels.get(label) ?? 0) + 1);
  }
  const sort = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { assignees: sort(assignees), labels: sort(labels) };
}
