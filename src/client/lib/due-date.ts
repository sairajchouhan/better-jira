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

export type DueQualifier = "none" | "due" | "dueSoon" | "dueToday" | "overdue";
const midnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
/** Linear's `qualifierForDueDate` (startup-entry bundle): days from today (or from the day a done issue was resolved)
 *  to the due date. A done issue is overdue only when it was resolved after its due day; an open one is due soon within
 *  a week, due today on the day and overdue after it. */
export function dueQualifier(due: string | null | undefined, now = new Date(), resolved?: string | null): DueQualifier {
  if (!due) return "none";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T00:00:00` : due);
  if (Number.isNaN(date.getTime())) return "none";
  const done = resolved ? new Date(resolved) : undefined;
  const days = Math.round((midnight(date) - midnight(done ?? now)) / 86_400_000);
  if (done) return days >= 0 ? "none" : "overdue";
  return days > 7 ? "due" : days > 0 ? "dueSoon" : days === 0 ? "dueToday" : "overdue";
}
