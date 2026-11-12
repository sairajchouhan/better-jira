import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { optionsByValue, Select } from "./select";

test("options are found through fragments and wrappers", () => {
  const options = optionsByValue(
    <>
      <Select.Option value="status">Status</Select.Option>
      <div>
        <Select.Option value="assignee">Assignee</Select.Option>
      </div>
      text
    </>,
  );
  expect([...options.keys()]).toEqual(["status", "assignee"]);
  expect(options.get("assignee")?.children).toBe("Assignee");
});

test("the trigger shows and names the chosen option, else the placeholder", () => {
  const chosen = renderToStaticMarkup(
    <Select label="Grouping" value="status" onValueChange={() => {}} size="compact">
      <Select.Option value="status">Status</Select.Option>
    </Select>,
  );
  expect(chosen).toContain('aria-label="Grouping: Status"');
  expect(chosen).toContain('data-size="compact"');
  expect(chosen).toContain('<span class="ui-select-value">Status</span>');
  const empty = renderToStaticMarkup(
    <Select label="Grouping" value="" placeholder="None" onValueChange={() => {}}>
      <Select.Option value="status">Status</Select.Option>
    </Select>,
  );
  expect(empty).toContain('<span class="ui-select-value" data-placeholder="">None</span>');
});
