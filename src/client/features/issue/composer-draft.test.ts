import { expect, test } from "bun:test";
import { SUMMARY_MAX, switchBoard } from "./composer-draft";

test("R3-create-D5: switching board keeps the board-independent properties and drops the board's own", () => {
  const draft = {
    board: 1,
    title: "Kept",
    priority: "High",
    labels: ["a"],
    due: "2026-11-15",
    status: "todo",
    assignee: { id: "u", name: "U", avatar: "" },
    project: "P",
    milestones: ["v1"],
  };
  expect(switchBoard(draft, 1, 2)).toEqual({ board: 2, title: "Kept", priority: "High", labels: ["a"], due: "2026-11-15" });
  expect(switchBoard(draft, 1, 1)).toBe(draft);
});

test("R3-create-D4: titles stop at Jira's summary limit", () => {
  expect(SUMMARY_MAX).toBe(255);
});
