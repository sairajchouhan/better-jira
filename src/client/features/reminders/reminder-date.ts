import { casual } from "chrono-node/en";
export function parseReminder(input: string, reference = new Date()): string | null {
  const text = input.trim(),
    results = casual.parse(text, reference, { forwardDate: true }),
    result = results[0];
  if (
    results.length !== 1 ||
    !result ||
    result.index !== 0 ||
    result.text.length !== text.length ||
    result.end
  )
    return null;
  const date = result.start.date();
  if (!result.start.isCertain("hour")) date.setHours(9, 0, 0, 0);
  return date.getTime() > reference.getTime() ? date.toISOString() : null;
}
export { reminderPresets } from "./reminder-display";
