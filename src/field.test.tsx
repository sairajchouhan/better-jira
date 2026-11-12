import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AutoResizingTextArea, Field, sizerText, TextInput } from "./field";

test("the sizer copy keeps a trailing empty line", () => {
  expect(sizerText("")).toBe("​");
  expect(sizerText("a\n")).toBe("a\n​");
});

test("the autosize textarea mirrors its value into the hidden copy", () => {
  const html = renderToStaticMarkup(<AutoResizingTextArea value={"one\n"} onChange={() => {}} />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain("one\n​</div>");
});

test("a Field labels and describes its control", () => {
  const html = renderToStaticMarkup(
    <Field>
      <Field.Label>Name</Field.Label>
      <TextInput />
      <Field.Description>Shown to everyone</Field.Description>
    </Field>,
  );
  const id = /<label for="([^"]+)"/.exec(html)?.[1];
  expect(id).toBeTruthy();
  expect(html).toContain(`<input data-size="normal" class="ui-input " id="${id}" aria-describedby="${id}-description"`);
  expect(html).toContain(`<p id="${id}-description">`);
});
