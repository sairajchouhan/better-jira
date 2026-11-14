import { expect, test } from "bun:test";
import { defaultTimeOptions, timeDetail } from "@/shared/time-options";
import { typedTimeOption } from "./typed-time";

const at = (input: string, now: Date) => typedTimeOption(input, now)?.at ?? null;
const date = new Date(2026, 10, 7, 15, 12);

test("_F.generateTimeOptionsForInput: typed times are future times, and nothing else is", () => {
  expect(at("in 2 hours", date)).toBe(new Date(+date + 7200000).toISOString());
  expect(at("4 pm", date)).toBe(new Date(2026, 10, 7, 16).toISOString());
  expect(at("yesterday", date)).toBeNull();
  expect(at("nonsense", date)).toBeNull();
  expect(at("", date)).toBeNull();
  // A time already past today is tomorrow's; trailing words make it no time at all.
  const afternoon = new Date(2026, 10, 7, 17, 20);
  expect(at("4 pm", afternoon)).toBe(new Date(2026, 10, 8, 16).toISOString());
  expect(at("4 pm trailing junk", afternoon)).toBeNull();
  // A day without an hour is at 9:00, as the presets are.
  expect(at("tomorrow", afternoon)).toBe(defaultTimeOptions(afternoon).find((p) => p.label === "Tomorrow")!.at);
  // "tonight" keeps its evening once 9:00 has passed.
  expect(at("tonight", date)).toBe(new Date(2026, 10, 7, 22).toISOString());
});

test("Linear's short durations: a number and the start of a unit, number words and 'a'", () => {
  expect(at("1h", date)).toBe(new Date(+date + 3600000).toISOString());
  expect(at("90 mins", date)).toBe(new Date(+date + 90 * 60000).toISOString());
  // "1m" is a minute and "1mo" a month, in Linear's unit order.
  expect(at("10m", date)).toBe(new Date(+date + 10 * 60000).toISOString());
  expect(at("1mo", date)).toBe(new Date(2026, 11, 7, 9).toISOString());
  // Whole days, weeks and years land at 9:00.
  expect(at("2d", date)).toBe(new Date(2026, 10, 9, 9).toISOString());
  expect(at("two days", date)).toBe(new Date(2026, 10, 9, 9).toISOString());
  expect(at("in 3 w", date)).toBe(new Date(2026, 10, 28, 9).toISOString());
  expect(at("a week", date)).toBe(new Date(2026, 10, 14, 9).toISOString());
  expect(at("1y", date)).toBe(new Date(2027, 10, 7, 9).toISOString());
});

test("_F.formatOptionLabel and detailControl name a typed row", () => {
  const option = (input: string) => {
    const o = typedTimeOption(input, date)!;
    return [o.label, o.detail];
  };
  expect(option("10 min")).toEqual(["In 10 minutes", timeDetail(+date + 10 * 60000)]);
  expect(option("2 days")).toEqual(["In 2 days", timeDetail(new Date(2026, 10, 9, 9).getTime())]);
  expect(option("1h")).toEqual(["In 1 hour", timeDetail(+date + 3600000)]);
  expect(option("4 pm")).toEqual(["Today at 4:00 PM", "in about 1 hour"]);
  expect(option("tomorrow 3pm")).toEqual(["Tomorrow at 3:00 PM", "in 1 day"]);
  expect(option("wednesday")).toEqual(["Wednesday at 9:00 AM", "in 4 days"]);
  expect(option("nov 30")).toEqual(["Monday, November 30, 9:00 AM", "in 23 days"]);
  expect(option("jan 15 2028")[0]).toBe("Saturday, January 15, 2028, 9:00 AM");
});
