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
export function issuesCSV(
  issues: Pick<Issue, "key" | "summary" | "status" | "priority" | "assignee">[],
): string {
  const cell = (v: string) =>
    `"${(/^[=+@\-\t\r]/.test(v) ? "'" + v : v).replaceAll('"', '""')}"`;
  return [
    ["Identifier", "Title", "Status", "Priority", "Assignee"],
    ...issues.map((i) => [
      i.key,
      i.summary,
      i.status,
      i.priority ?? "",
      i.assignee?.name ?? "",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
