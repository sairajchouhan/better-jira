import { test, expect } from "bun:test";
import { viewPlaceholder, issuesCSV } from "./view-editor-model";
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
  const csv = issuesCSV([
    {
      key: "RAJ-1",
      summary: '=HYPERLINK("x")\nnext',
      status: "Todo",
      assignee: null,
    },
  ]);
  expect(csv).toContain('"\'=HYPERLINK(""x"")\nnext"');
  expect(csv.split("\r\n")).toHaveLength(2);
});
