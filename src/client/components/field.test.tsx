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
  expect(html).toContain(`<input data-size="normal" class="ui-input " data-1p-ignore="true" data-form-type="other" data-lpignore="true" id="${id}" aria-describedby="${id}-description"`);
  expect(html).toContain(`<p id="${id}-description">`);
});

test("a Field without a rendered description never emits a dangling description id", () => {
  for (const description of [null, false, undefined]) {
    const html = renderToStaticMarkup(<Field><Field.Label>Name</Field.Label><TextInput />{description}</Field>);
    expect(html).not.toContain("aria-describedby");
  }
});

test("autosizing mirrors caller typography and size onto the measurement copy", () => {
  for (const size of ["small", "medium", "normal", "large", "xlarge"] as const) {
    const html = renderToStaticMarkup(<AutoResizingTextArea size={size} className="custom-type" style={{ fontSize: 17, lineHeight: "25px", padding: 9 }} />);
    expect(html.match(/data-size=/g)).toHaveLength(2);
    expect(html.match(/custom-type/g)).toHaveLength(2);
    expect(html.match(/style="font-size:17px;line-height:25px;padding:9px"/g)).toHaveLength(2);
  }
});
