import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { dateValueLabel, filterChoices } from "./property-filter";


const board: Board = { id: 1, name: "Board", columns: [] };
const issue = (key: string, priority: string): Issue => ({
  key,
  board: 1,
  summary: key,
  status: "todo",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-06T10:00:00Z",
  resolved: null,
  priority,
});

test("R1-D91: priority choices follow rank, like Linear, not the alphabet", () => {
  const issues = ["Low", "High", "Normal", "Urgent"].map((p, i) => issue(`A-${i}`, p));
  expect(filterChoices("priority", board, issues).map((c) => c.label)).toEqual([
    "No priority",
    "Urgent",
    "High",
    "Normal",
    "Low",
  ]);
});

test("5.3 5.4: Priority and Labels offer the site's every value, not only those in use", () => {
  const issues = [issue("A-1", "High")];
  const catalog = { priorities: ["Urgent", "High", "Low"], labels: ["beta", "alpha"] };
  expect(filterChoices("priority", board, issues, issues, catalog).map((c) => [c.label, c.count])).toEqual([
    ["No priority", 0],
    ["Urgent", 0],
    ["High", 1],
    ["Low", 0],
  ]);
  expect(filterChoices("labels", board, issues, issues, catalog).map((c) => c.label)).toEqual(["No labels", "alpha", "beta"]);
});

test("R3-views-filters-D-7: the Overdue preset's chip names it Overdue, as Linear's due-date block labels P0D", () => {
  expect(dateValueLabel("due", "P0D", String)).toBe("Overdue");
  expect(dateValueLabel("created", "P0D", String)).toBe("today");
  expect(dateValueLabel("due", "2026-11-20", (v) => `on ${v}`)).toBe("on 2026-11-20");
});

test("Project offers the board's epics with their issue counts, and No project counts the issues with no epic", () => {
  const at = (key: string, patch: Partial<Issue>): Issue => ({ ...issue(key, "Low"), ...patch });
  const issues = [
    at("A-1", { type: "Epic", summary: "Billing", priority: "High", labels: ["roadmap"] }),
    at("A-2", { parent: "A-1" }),
    at("A-3", { type: "Sub-task", parent: "A-2" }),
    at("A-4", { project: { key: "A", name: "Jira project" } }),
    // An issue in an epic the mirror doesn't hold.
    at("A-5", { parent: "A-99", parentLevel: 1 }),
  ];
  const rows = (field: Parameters<typeof filterChoices>[0], matching = issues) =>
    filterChoices(field, board, issues, matching).map((c) => [c.label, c.count]);
  // The Jira project ("Jira project") is Linear's team, never a Project value.
  expect(rows("project")).toEqual([
    ["No project", 1],
    ["A-99", 1],
    ["Billing", 3],
  ]);
  // Counts follow the view, while the epic still resolves when the view hides it.
  expect(rows("project", [issues[1]!, issues[3]!])).toEqual([
    ["No project", 1],
    ["A-99", 0],
    ["Billing", 1],
  ]);
  expect(rows("projectLabels")).toContainEqual(["roadmap", 3]);
  expect(rows("projectPriority").find(([label]) => label === "High")).toEqual(["High", 3]);
});
