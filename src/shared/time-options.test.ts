import { expect, test } from "bun:test";
import {
  defaultTimeOptions,
  menuTimeOptions,
  shortDistance,
  snoozedFor,
  timeDetail,
  typedLabel,
  unsnoozedAgo,
  type TimeOption,
} from "./time-options";

const MIN = 60_000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR;

test("_F.generateDefaultTimeOptions: Linear's presets, sorted by time, the evening only an hour or more ahead, days at 9:00", () => {
  const labels = (now: Date) =>
    defaultTimeOptions(now).map((c) => `${c.label} ${new Date(c.at).toString().slice(0, 21)}`);
  // Sunday 15:30: the evening (18:00) comes before "In 3 hours" (18:30), as Linear sorts them; next week is Monday.
  expect(labels(new Date(2026, 10, 8, 15, 30))).toEqual([
    "An hour from now Sun Nov 08 2026 16:30",
    "This evening Sun Nov 08 2026 18:00",
    "In 3 hours Sun Nov 08 2026 18:30",
    "Tomorrow Mon Nov 09 2026 09:00",
    "Next week Mon Nov 09 2026 09:00",
    "A month from now Tue Dec 08 2026 09:00",
  ]);
  // Monday 17:30: the evening is under an hour away, so it is not offered; next week is the Monday after.
  expect(labels(new Date(2026, 10, 9, 17, 30)).map((l) => l.split(" 2026")[0])).toEqual([
    "An hour from now Mon Nov 09",
    "In 3 hours Mon Nov 09",
    "Tomorrow Tue Nov 10",
    "Next week Mon Nov 16",
    "A month from now Wed Dec 09",
  ]);
  // Every preset's hint is `_F.formatString`.
  const [first] = defaultTimeOptions(new Date(2026, 10, 8, 15, 30));
  expect(first!.detail).toBe(timeDetail(first!.at));
});

test("timeDetail reads like Linear's: weekday, day month, time", () => {
  expect(timeDetail(new Date(2026, 10, 8, 19, 13).getTime())).toMatch(/^Sun, 8 Nov, 7:13\sPM$/);
});

test("a search finds presets by Linear's keywords, and a typed time that is a preset's time adds no row", () => {
  const presets = defaultTimeOptions(new Date(2026, 10, 8, 12));
  const found = (query: string) => menuTimeOptions(presets, null, query).presets.map((p) => p.label);
  expect(found("1h")).toEqual(["An hour from now"]);
  expect(found("tonight")).toEqual(["This evening"]);
  expect(found("6pm")).toEqual(["This evening"]);
  expect(found("1d")).toEqual(["Tomorrow"]);
  expect(found("1w")).toEqual(["Next week"]);
  expect(found("1mo")).toEqual(["A month from now"]);
  expect(found("tom")).toEqual(["Tomorrow"]);
  expect(found("2 days")).toEqual([]);
  expect(found("")).toHaveLength(6);
  const evening = presets.find((p) => p.label === "This evening")!;
  const typed = (at: string): TimeOption => ({ label: "Today at 6:00 PM", at, detail: "" });
  expect(menuTimeOptions(presets, typed(evening.at), "6pm").typed).toBeNull();
  expect(menuTimeOptions(presets, typed(new Date(2026, 10, 8, 16).toISOString()), "4pm").typed?.label).toBe(
    "Today at 6:00 PM",
  );
});

test("_F.formatOptionLabel: Now, minutes up to a quarter hour, then the duration typed", () => {
  const now = new Date(2026, 10, 8, 12);
  expect(typedLabel(new Date(+now + 30_000), now)).toBe("Now");
  expect(typedLabel(new Date(+now + MIN), now)).toBe("In 1 minute");
  expect(typedLabel(new Date(+now + 15 * MIN), now)).toBe("In 15 minutes");
  expect(typedLabel(new Date(+now + 3 * HOUR), now, { amount: 3, unit: "hour" })).toBe("In 3 hours");
  expect(typedLabel(new Date(+now + 3 * HOUR), now)).toBe("Today at 3:00 PM");
});

test("Linear's short distance (ts → bi → ii, short)", () => {
  const cases: [number, string][] = [
    [30_000, "now"],
    [5 * MIN, "5min"],
    [59.6 * MIN, "1h"],
    [2 * HOUR + 20 * MIN, "2h"],
    // Below 8h a part hour of 40 minutes or more rounds up (ti = .66).
    [2 * HOUR + 40 * MIN, "3h"],
    [10 * HOUR + 31 * MIN, "11h"],
    [DAY + 15 * HOUR, "1d"],
    [DAY + 16 * HOUR, "2d"],
    [7 * DAY, "1w"],
    [10 * DAY, "10d"],
    [14 * DAY, "2w"],
    [40 * DAY, "6w"],
    [80 * DAY, "2mo"],
    [85 * DAY, "3mo"],
    [400 * DAY, "1y"],
  ];
  for (const [ms, text] of cases) expect([ms, shortDistance(ms)]).toEqual([ms, text]);
});

test("XSt: 'Snoozed for 2d'; under a minute Linear's ts reads 'now'; the unsnoozed tooltip", () => {
  const now = Date.now();
  expect(snoozedFor(now + 2 * DAY, now)).toBe("Snoozed for 2d");
  expect(snoozedFor(now + 3 * HOUR, now)).toBe("Snoozed for 3h");
  expect(snoozedFor(now + 20_000, now)).toBe("Snoozed for now");
  expect(unsnoozedAgo(now - 2 * HOUR, now)).toBe("Unsnoozed 2h");
});
