import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DueDateDialog, readDueText } from "./date-input";

test("typed due dates: a date, empty to clear, or not a date yet", () => {
  expect(readDueText("2030-01-02")).toEqual({ date: "2030-01-02", valid: true });
  expect(readDueText("  ")).toEqual({ date: null, valid: true });
  expect(readDueText("next blursday")).toEqual({ date: null, valid: false });
});

const render = renderToStaticMarkup;

test("Linear's r3t: Set due date, 562px, field and two months, Cancel and Save due date", () => {
  const html = render(<DueDateDialog value={null} onSave={() => {}} close={() => {}} />);
  expect(html).toContain('aria-label="Set due date"');
  expect(html).toContain("width:min(562px, 100%)");
  expect(html).toContain("Issue needs to be completed by this date");
  expect(html).toContain('class="ui-calendar"');
  expect(html).not.toContain("Remove due date");
  expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])).toEqual(["Cancel", "Save due date"]);
});

test("with a due date it reads Edit due date and offers Remove due date first", () => {
  const html = render(<DueDateDialog value="2030-03-20" onSave={() => {}} close={() => {}} />);
  expect(html).toContain('aria-label="Edit due date"');
  expect(html).toContain('value="2030-03-20"');
  expect([...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1])).toEqual([
    "Remove due date",
    "Cancel",
    "Save due date",
  ]);
});
