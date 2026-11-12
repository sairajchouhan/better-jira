import { expect, test } from "bun:test";
import { parseReminder, reminderPresets } from "./reminder-date";
const date = new Date(2026, 10, 7, 15, 12);
test("CORE-25: reminder presets keep Linear's fixed order, not time order, and input accepts future times without dropping the time", () => {
  const presets = reminderPresets(date);
  // At 15:12 "This evening" (18:00) comes before "In 3 hours" (18:12) in time; Linear still lists it after.
  expect(presets.map((p) => p.label)).toEqual([
    "An hour from now",
    "In 3 hours",
    "This evening",
    "Tomorrow",
    "Next week",
    "A month from now",
  ]);
  expect(presets[0]?.at).toBe(new Date(+date + 3600000).toISOString());
  expect(parseReminder("in 2 hours", date)).toBe(new Date(+date + 7200000).toISOString());
  expect(parseReminder("yesterday", date)).toBeNull();
  expect(parseReminder("nonsense", date)).toBeNull();
  expect(parseReminder("4 pm", date)).toBe(new Date(2026, 10, 7, 16).toISOString());
});
test("forward times roll to tomorrow and date-only language agrees with the 9am presets", () => {
  const afternoon = new Date(2026, 10, 7, 17, 20);
  expect(parseReminder("4 pm", afternoon)).toBe(new Date(2026, 10, 8, 16).toISOString());
  expect(parseReminder("4 pm trailing junk", afternoon)).toBeNull();
  expect(parseReminder("tomorrow", afternoon)).toBe(
    reminderPresets(afternoon).find((p) => p.label === "Tomorrow")?.at ?? null,
  );
});
