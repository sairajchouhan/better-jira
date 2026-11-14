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

test("a Field (React Aria's TextField) labels and describes its control", () => {
  const html = renderToStaticMarkup(
    <Field>
      <Field.Label>Name</Field.Label>
      <TextInput />
      <Field.Description>Shown to everyone</Field.Description>
    </Field>,
  );
  const [, labelId, inputId] = /<label [^>]*id="([^"]+)" for="([^"]+)"/.exec(html) ?? [];
  const input = /<input [^>]*>/.exec(html)?.[0] ?? "";
  expect(input).toContain(`id="${inputId}"`);
  expect(input).toContain(`aria-labelledby="${labelId}"`);
  expect(input).toContain('class="ui-input "');
  expect(input).toContain('data-1p-ignore="true"');
  const descriptionId = /<p [^>]*id="([^"]+)"[^>]*>Shown to everyone/.exec(html)?.[1];
  expect(descriptionId).toBeTruthy();
  // React Aria names every candidate slot while server rendering and keeps only the rendered ones once mounted (useSlotId).
  expect(/aria-describedby="([^"]+)"/.exec(input)?.[1]?.split(" ")).toContain(descriptionId!);
});

test("autosizing mirrors caller typography and size onto the measurement copy", () => {
  for (const size of ["small", "medium", "normal", "large", "xlarge"] as const) {
    const html = renderToStaticMarkup(<AutoResizingTextArea size={size} className="custom-type" style={{ fontSize: 17, lineHeight: "25px", padding: 9 }} />);
    expect(html.match(/data-size=/g)).toHaveLength(2);
    expect(html.match(/custom-type/g)).toHaveLength(2);
    expect(html.match(/style="font-size:17px;line-height:25px;padding:9px"/g)).toHaveLength(2);
  }
});
