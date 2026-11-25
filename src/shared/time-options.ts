/** Linear's one source of future times (`_F`, startup-root): the presets every "Remind me" and "Snooze" menu lists, how a typed
 *  time's row reads, and the short distances ("2d", "3h") the inbox's snooze lines print. Pure, so the server and tests share it. */

const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  DAY = 24 * HOUR,
  WEEK = 7 * DAY,
  // Linear's `S.MONTH` and `S.YEAR` (startup-entry): 4.35 weeks, and twelve of those.
  MONTH = 4.35 * WEEK,
  YEAR = 12 * MONTH;

/** One time row: `at` is an ISO time; `detail` is the row's trailing hint; `keywords` are more words a search finds it by. */
export type TimeOption = { label: string; at: string; detail: string; keywords?: string };

/** `_F.formatString` ("E, d MMM, h:mm a"): every preset's hint, and the hint of a typed row named "In …". */
export function timeDetail(at: string | number): string {
  const d = new Date(at),
    f = (o: Intl.DateTimeFormatOptions) => d.toLocaleString("en", o);
  return `${f({ weekday: "short" })}, ${d.getDate()} ${f({ month: "short" })}, ${clock(d)}`;
}
const clock = (d: Date) => d.toLocaleString("en", { hour: "numeric", minute: "2-digit" });

/** `_F.generateDefaultTimeOptions` (startup-root): an hour and three hours from now, this evening at 18:00 while that is an hour or
 *  more away, tomorrow at 9:00, Monday of next week at 9:00 and a month from now at 9:00, sorted by time. Each carries Linear's
 *  `keywords` ("1h", "tonight", "1w", "1mo" …). */
export function defaultTimeOptions(now = new Date()): TimeOption[] {
  const day = (days: number, hour: number, months = 0) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + months, d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  };
  const hour = now.getTime() + HOUR,
    evening = day(0, 18),
    monday = day(7 - ((now.getDay() + 6) % 7), 9);
  return [
    { label: "An hour from now", at: hour, keywords: "1h 1hour hou 60m" },
    { label: "In 3 hours", at: now.getTime() + 3 * HOUR, keywords: "3h 3hour 180m" },
    ...(evening >= hour ? [{ label: "This evening", at: evening, keywords: "tonight evening 6pm 18:00" }] : []),
    { label: "Tomorrow", at: day(1, 9), keywords: "tomorrow next day 1d 1da" },
    { label: "Next week", at: monday, keywords: "1w 1wee wee we" },
    { label: "A month from now", at: day(0, 9, 1), keywords: "1m 1mo 1mon 1mont mon mont" },
  ]
    .sort((a, b) => a.at - b.at)
    .map(({ at, ...option }) => ({ ...option, at: new Date(at).toISOString(), detail: timeDetail(at) }));
}

/** Whether a search finds a preset: by its label or one of its keywords. */
export function optionMatches(option: TimeOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${option.label} ${option.keywords ?? ""}`.toLowerCase().includes(q);
}

/** What a time menu lists for its search: the presets it finds by label or keyword ("1h", "tonight", "1w"), and the typed time
 *  unless one of those presets is that very time. */
export function menuTimeOptions(presets: TimeOption[], typed: TimeOption | null, query: string) {
  const matches = presets.filter((option) => optionMatches(option, query));
  return { presets: matches, typed: typed && !matches.some((option) => option.at === typed.at) ? typed : null };
}

/** What a typed time added to now, when it was one ("2 days", "in 3 weeks", "1h"); it names the row "In 2 days". */
export type TypedDuration = { amount: number; unit: "minute" | "hour" | "day" | "week" | "month" | "year" };
const plural = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? "" : "s"}`;
const calendarDays = (a: Date, b: Date) =>
  Math.round(
    (new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime() -
      new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) /
      DAY,
  );

/** `_F.formatOptionLabel`: "Now", "In 5 minutes" up to a quarter hour, "In 2 days" for a typed duration, else the date as Linear's
 *  `withWeekday` reads it: "Today at 4:00 PM", "Tomorrow at 9:00 AM", "Friday at 9:00 AM" within six days, then "Friday,
 *  November 27, 9:00 AM". */
export function typedLabel(at: Date, now: Date, duration?: TypedDuration): string {
  const minutes = Math.trunc((at.getTime() - now.getTime()) / MINUTE);
  if (minutes === 0) return "Now";
  if (minutes <= 15) return `In ${plural(minutes, "minute")}`;
  if (duration) return `In ${plural(duration.amount, duration.unit)}`;
  const days = calendarDays(at, now);
  if (Math.abs(days) > 6) {
    const date = at.toLocaleString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    });
    return `${date}, ${clock(at)}`;
  }
  const word = days === 0 ? "Today" : days === 1 ? "Tomorrow" : at.toLocaleString("en-US", { weekday: "long" });
  return `${word} at ${clock(at)}`;
}

