import { type Board, type Issue } from "@/shared/issue-model";
import { test, expect } from "bun:test";
import { viewPlaceholder, issuesCSV } from "./view-editor-model";

const board: Board = {
  id: 1,
  name: "SAM1 board",
  columns: [{ statuses: [{ id: "10000", name: "To Do" }] }],
} as Board;
const issue = (patch: Partial<Issue> = {}): Issue => ({
  key: "RAJ-1",
  board: 1,
  summary: "Title",
  status: "10000",
  assignee: null,
  labels: [],
  comments: 0,
  updated: "2026-11-08T00:00:00.000Z",
  resolved: null,
  ...patch,
});
test("draft placeholder uses filters and defaults to All issues", () => {
  expect(viewPlaceholder({ id: "root", join: "and", children: [] })).toBe(
    "All issues",
  );
  expect(
    viewPlaceholder({
      id: "root",
      join: "and",
      children: [{ id: "s", field: "status", op: "is", values: ["Todo"] }],
    }),
  ).toBe("Todo");
});
test("CSV quotes multiline fields and neutralizes spreadsheet formulas", () => {
  const csv = issuesCSV([issue({ summary: '=HYPERLINK("x")\nnext' })], board);
  expect(csv).toContain('"\'=HYPERLINK(""x"")\nnext"');
  expect(csv.split("\r\n")).toHaveLength(2);
});

test("BJ-139: CSV uses Linear's columns, status names and No priority", () => {
  const [head, row] = issuesCSV(
    [issue({ labels: ["Epic", "UI"], assignee: { id: "u", name: "Raj" } })],
    board,
  ).split("\r\n");
  expect(head).toStartWith('"ID","Space","Title","Description","Status","Estimate","Priority"');
  expect(row).toStartWith('"RAJ-1","SAM1 board","Title","","To Do","","No priority"');
  expect(row).toContain('"Raj","Epic, UI"');
  expect(row).not.toContain("10000");
});

test("BJ-151: CSV timestamps use UTC while due dates remain calendar dates", () => {
  const csv = issuesCSV([issue({ created: "2026-11-08T05:30:00+05:30", updated: "2026-11-08T00:00:00Z", started: "2026-11-07T19:00:00-05:00", resolved: "2026-11-08T00:00:00.000Z", due: "2026-11-09" })], board);
  expect(csv.match(/2026-11-08T00:00:00.000Z/g)).toHaveLength(4);
  expect(csv).toContain('"2026-11-09"');
});

test("BJ-247: CSV Epic is the issue's epic and Parent issue its parent issue, never that epic", () => {
  const epic = issue({ key: "RAJ-9", type: "Epic", summary: "Billing" });
  const task = issue({ key: "RAJ-10", parent: "RAJ-9", project: { key: "RAJ", name: "Jira project" } });
  const sub = issue({ key: "RAJ-11", type: "Sub-task", parent: "RAJ-10" });
  const rows = issuesCSV([task, sub], board, (key) => [epic, task, sub].find((i) => i.key === key))
    .split("\r\n")
    .map((row) => row.split('","'));
  const [head] = rows;
  const column = (name: string) => head!.findIndex((cell) => cell.replaceAll('"', "") === name);
  expect(rows[1]![column("Epic")]).toBe("Billing");
  expect(rows[1]![column("Parent issue")]!.replaceAll('"', "")).toBe("");
  expect(rows[2]![column("Epic")]).toBe("Billing");
  expect(rows[2]![column("Parent issue")]!.replaceAll('"', "")).toBe("RAJ-10");
});
