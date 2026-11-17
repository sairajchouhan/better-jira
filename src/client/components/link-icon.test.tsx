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

test("an issue's link row draws the same site icon at 16px and round: GitHub's logo, else the page's unfurled icon (Linear's attachment row)", async () => {
  const github = renderToStaticMarkup(<SiteIcon url="https://github.com/acme/widgets/pull/42" icon="https://github.com/favicon.ico" size={16} />);
  expect(github).toContain("data-github-logo");
  expect(github).toContain('width="16"');
  expect(github).not.toContain("<img");
  const page = renderToStaticMarkup(<SiteIcon url="https://example.com/a" icon="https://example.com/icon.png" size={16} />);
  expect(page).toContain('src="https://example.com/icon.png"');
  expect(page).toContain("rounded-full");
  const source = await Bun.file(new URL("../features/issue/issue-resources.tsx", import.meta.url)).text();
  expect(source).toContain("<SiteIcon url={resource.url} icon={resource.preview?.icon} size={16} />");
  expect(source).not.toContain("<LinkIcon");
});
