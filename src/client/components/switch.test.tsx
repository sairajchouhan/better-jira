import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Switch } from "./switch";

const render = (props: Partial<Parameters<typeof Switch>[0]> = {}) =>
  renderToStaticMarkup(
    <Switch size="small" aria-label="Show sub-issues" isSelected onChange={() => {}} {...props}>
      Show sub-issues
      <Switch.Indicator />
    </Switch>,
  );

test("a switch is React Aria's label around a native checkbox with the switch role, then its text and pill", () => {
  const html = render();
  const label = /^<label [^>]*>/.exec(html)?.[0] ?? "";
  expect(label).toContain('class="ui-switch "');
  expect(label).toContain('data-size="small"');
  expect(label).toContain('data-selected="true"');
  const input = /<input [^>]*>/.exec(html)?.[0] ?? "";
  for (const attribute of ['type="checkbox"', 'role="switch"', 'aria-label="Show sub-issues"', 'checked=""'])
    expect(input).toContain(attribute);
  expect(html).toContain('Show sub-issues<span aria-hidden="true" class="ui-switch-indicator"></span></label>');
});

test("a title reaches the label, for TitleTooltips", () => {
  expect(render({ title: "Create more issues" })).toMatch(/^<label [^>]*title="Create more issues"/);
});
