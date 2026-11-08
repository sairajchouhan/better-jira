import { expect, test } from "bun:test";
import { parseDueDate } from "./due-date";
const friday = new Date(2026, 10, 6, 23, 45);
test("natural dates use a reference and local calendar, including future weekdays", () => {
  for (const [text, date] of [
    ["today", "2026-11-06"],
    ["tomorrow", "2026-11-07"],
    ["next Monday", "2026-11-09"],
    ["in 2 weeks", "2026-11-20"],
    ["end of week", "2026-11-06"],
    ["this weekend", "2026-11-07"],
    ["2028-02-29", "2028-02-29"],
  ])
    expect(parseDueDate(text!, friday)).toBe(date!);
  for (const text of [
    "2026-02-29",
    "2026-13-01",
    "do it tomorrow please",
    "3 pm",
    "soon",
    "tomorrow to Monday",
    "",
  ])
    expect(parseDueDate(text, friday)).toBeNull();
});
test("due dates, presets and reminder times share one short date format", async () => {
  const { dueLabel, duePresets } = await import("./due-date");
  const { reminderTime } = await import("./reminder-display");
  expect(dueLabel("2026-11-09", friday)).toBe("Nov 9");
  expect(dueLabel("2027-02-09", friday)).toBe("Feb 9, 2027");
  expect(duePresets(friday).map((p) => p.label)).toEqual(["Nov 7", "Nov 6", "Nov 13"]);
  expect(reminderTime(new Date(2026, 10, 8, 19, 4).toISOString())).toBe("Nov 8, 7:04 PM");
});
