import type { Board, Issue } from "./store";
import type { FilterGroup } from "./view-model";
export function viewPlaceholder(filters: FilterGroup, board?: Board): string {
  const values: string[] = [];
  const visit = (g: FilterGroup) => {
    for (const rule of g.children) {
      if ("children" in rule) visit(rule);
      else if (rule.op === "is")
        for (const value of rule.values) {
          values.push(
            rule.field === "status"
              ? (board?.columns
                  .flatMap((c) => c.statuses)
                  .find((s) => s.id === value)?.name ?? value)
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
  const statuses = new Map(
    board.columns.flatMap((c) => c.statuses).map((s) => [s.id, s.name]),
  );
  const cell = (v: string) =>
    `"${(/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`;
  return [
    ["ID", "Team", "Title", "Description", "Status", "Estimate", "Priority", "Project", "Creator", "Assignee", "Labels", "Created", "Updated", "Started", "Completed", "Due Date", "Parent issue"],
    ...issues.map((i) => [
      i.key,
      board.name,
      i.summary,
      i.description ?? "",
      statuses.get(i.status) ?? i.status,
      i.estimate?.toString() ?? "",
      i.priority ?? "No priority",
      i.project?.name ?? "",
      i.creator?.name ?? "",
      i.assignee?.name ?? "",
      i.labels.join(", "),
      i.created ?? "",
      i.updated,
      i.started ?? "",
      i.resolved ?? "",
      i.due ?? "",
      i.parent ?? "",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
