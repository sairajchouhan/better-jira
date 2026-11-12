import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DisplayProperties } from "./display-options";

test("display properties are Linear's tab/small toggle chips under one heading, wherever they render", () => {
  const html = renderToStaticMarkup(
    <DisplayProperties
      properties={[
        ["priority", "Priority"],
        ["labels", "Labels"],
      ]}
      shown={["labels"]}
      onChange={() => {}}
    />,
  );
  expect(html).toContain("Display properties");
  expect(html.match(/data-variant="tab"/g)).toHaveLength(2);
  expect(html.match(/data-size="small"/g)).toHaveLength(2);
  expect(html).toMatch(/aria-pressed="false"[^>]*>Priority/);
  expect(html).toMatch(/aria-pressed="true"[^>]*>Labels/);
});
