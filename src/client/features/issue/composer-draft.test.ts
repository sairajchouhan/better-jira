import { expect, test } from "bun:test";
import { type IssueDraft } from "@/shared/issue-model";
import { switchBoard } from "./composer-draft";

test("R3-create-D5: switching board keeps the board-independent properties and drops the board's own", () => {
  const draft: IssueDraft = {
    board: 1,
    title: "Kept",
    priority: "High",
    labels: ["a"],
    due: "2026-11-15",
    status: "todo",
    assignee: { id: "u", name: "U", avatar: "" },
    project: { key: "P", name: "P" },
    milestones: [{ id: "1", name: "v1" }],
  };
  expect(switchBoard(draft, 1, 2)).toEqual({ board: 2, title: "Kept", priority: "High", labels: ["a"], due: "2026-11-15" });
  expect(switchBoard(draft, 1, 1)).toBe(draft);
});

