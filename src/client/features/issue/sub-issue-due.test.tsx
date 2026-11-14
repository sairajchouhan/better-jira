import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { dateOnly } from "@/client/lib/due-date";
import { SubIssueDue } from "./sub-issues";

test("R3 G13: a sub-issue row's due date leads with Linear's due icon, so an overdue one shows red", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const html = renderToStaticMarkup(<SubIssueDue issue={{ due: dateOnly(yesterday), resolved: null }} />);
  expect(html).toContain('data-due="overdue"');
  expect(html).toContain("var(--red-base)");
  expect(html).toContain(">Yesterday</time>");
});
