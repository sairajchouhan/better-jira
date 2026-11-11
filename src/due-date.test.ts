import { expect, test } from "bun:test";
import { shortDate } from "./due-date";
import { parseDueDate } from "./due-parse";
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
  const { duePresets } = await import("./due-date");
  const { reminderTime } = await import("./reminder-display");
  expect(shortDate("2026-11-09", friday)).toBe("Nov 9");
  expect(shortDate("2027-02-09", friday)).toBe("Feb 9, 2027");
  expect(duePresets(friday).map((p) => p.label)).toEqual(["Nov 7", "Nov 6", "Nov 13"]);
  expect(reminderTime(new Date(2026, 10, 8, 19, 4).toISOString())).toBe("Nov 8, 7:04 PM");
});

test("R1-D50/D60: short dates omit this year, like Linear, and keep date-only values local", () => {
  const now = new Date(2026, 10, 8);
  expect(shortDate("2026-11-09", now)).toBe("Nov 9");
  expect(shortDate(new Date(2026, 10, 8, 9).toISOString(), now)).toBe("Nov 8");
  expect(shortDate("2025-10-03", now)).toBe("Oct 3, 2025");
});
test("R2-issue-fields-D7: due date properties read Yesterday, Today and Tomorrow, like Linear", () => {
  const now = new Date(2026, 10, 8, 21, 30);
  expect(shortDate("2026-11-07", now, true)).toBe("Yesterday");
  expect(shortDate("2026-11-08", now, true)).toBe("Today");
  expect(shortDate("2026-11-09", now, true)).toBe("Tomorrow");
  expect(shortDate("2026-11-10", now, true)).toBe("Nov 10");
  expect(shortDate("2026-11-09", now)).toBe("Nov 9");
});
