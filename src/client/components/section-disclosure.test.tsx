import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SectionDisclosure } from "./section-disclosure";

const render = (expanded: boolean) =>
  renderToStaticMarkup(
    <SectionDisclosure expanded={expanded} onExpandedChange={() => {}}>
      <SectionDisclosure.Trigger label="Sub-issues" />
      <SectionDisclosure.Panel>
        <a href="/row">Row</a>
      </SectionDisclosure.Panel>
    </SectionDisclosure>,
  );

test("a section's toggle is React Aria's disclosure trigger: it names the panel it controls and says whether it is open", () => {
  const html = render(true);
  const controls = /<button[^>]*aria-controls="([^"]+)"/.exec(html)?.[1];
  expect(controls).toBeTruthy();
  expect(html).toContain(`id="${controls}"`);
  expect(html).toMatch(/<button[^>]*aria-expanded="true"/);
  expect(html).toContain('aria-label="Collapse sub-issues section"');
  expect(html).toContain('role="group"');
});

test("a collapsed section renders none of its rows, as Linear's sections do", () => {
  const open = render(true),
    closed = render(false);
  expect(open).toContain('href="/row"');
  expect(closed).not.toContain('href="/row"');
  expect(closed).toMatch(/<button[^>]*aria-expanded="false"/);
  expect(closed).toContain('aria-label="Expand sub-issues section"');
});

test("the disclosure and its panel take no box, so the rows lay out as the section's own children", () => {
  const html = render(true);
  expect(html.match(/class="contents"/g)?.length).toBe(2);
});
