import type { Board, Issue } from "./store";
import type { FilterGroup } from "./view-model";
import { statusById, statuses } from "./board-catalog";
export function viewPlaceholder(filters: FilterGroup, board?: Board): string {
  const values: string[] = [];
  const visit = (g: FilterGroup) => {
    for (const rule of g.children) {
      if ("children" in rule) visit(rule);
      else if (rule.op === "is")
        for (const value of rule.values) {
          values.push(
            rule.field === "status"
              ? (statusById(board, value)?.name ?? value)
              : value,
          );
        }
    }
  };
  visit(filters);
  return values.length ? values.join(", ") : "All issues";
}
/** Linear's export columns, in its order, for the fields a Jira issue has. Status and priority are names, like Linear. */
export function issuesCSV(issues: Issue[], board: Board): string {
  const names = new Map(
    statuses(board).map((s) => [s.id, s.name]),
  );
  const cell = (v: string) =>
    `"${(/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`;
  // Timestamp columns all use UTC; Due Date remains a calendar date.
  const timestamp = (value: string | null | undefined) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  };
  return [
    ["ID", "Team", "Title", "Description", "Status", "Estimate", "Priority", "Project", "Creator", "Assignee", "Labels", "Created", "Updated", "Started", "Completed", "Due Date", "Parent issue"],
    ...issues.map((i) => [
      i.key,
      board.name,
      i.summary,
      i.description ?? "",
      names.get(i.status) ?? i.status,
      i.estimate?.toString() ?? "",
      i.priority ?? "No priority",
      i.project?.name ?? "",
      i.creator?.name ?? "",
      i.assignee?.name ?? "",
      i.labels.join(", "),
      timestamp(i.created),
      timestamp(i.updated),
      timestamp(i.started),
      timestamp(i.resolved),
      i.due ?? "",
      i.parent ?? "",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
