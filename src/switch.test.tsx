import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "./switch";

test("a switch is a native checkbox with the switch role", () => {
  const html = renderToStaticMarkup(<Switch size="small" aria-label="Show sub-issues" checked onChange={() => {}} />);
  expect(html).toBe(
    '<input type="checkbox" role="switch" data-size="small" class="ui-switch " aria-label="Show sub-issues" checked=""/>',
  );
});
