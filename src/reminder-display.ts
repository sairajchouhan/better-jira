import { dateOnly, shortDate } from "./due-date";
export function reminderDistance(at: string, now = Date.now()) {
  const minutes = Math.max(1, Math.round((Date.parse(at) - now) / 60000));
  const amount =
    minutes < 60 ? minutes : minutes < 1440 ? Math.round(minutes / 60) : Math.round(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} from now`;
}
/** Every reminder time reads like "Nov 8, 7:11 PM": the due-date format (shortDate) plus the time. */
export const reminderTime = (at: string) => {
  const date = new Date(at);
  return `${shortDate(dateOnly(date))}, ${date.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
};

export function reminderPresets(reference = new Date()) {
  const day = (days: number, hour = 9) => {
    const date = new Date(reference);
    date.setDate(date.getDate() + days);
    date.setHours(hour, 0, 0, 0);
    return date;
  };
  const evening = day(0, 18),
    week = day((8 - reference.getDay()) % 7 || 7),
    month = new Date(reference);
  month.setMonth(month.getMonth() + 1);
  month.setHours(9, 0, 0, 0);
  return [
    { label: "An hour from now", date: new Date(+reference + 3600000) },
    { label: "In 3 hours", date: new Date(+reference + 10800000) },
    ...(evening > reference ? [{ label: "This evening", date: evening }] : []),
    { label: "Tomorrow", date: day(1) },
    { label: "Next week", date: week },
    { label: "A month from now", date: month },
  ]
    .sort((a, b) => +a.date - +b.date)
    .map(({ label, date }) => ({ label, at: date.toISOString() }));
}

type Reminder = { at: string; delivered?: boolean } | null | undefined;
type Reminded = {
  key: string;
  reminder?: Reminder;
  resources?: readonly { id: string; reminder?: Reminder }[];
};
let last: { issues: unknown; next: string } | undefined;
/** The undelivered issue or document reminder due first, as "at\nkey\ndocument" (a primitive, so a store selector only
 *  changes when the next reminder does). Computed once per `issues` map. */
export function nextReminder(issues: ReadonlyMap<string, Reminded>): string {
  if (last?.issues === issues) return last.next;
  let next: { at: string; key: string; document: string } | undefined;
  const consider = (reminder: Reminder, key: string, document = "") => {
    if (reminder && !reminder.delivered && (!next || Date.parse(reminder.at) < Date.parse(next.at)))
      next = { at: reminder.at, key, document };
  };
  for (const issue of issues.values()) {
    consider(issue.reminder, issue.key);
    for (const resource of issue.resources ?? [])
      consider(resource.reminder, issue.key, resource.id);
  }
  last = { issues, next: next ? `${next.at}\n${next.key}\n${next.document}` : "" };
  return last.next;
}
