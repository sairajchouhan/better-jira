export function reminderDistance(at: string, now = Date.now()) {
  const minutes = Math.max(1, Math.round((Date.parse(at) - now) / 60000));
  const amount =
    minutes < 60 ? minutes : minutes < 1440 ? Math.round(minutes / 60) : Math.round(minutes / 1440);
  const unit = minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day";
  return `${amount} ${unit}${amount === 1 ? "" : "s"} from now`;
}
export const reminderTime = (at: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));

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
