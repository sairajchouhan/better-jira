import { expect, test } from "bun:test";

// Linear's typography (style-kMXsq6uH.css `@layer base` and `@layer reset`): its Inter 4.1 files, self-hosted, and
// its font stacks. Fails if the face, the files, the preload or the variables drift.
const dir = new URL("./", import.meta.url);
const css = await Bun.file(new URL("index.css", dir)).text();
const html = await Bun.file(new URL("index.html", dir)).text();

const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
const face = (style: string) => faces.find((f) => /font-family:\s*"Inter Variable"/.test(f) && f.includes(`font-style: ${style}`));
const sha256 = async (path: string) =>
  new Bun.CryptoHasher("sha256").update(await Bun.file(new URL(path, dir)).arrayBuffer()).digest("hex");

test("Inter Variable is declared like Linear's: one file per style, 100–900, swap, its unicode-range", () => {
  for (const [style, file] of [
    ["normal", "InterVariable.woff2"],
    ["italic", "InterVariable-Italic.woff2"],
  ] as const) {
    const rule = face(style);
    expect(rule).toBeDefined();
    expect(rule).toContain(`src: url("./assets/fonts/${file}") format("woff2")`);
    expect(rule).toContain("font-weight: 100 900");
    expect(rule).toContain("font-display: swap");
    expect(rule).toContain("unicode-range: U+0-2B1B, U+2B1D-10FFFF");
  }
});

test("the font files are rsms/inter v4.1, the same bytes static.linear.app serves, with their OFL licence", async () => {
  expect(await sha256("assets/fonts/InterVariable.woff2")).toBe("693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3");
  expect(await sha256("assets/fonts/InterVariable-Italic.woff2")).toBe(
    "e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a",
  );
  expect(await Bun.file(new URL("assets/fonts/Inter-LICENSE.txt", dir)).text()).toContain("SIL Open Font License, Version 1.1");
});

test("index.html preloads the upright file, as Linear does", () => {
  expect(html).toMatch(/<link rel="preload" href="\.\/assets\/fonts\/InterVariable\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
});

test("the font variables are Linear's stacks, and the body and Tailwind use them", () => {
  const variable = (name: string) => css.match(new RegExp(`--${name}:([^;]*);`))?.[1]?.replace(/\s+/g, " ").trim();
  expect(variable("font-regular")).toBe(
    '"Inter Variable", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", "Linear Thai", sans-serif',
  );
  expect(variable("font-monospace")).toBe('"Berkeley Mono", ui-monospace, "SFMono Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace');
  expect(variable("code-block-font-family")).toBe(
    '"Berkeley Mono", "Fira Code", "Jetbrains Mono", ui-monospace, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Kohinoor Devanagari", "Nirmala UI", "Noto Sans Devanagari", monospace',
  );
  expect(variable("font-sans")).toBe("var(--font-regular)");
  expect(variable("font-mono")).toBe("var(--font-monospace)");
  expect(css).toMatch(/body \{[^}]*font-family: var\(--font-regular\);[^}]*text-rendering: optimizeLegibility;/);
  expect(css).toMatch(/body \{[^}]*antialiased/);
});

test("kbd and samp inherit the surrounding font (Linear's reset); pre and code use Linear's monospace stacks", () => {
  expect(css).toMatch(/\n  kbd,\s*samp \{\s*font-family: inherit;\s*font-feature-settings: inherit;/);
  // A bare `monospace` (the browser's fixed font) or Tailwind's ui-monospace stack must never come back for code.
  expect(css).not.toMatch(/font-family:\s*(monospace|ui-monospace)\s*;/);
  expect(css).toMatch(/pre\.code-block > code,\s*pre\.code-block > \.cb-gutter \{\s*font-family: var\(--code-block-font-family\);/);
  expect(css).toMatch(/pre\.code-block \{\s*--code-block-font-size: 12px;\s*--code-block-line-height: 20px;/);
  expect(css).toMatch(/\.rich-doc pre code \{[^}]*font-family: var\(--code-block-font-family\);\s*font-size: 12px;\s*line-height: 20px;/);
});

test("the editor keeps Inter's contextual alternates on, as Linear's editor container does", () => {
  expect(css).toMatch(/\.rich-doc,\s*\.ProseMirror\.rich-doc \{\s*font-variant-ligatures: normal;\s*font-feature-settings: "calt";/);
});

test("no font comes from a package or another host", async () => {
  expect(await Bun.file(new URL("App.tsx", dir)).text()).not.toContain("@fontsource");
  expect(css).not.toMatch(/url\(\s*["']?(https?:)?\/\/|@import\s+["']@fontsource/);
});
