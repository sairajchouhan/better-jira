import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HoverCard } from "./hover-card";

test("a closed hover card is only its trigger: the card, React Aria's preview dialog, mounts when it opens", () => {
  const html = renderToStaticMarkup(
    <HoverCard label="Pull request" content={<p>Card body</p>}>
      <a href="https://example.com/pull/1">PR</a>
    </HoverCard>,
  );
  expect(html).toMatch(/^<span class="inline-flex min-w-0 max-w-full" data-hover-card-trigger="">/);
  expect(html).toContain('<a href="https://example.com/pull/1">PR</a>');
  expect(html).not.toContain("Card body");
  expect(html).not.toContain('role="dialog"');
});
