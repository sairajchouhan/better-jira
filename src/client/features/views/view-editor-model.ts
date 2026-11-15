import { type Board, type Issue } from "@/shared/issue-model";

import type { Field, FilterGroup } from "@/shared/view-model";
import { choiceLabels, type FilterCatalog } from "@/client/features/filters/property-filter";
import { statuses } from "@/shared/board-catalog";
import { epicName, epicOf, lookupIn, parentOf, type IssueLookup } from "@/shared/epics";
/** The view name the editor suggests while its name is empty: the filtered values, by the names the filter chips show (a
 *  status's name, a person's, "Current user" for `$me`), else Linear's fallback `All issues` (`Z`: `All ${modelType}`). */
export function viewPlaceholder(
  filters: FilterGroup,
  name: (field: Field, value: string) => string = (_field, value) => value,
): string {
  const values: string[] = [];
  const visit = (g: FilterGroup) => {
    for (const rule of g.children) {
      if ("children" in rule) visit(rule);
      else if (rule.op === "is") for (const value of rule.values) values.push(name(rule.field, value));
    }
  };
  visit(filters);
  return values.length ? values.join(", ") : "All issues";
}
/** A filter value's name as its chip shows it, for `viewPlaceholder`; the raw value when the board has no such choice. */
export const filterValueName =
  (board: Board | undefined, issues: Map<string, Issue>, catalog: FilterCatalog) =>
  (field: Field, value: string) =>
    (board && choiceLabels(field, board, issues, catalog).find((c) => c.value === value)?.label) ?? value;
/** Linear's export columns, in its order, for the fields a Jira issue has. Status and priority are names, like Linear. Project is
 *  the issue's epic and Parent issue its parent issue, never that epic (shared/epics.ts); `lookup` finds them beyond `issues`. */
export function issuesCSV(issues: Issue[], board: Board, lookup: IssueLookup = lookupIn(issues)): string {
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
    ["ID", "Space", "Title", "Description", "Status", "Estimate", "Priority", "Epic", "Creator", "Assignee", "Labels", "Created", "Updated", "Started", "Completed", "Due Date", "Parent issue"],
    ...issues.map((i) => [
      i.key,
      board.name,
      i.summary,
      i.description ?? "",
      names.get(i.status) ?? i.status,
      i.estimate?.toString() ?? "",
      i.priority ?? "No priority",
      ((epic) => (epic ? epicName(epic, lookup) : ""))(epicOf(i, lookup)),
      i.creator?.name ?? "",
      i.assignee?.name ?? "",
      i.labels.join(", "),
      timestamp(i.created),
      timestamp(i.updated),
      timestamp(i.started),
      timestamp(i.resolved),
      i.due ?? "",
      parentOf(i, lookup) ?? "",
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
