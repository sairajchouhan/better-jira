import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { snoozeMarks } from "@/shared/inbox-model";
import { fullTime } from "@/client/features/issue/issue-dates";
import { SnoozedLine, UnsnoozedMark } from "./snooze-marks";

const HOUR = 3_600_000,
  now = new Date(2026, 10, 14, 12).getTime();

test("showsSnoozeRow: a snoozed row's third line reads 'Snoozed for 2d', with the exact time in its tooltip", () => {
  const until = now + 48 * HOUR;
  const html = renderToStaticMarkup(<SnoozedLine until={until} now={now} />);
  expect(html).toContain(">Snoozed for 2d<");
  expect(html).toContain(`title="${fullTime(new Date(until).toISOString())}"`);
});

test("unsnoozedAt: the clock's tooltip and name read 'Unsnoozed 2h'", () => {
  const html = renderToStaticMarkup(<UnsnoozedMark at={now - 2 * HOUR} now={now} />);
  expect(html).toContain('aria-label="Unsnoozed 2h"');
  expect(html).toContain('title="Unsnoozed 2h"');
});

test("which rows show the marks: the line while snoozed, the clock only while unread", () => {
  expect(snoozeMarks({ unread: true }, { snoozed: now + HOUR }, now)).toEqual({ snoozedUntil: now + HOUR, unsnoozedAt: undefined });
  // A snooze that ran out but hasn't been woken yet shows no line.
  expect(snoozeMarks({ unread: true }, { snoozed: now - 1 }, now).snoozedUntil).toBeUndefined();
  expect(snoozeMarks({ unread: true }, { unsnoozed: now - HOUR }, now).unsnoozedAt).toBe(now - HOUR);
  expect(snoozeMarks({ unread: false }, { unsnoozed: now - HOUR }, now).unsnoozedAt).toBeUndefined();
  expect(snoozeMarks({ unread: true }, undefined, now)).toEqual({ snoozedUntil: undefined, unsnoozedAt: undefined });
});
