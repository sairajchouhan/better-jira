/** Linear's IssueCommentsAndHistory timestamp → UE/Xae → bi → ii in
 * startup-entry.Dt5YDWdY.js. Short durations round at .66 for larger units;
 * older activity remains relative, including weeks, months and years. */
export function activityTime(iso: string, now = Date.now()): string {
  const delta = now - Date.parse(iso);
  const elapsed = Math.abs(delta);
  const minute = 60_000,
    hour = 60 * minute,
    day = 24 * hour,
    week = 7 * day,
    month = 4.35 * week,
    year = 12 * month;
  const round = (value: number) =>
    Math.max(1, Math.floor(value) + Number(value - Math.floor(value) >= 0.66));
  let value: number, unit: string;
  if (elapsed < minute) return "just now";
  if (elapsed < hour) {
    value = Math.round(elapsed / minute);
    unit = value === 60 ? "h" : "min";
    if (value === 60) value = 1;
  } else if (elapsed < 8 * hour) {
    value = Math.floor(elapsed / hour) + Number(Math.round((elapsed % hour) / minute) >= 0.66 * 60);
    unit = "h";
  } else if (elapsed < day) {
    value = Math.round(elapsed / hour);
    unit = "h";
  } else if (elapsed < 5 * day) {
    value = Math.floor(elapsed / day) + Number(Math.round((elapsed % day) / hour) >= 0.66 * 24);
    unit = "d";
  } else if (elapsed < month) {
    value = Math.round(elapsed / day);
    unit = "d";
    if ([7, 14, 21, 28].includes(value)) {
      value /= 7;
      unit = "w";
    }
  } else if (elapsed < 10 * week) {
    value = round(elapsed / week);
    unit = "w";
  } else if (elapsed < year) {
    value = round(elapsed / month);
    unit = "mo";
    if (value === 12) {
      value = 1;
      unit = "y";
    }
  } else {
    value = round(elapsed / year);
    unit = "y";
  }
  return `${value}${unit} ${delta < 0 ? "from now" : "ago"}`;
}
