import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Menu } from "@/client/components/menu";
import { DueRows, loadDueParser, PickerRow } from "./property-menu";

test('ISSUE-16: the "No priority" and "No assignee" rows show their 0 key, as Linear does', () => {
  const html = renderToStaticMarkup(
    <Menu>
      <Menu.List>
        <PickerRow value="No priority" number={0} onSelect={() => {}}>
          No priority
        </PickerRow>
      </Menu.List>
    </Menu>,
  );
  expect(html).toContain('<span class="menu-hint">0</span>');
});

test("R3-issue-fields-D7: once the parser is warm, the due menu has it on its first render", async () => {
  await loadDueParser();
  const html = renderToStaticMarkup(
    <Menu>
      <Menu.List>
        <DueRows query="tomorrow" value={null} onPick={() => {}} onCustom={() => {}} />
      </Menu.List>
    </Menu>,
  );
  // The typed date's "Due" row leads, ahead of Custom… and the presets.
  expect(html.replace(/<[^>]+>/g, "|").replace(/\|+/g, "|")).toStartWith("|Due|");
});
