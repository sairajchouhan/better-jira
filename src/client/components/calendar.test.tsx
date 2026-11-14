import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseDate } from "@internationalized/date";
import { Calendar, calendarDate, jumpDirection } from "./calendar";

test("ISO dates become calendar dates; anything else is none", () => {
  expect(calendarDate("2026-11-15")?.toString()).toBe("2026-11-15");
  expect(calendarDate("2026-02-30")).toBeNull();
  expect(calendarDate("tomorrow")).toBeNull();
  expect(calendarDate(null)).toBeNull();
});

test("Linear's Xwt: Jump to today hides while today's month shows, else points the way today lies", () => {
  const now = parseDate("2026-11-15");
  expect(jumpDirection(parseDate("2026-11-01"), now)).toBeNull();
  expect(jumpDirection(parseDate("2026-10-01"), now)).toBeNull();
  expect(jumpDirection(parseDate("2026-08-01"), now)).toBe("forward");
  expect(jumpDirection(parseDate("2026-12-01"), now)).toBe("back");
  expect(jumpDirection(parseDate("2027-01-01"), now)).toBe("back");
});

test("two months of six weeks open on the chosen date's month: a plain first caption, the navigation on the second", () => {
  const html = renderToStaticMarkup(<Calendar label="Due date" value="2030-03-20" onChange={() => {}} />);
  const captions = [...html.matchAll(/class="ui-calendar-caption-label">([^<]+)</g)].map((m) => m[1]);
  expect(captions).toEqual(["March 2030", "April 2030"]);
  expect(html.match(/<table/g)).toHaveLength(2);
  expect(html.match(/<tr/g)).toHaveLength(2 * 7); // a weekday row and six weeks, each month
  // Far from today: Jump to today shows, pointing back, beside Previous and Next month.
  expect(html).toContain('aria-label="Jump to today"');
  expect(html.indexOf("Jump to today")).toBeLessThan(html.indexOf("Previous month"));
  expect(html.indexOf("Previous month")).toBeLessThan(html.indexOf("Next month"));
  // react-day-picker's two-letter weekday names.
  expect(html).toMatch(/<th[^>]*>Su<\/th>/);
  // The chosen day, and weekends marked only inside their month.
  expect(html).toMatch(/aria-selected="true"><div[^>]*data-selected="true"[^>]*>20</);
  expect(html).toContain("data-weekend");
});

test("the typed preview turns the calendar to its month and circles it", () => {
  const html = renderToStaticMarkup(
    <Calendar label="Due date" value="2030-03-20" highlighted="2031-07-04" onChange={() => {}} />,
  );
  expect(html).toContain('class="ui-calendar-caption-label">July 2031<');
  expect(html.match(/data-highlighted/g)).toHaveLength(1);
});
