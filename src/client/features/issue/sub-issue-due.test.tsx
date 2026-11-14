import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { dateOnly } from "@/client/lib/due-date";
import type { Issue } from "@/shared/issue-model";
import { SubIssueDue } from "./sub-issues";

test("R3 G13: a sub-issue row's due date leads with Linear's due icon, so an overdue one shows red", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const html = renderToStaticMarkup(<SubIssueDue issue={{ key: "SAM1-9", due: dateOnly(yesterday), resolved: null } as Issue} />);
  expect(html).toContain('data-due="overdue"');
  expect(html).toContain("var(--red-base)");
  expect(html).toContain(">Yesterday</time>");
});

test("R3 G14: a sub-issue row's due date opens the due date picker, as Linear's list badge (UJn → oK)", () => {
  const html = renderToStaticMarkup(<SubIssueDue issue={{ key: "SAM1-9", due: "2026-03-02", resolved: null } as Issue} />);
  expect(html).toMatch(/^<button type="button" aria-haspopup="[^"]+" aria-expanded="false"/);
  expect(html).toContain('aria-label="Change due for SAM1-9"');
});
