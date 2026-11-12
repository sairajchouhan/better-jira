import type { SavedView } from "@/shared/saved-view-model";
import type { Issue } from "@/client/state/store";
export function directoryViews(views: SavedView[], board: number, descending = false, sort: "name" | "owner" = "name") {
  return views.filter(v => v.board === board && v.kind === "custom").sort((a, b) => (sort === "name" && descending ? -1 : 1) * a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
/** `baseline` counts the saved definition alone; `total` counts the board with no filters. Empty states keep Linear's hidden count. */
export function resultFeedback(count: number, baseline: number, saved: boolean, temporary: boolean) {
  if (!count) {
    // Linear: a saved view whose own definition matches nothing shows only "No matching issues".
    if (saved && (!temporary || baseline === 0)) return { text: "No matching issues", saved: true, hidden: 0 };
    return { text: "No issues matching the filters", saved: false, hidden: baseline };
  }
  const hidden = Math.max(0, baseline - count);
  return hidden ? { text: `${hidden} issue${hidden === 1 ? "" : "s"} hidden by filters`, saved: false, hidden } : null;
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