/** date-fns `formatDistance` with `roundingMethod: "round"`, which `_F.formatRelativeDetailLabel` falls back to. */
function distance(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 1) return "less than a minute";
  if (minutes < 45) return plural(minutes, "minute");
  if (minutes < 90) return "about 1 hour";
  if (minutes < 1440) return `about ${plural(Math.round(minutes / 60), "hour")}`;
  if (minutes < 2520) return "1 day";
  if (minutes < 43200) return plural(Math.round(minutes / 1440), "day");
  if (minutes < 86400) return "about 1 month";
  const months = Math.round(minutes / 43200);
  return months < 12 ? plural(months, "month") : `about ${plural(Math.round(months / 12), "year")}`;
}

/** A typed row's hint (`_F.detailControl`): the date when the label already says how far ("Now", "In 2 days"), else how far:
 *  "in 3 days" (calendar days, up to 59), or "in about 2 hours". */
export function typedDetail(at: Date, now: Date, label: string): string {
  if (label === "Now" || label.startsWith("In")) return timeDetail(at.getTime());
  const days = calendarDays(at, now);
  return `in ${days > 0 && days < 60 ? plural(days, "day") : distance(at.getTime() - now.getTime())}`;
}

/** Linear's short distance (`ts`: `bi(e, {short, withoutSuffix})` over `ii`, startup-entry): "now" under a minute, "45min",
 *  whole hours up to a day (a part hour of 40 minutes or more rounds up below 8h), days (weeks at 7, 14, 21, 28), weeks below 10,
 *  months below a year, then years. */
export function shortDistance(ms: number): string {
  const e = Math.abs(ms);
  // `yi`: whole units, rounding up from two thirds (`ti` = .66).
  const up = (x: number) => Math.max(1, Math.floor(x) + Number(x - Math.floor(x) >= 0.66));
  if (e < MINUTE) return "now";
  if (e < HOUR) {
    const n = Math.round(e / MINUTE);
    return n === 60 ? "1h" : `${n}min`;
  }
  if (e < 8 * HOUR) {
    const n = Math.floor(e / HOUR);
    return `${Math.round((e - n * HOUR) / MINUTE) >= 0.66 * 60 ? n + 1 : n}h`;
  }
  if (e < DAY) return `${Math.round(e / HOUR)}h`;
  if (e < 5 * DAY) {
    const n = Math.floor(e / DAY);
    return `${Math.round((e - n * DAY) / HOUR) >= 0.66 * 24 ? n + 1 : n}d`;
  }
  if (e < MONTH) {
    const n = Math.round(e / DAY);
    return n % 7 === 0 ? `${n / 7}w` : `${n}d`;
  }
  if (e < 10 * WEEK) return `${up(e / WEEK)}w`;
  if (e < YEAR) {
    const n = up(e / MONTH);
    return n === 12 ? "1y" : `${n}mo`;
  }
  return `${up(e / YEAR)}y`;
}

/** Linear's snoozed line and Unsnooze detail (`XSt`): "Snoozed for 2d". Under a minute `ts` already reads "now", so Linear's
 *  "a few more seconds" branch (for "just now") never runs: it reads "Snoozed for now". */
export const snoozedFor = (until: number, now = Date.now()) => `Snoozed for ${shortDistance(until - now)}`;
/** The tooltip of the clock on a row back from snooze: `Unsnoozed ${ts(unsnoozedAt)}`, "Unsnoozed 2h". */
export const unsnoozedAgo = (at: number, now = Date.now()) => `Unsnoozed ${shortDistance(now - at)}`;
