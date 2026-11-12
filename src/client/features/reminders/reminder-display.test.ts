import { expect, test } from "bun:test";
import { nextReminder } from "./reminder-display";

test("nextReminder picks the earliest undelivered issue or document reminder", () => {
  const issues = new Map([
    ["A-1", { key: "A-1", reminder: { at: "2026-11-12T10:00:00Z" } }],
    ["A-2", { key: "A-2", reminder: { at: "2026-11-12T08:00:00Z", delivered: true } }],
    [
      "A-3",
      {
        key: "A-3",
        resources: [{ id: "doc", reminder: { at: "2026-11-12T09:00:00Z" } }],
      },
    ],
  ]);
  expect(nextReminder(issues)).toBe("2026-11-12T09:00:00Z\nA-3\ndoc");
  expect(nextReminder(new Map([["A-1", issues.get("A-1")!]]))).toBe("2026-11-12T10:00:00Z\nA-1\n");
  expect(nextReminder(new Map())).toBe("");
});
