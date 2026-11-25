import { casual } from "chrono-node/en";
import { typedDetail, typedLabel, type TimeOption, type TypedDuration } from "@/shared/time-options";

/** Linear's number words (`ZSt`), read as digits before a typed time is parsed: "two days" is "2 days". */
const NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
/** `_F.generateTimeOptionsForInput`'s first pass: "a"/"an" are 1, number words are digits, and "N" plus the start of a unit
 *  ("2d", "in 3 w", "1h", "5 mins") is a duration. Linear tries the units in this order, so "1m" is a minute and "1mo" a month. */
function durationOf(text: string): TypedDuration | undefined {
  const normal = text
    .replace(/(\ba )|(\ban )|(\ba$)|(\ban$)/i, "1 ")
    .trim()
    .toLowerCase()
    .split(" ")
    .map((word) => NUMBERS[word] ?? word)
    .join(" ");
  const match = /^(?:in )?(\d+)\s*([a-z ]*)$/.exec(normal);
  const amount = Number(match?.[1]),
    unit = match?.[2]?.trim();
  if (!match || !unit || !(amount >= 1)) return;
  if ("weeks".startsWith(unit)) return { amount, unit: "week" };
  if ("days".startsWith(unit) || "business days".startsWith(unit)) return { amount, unit: "day" };
  if ("minutes".startsWith(unit) || "mins".startsWith(unit)) return { amount, unit: "minute" };
  if ("months".startsWith(unit)) return { amount, unit: "month" };
  if ("years".startsWith(unit)) return { amount, unit: "year" };
  if ("hours".startsWith(unit)) return { amount, unit: "hour" };
}
/** A duration from now; a whole-day one lands at 9:00, as Linear's (`!hour && !minute` → 9:00). */
function after(now: Date, { amount, unit }: TypedDuration): Date {
  const date = new Date(now);
  if (unit === "minute") date.setMinutes(date.getMinutes() + amount);
  else if (unit === "hour") date.setHours(date.getHours() + amount);
  else {
    if (unit === "day") date.setDate(date.getDate() + amount);
    else if (unit === "week") date.setDate(date.getDate() + 7 * amount);
    else if (unit === "month") date.setMonth(date.getMonth() + amount);
    else date.setFullYear(date.getFullYear() + amount);
    date.setHours(9, 0, 0, 0);
  }
  return date;
}
/** Any other wording ("4 pm", "friday", "nov 20", "tonight") goes to chrono, which must read the whole text as one future time.
 *  A day without an hour is at 9:00, as Linear's; "tonight" keeps chrono's evening when 9:00 has passed. */
function dateOf(text: string, now: Date): Date | undefined {
  const results = casual.parse(text, now, { forwardDate: true }),
    result = results[0];
  if (results.length !== 1 || !result || result.index !== 0 || result.text.length !== text.length || result.end) return;
  const date = result.start.date();
  if (result.start.isCertain("hour")) return date;
  const morning = new Date(date);
  morning.setHours(9, 0, 0, 0);
  return morning > now ? morning : date;
}

/** The row a typed time adds to a time menu (`_F.generateTimeOptionsForInput`), named as Linear's (`formatOptionLabel`): "In 2
 *  days", "Today at 4:00 PM". Null for anything that isn't one future time. */
export function typedTimeOption(input: string, now = new Date()): TimeOption | null {
  const text = input.trim();
  if (!text) return null;
  const duration = durationOf(text),
    date = duration ? after(now, duration) : dateOf(text, now);
  if (!date || !(date.getTime() > now.getTime())) return null;
  const label = typedLabel(date, now, duration);
  return { label, at: date.toISOString(), detail: typedDetail(date, now, label) };
}
