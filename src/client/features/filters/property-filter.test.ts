import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { filterChoices } from "./property-filter";


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
