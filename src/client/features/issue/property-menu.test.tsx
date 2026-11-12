import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Menu } from "@/client/components/menu";
import { PickerRow } from "./property-menu";

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
