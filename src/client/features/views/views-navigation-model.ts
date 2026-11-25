import { compareText } from "@/shared/compare";
import { type Issue } from "@/shared/issue-model";

/** The page an empty result is on: a saved view (or the view editor), a board tab, or a personal page tab. */
export type ResultPage = "view" | "tab" | "person";
/**
 * What a view says about its results, `baseline` counting what it shows with no temporary filter (`temporary`), and
 * `displayHidden` how many its display options hide.
 * - `empty`: the page holds no issue at all, so it draws its own empty state (Linear's `zeroStateFallback`: a board tab's
 *   ViewEmptyState, My issues' MyIssuesEmptyPage, which MyIssuesViewPage `pe` shows whenever the tab has no issues,
 *   filtered or not). Only while display options hide nothing: IssueList `df` draws the placeholder only when no item is
 *   hidden, so a page whose issues are all hidden by display options keeps its "hidden by display options" line.
 * - `saved`: a saved view whose own definition matches nothing: only "No matching issues" (HiddenIndicator, no fallback).
 * - `filtered`: a filter leaves nothing; `hidden` is how many it hides, 0 when the page was empty before it.
 * - `partial`: some issues show and `hidden` more are filtered out.
 * Every kind but `partial` is the zero state: it stands in for the groups (view-model.ts `drawnGroups`).
 */
export type ResultFeedback =
  | { kind: "empty" }
  | { kind: "saved"; text: string }
  | { kind: "filtered" | "partial"; text: string; hidden: number };

export function resultFeedback(count: number, baseline: number, page: ResultPage, temporary: boolean, displayHidden = 0): ResultFeedback | null {
  if (!count) {
    const empty = !baseline && !displayHidden;
    if (page === "person" && empty) return { kind: "empty" };
    if (page === "view" && (!temporary || !baseline)) return { kind: "saved", text: "No matching issues" };
    // HiddenIndicator: no filter and nothing hidden shows the page's fallback; a filter with nothing hidden says so.
    if (empty && !temporary) return { kind: "empty" };
    if (!baseline && !temporary) return null;
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
  const sort = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]));
  return { assignees: sort(assignees), labels: sort(labels) };
}
