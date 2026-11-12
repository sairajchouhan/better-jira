import { expect, test } from "bun:test";
import { parseReminder, reminderPresets } from "./reminder-date";
const date = new Date(2026, 10, 7, 15, 12);
test("reminder presets follow chronological order and input accepts future times without dropping the time", () => {
  const presets = reminderPresets(date);
  expect(presets.map((p) => p.label).slice(0, 3)).toEqual([
    "An hour from now",
    "This evening",
    "In 3 hours",
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
