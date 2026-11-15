import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Menu } from "@/client/components/menu";
import { TimeOptionRows } from "./time-option-rows";

const rows = (query: string) =>
  renderToStaticMarkup(
    <Menu label="Remind me" search={query}>
      <Menu.List>
        <TimeOptionRows query={query} onPick={() => {}} onCustom={() => {}} />
      </Menu.List>
    </Menu>,
  );

test("a typed text that is no time keeps the menu's rows: its empty line and Custom…, inside the collection", () => {
  // "in 2" is no preset and (before the parser loads) no typed time: the empty line shows, with Custom… under it.
  const html = rows("in 2");
  expect(html).toContain("Choose a future date and time");
  expect(html).toContain('data-value="Custom…"');
  // The empty line is the collection's own Header (Menu.Empty), never wrapped in a plain element React Aria can't collect.
  expect(html).not.toContain('role="status"');
});
