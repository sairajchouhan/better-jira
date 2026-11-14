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
