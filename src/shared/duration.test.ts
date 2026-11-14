import { expect, test } from "bun:test";
import { shortDuration } from "./duration";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("one abbreviated unit, as Linear's ii with singlePart: s, min, h, d, w, mo, y", () => {
  expect(shortDuration(45 * SECOND)).toBe("45s");
  expect(shortDuration(59.6 * SECOND)).toBe("1min");
  expect(shortDuration(12 * MINUTE)).toBe("12min");
  expect(shortDuration(59.6 * MINUTE)).toBe("1h");
  expect(shortDuration(10 * HOUR)).toBe("10h");
  expect(shortDuration(9 * DAY)).toBe("9d");
  expect(shortDuration(40 * DAY)).toBe("6w");
  expect(shortDuration(100 * DAY)).toBe("3mo");
  expect(shortDuration(400 * DAY)).toBe("1y");
});

test("under 8 hours and under 5 days, two thirds of the next unit rounds up; less rounds down", () => {
  expect(shortDuration(3 * HOUR + 39 * MINUTE)).toBe("3h");
  expect(shortDuration(3 * HOUR + 40 * MINUTE)).toBe("4h");
  expect(shortDuration(2 * DAY + 15 * HOUR)).toBe("2d");
  expect(shortDuration(2 * DAY + 16 * HOUR)).toBe("3d");
});

test("whole weeks under a month read as weeks; other day counts as days", () => {
  expect(shortDuration(14 * DAY)).toBe("2w");
  expect(shortDuration(28 * DAY)).toBe("4w");
  expect(shortDuration(15 * DAY)).toBe("15d");
});

test("twelve months read as a year", () => {
  expect(shortDuration(360 * DAY)).toBe("1y");
});
