import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteIcon } from "./link-icon";

test("a GitHub link's icon is Linear's GitHub logo (`HT`) in labelMuted, never GitHub's black favicon that vanishes on dark", () => {
  for (const url of ["https://github.com/acme/widgets/pull/42", "https://www.github.com/acme"]) {
    const html = renderToStaticMarkup(<SiteIcon url={url} />);
    expect(html).toContain("data-github-logo");
    expect(html).toContain('fill="var(--fg-3)"');
    expect(html).not.toContain("<img");
  }
});

test("any other site's icon is its favicon through this server, 14px and rounded 3px", () => {
  const html = renderToStaticMarkup(<SiteIcon url="https://docs.google.com/document/d/abc" />);
  expect(html).toContain('src="/api/favicon?origin=https%3A%2F%2Fdocs.google.com"');
  expect(html).toContain('width="14"');
  expect(html).toContain("rounded-[3px]");
  expect(html).not.toContain("data-github-logo");
});
