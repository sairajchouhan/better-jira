/** Linear's short duration label (startup-entry `ri(now, then, { singlePart: true })` → `ii` with `oi`): one unit, abbreviated
 *  ("45s", "12min", "3h", "4d", "2w", "5mo", "1y"), as its pull request status says "Merged 3d ago". */

const SECOND = 1000;
const MINUTE = SECOND * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
const MONTH = WEEK * 4.35;
const YEAR = MONTH * 12;
/** Linear's `ti`: a remainder of two thirds of the next unit rounds up. */
const ROUND_UP = 0.66;

/** Linear's `cne` short names. */
const UNIT = { second: "s", minute: "min", hour: "h", day: "d", week: "w", month: "mo", year: "y" } as const;
const label = (n: number, unit: keyof typeof UNIT) => `${n}${UNIT[unit]}`;
/** Linear's `yi`: whole units, one more from two thirds over, never under one. */
const whole = (n: number) => Math.max(1, Math.floor(n) + (n - Math.floor(n) >= ROUND_UP ? 1 : 0));

/** Linear's `ii` for `ms` milliseconds with one part (`multiUnits: false`). */
export function shortDuration(ms: number): string {
  if (ms < MINUTE) {
    const n = Math.round(ms / SECOND);
    return n === 60 ? label(1, "minute") : label(n, "second");
  }
  if (ms < HOUR) {
    const n = Math.round(ms / MINUTE);
    return n === 60 ? label(1, "hour") : label(n, "minute");
  }
  if (ms < HOUR * 8) {
    const n = Math.floor(ms / HOUR);
    const rest = Math.round((ms - n * HOUR) / MINUTE);
    return label(rest >= ROUND_UP * 60 ? n + 1 : n, "hour");
  }
  if (ms < DAY) return label(Math.round(ms / HOUR), "hour");
  if (ms < DAY * 5) {
    const n = Math.floor(ms / DAY);
    const rest = Math.round((ms - n * DAY) / HOUR);
    return label(rest >= ROUND_UP * 24 ? n + 1 : n, "day");
  }
  if (ms < MONTH) {
    const n = Math.round(ms / DAY);
    return n % 7 === 0 ? label(n / 7, "week") : label(n, "day");
  }
  if (ms < WEEK * 10) return label(whole(ms / WEEK), "week");
  if (ms < YEAR) {
    const n = whole(ms / MONTH);
    return n === 12 ? label(1, "year") : label(n, "month");
  }
  return label(whole(ms / YEAR), "year");
}
