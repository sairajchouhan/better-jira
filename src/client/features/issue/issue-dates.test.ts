import { expect, test } from "bun:test";
import { activityTime, fullTime } from "./issue-dates";

const now = Date.parse("2026-11-12T12:00:00Z");
const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

test("Linear Activity rounds compact minutes, hours and days at their bundle boundaries", () => {
  for (const [minutes, label] of [
    [0, "just now"], [0.99, "just now"], [1, "1min ago"], [1.5, "2min ago"],
    [59.5, "1h ago"], [99, "1h ago"], [100, "2h ago"], [510, "9h ago"],
    [1440, "1d ago"], [2400, "2d ago"], [7200, "5d ago"],
  ] as const) expect(activityTime(at(minutes), now)).toBe(label);
});

test("old Activity dates remain relative and support future timestamps", () => {
  for (const [days, label] of [
    [7, "1w ago"], [14, "2w ago"], [30, "30d ago"], [35, "5w ago"],
    [70, "2mo ago"], [365.4, "1y ago"], [730.8, "2y ago"],
  ] as const) expect(activityTime(at(days * 1440), now)).toBe(label);
  expect(activityTime(at(-3), now)).toBe("3min from now");
});

test("absolute timestamps share Linear’s weekday and 24-hour seconds format", () => {
  expect(fullTime("2026-11-07T07:49:03")).toBe("Sat Nov 7, 2026 at 07:49:03");
});
