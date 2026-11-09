import { casual } from "chrono-node/en";

export function dateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** The one short date the app shows for due dates and reminders: "Nov 9", with the year only when it isn't this year. */
/** Linear's Due date presets, with their short date. */
export function duePresets(reference = new Date()) {
  const day = (days: number) => {
    const date = new Date(reference);
    date.setDate(date.getDate() + days);
    return date;
  };
  return (
    [
      ["Tomorrow", day(1)],
      ["End of this week", day((5 - reference.getDay() + 7) % 7)],
      ["In one week", day(7)],
    ] as const
  ).map(([name, date]) => ({
    name,
    due: dateOnly(date),
    label: shortDate(dateOnly(date), reference),
  }));
}
/** Date-only values use the browser's local calendar, never a UTC conversion. */
export function parseDueDate(input: string, reference = new Date()): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number),
      date = new Date(year!, month! - 1, day!);
    return dateOnly(date) === text ? text : null;
  }
  if (/^(?:eow|end of (?:the )?week)$/i.test(text)) {
    const date = new Date(reference);
    date.setDate(date.getDate() + ((5 - date.getDay() + 7) % 7));
    return dateOnly(date);
  }
  if (/^this weekend$/i.test(text)) {
    const date = new Date(reference);
    date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
    return dateOnly(date);
  }
  const results = casual.parse(text, reference, { forwardDate: true }),
    result = results[0];
  if (
    results.length !== 1 ||
    !result ||
    result.index !== 0 ||
    result.text.length !== text.length ||
    result.end ||
    (!result.start.isCertain("day") && !result.start.isCertain("weekday"))
  )
    return null;
  const date = result.start.date();
  return Number.isNaN(date.getTime()) ? null : dateOnly(date);
}
const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }),
  SHORT_YEAR = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
/** Linear's short date: "Nov 8" this year, "Nov 8, 2025" otherwise. A date-only value stays on the local calendar.
 * `relative` (due date properties) reads Yesterday, Today or Tomorrow for those days, as Linear does (R2-issue-fields-D7). */
export function shortDate(value: string, now = new Date(), relative = false): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  if (relative) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      days = Math.round((date.getTime() - day.getTime()) / 86_400_000);
    const name = { [-1]: "Yesterday", 0: "Today", 1: "Tomorrow" }[days];
    if (name && date.getHours() === 0) return name;
  }
  return (date.getFullYear() === now.getFullYear() ? SHORT : SHORT_YEAR).format(date);
}
