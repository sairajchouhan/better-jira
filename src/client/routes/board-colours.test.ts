import { expect, test } from "bun:test";

/**
 * The board's surfaces against Linear's generateTheme (startup-root.CnUSfl4j.js) and IssueList.CUOYX8Am.js
 * (.raj/linear.md "Board colours"). The theme maths below is the bundle's, on its presets; the tokens must equal it.
 */
const read = async (path: string) =>
  (await Bun.file(new URL(path, import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");
const index = await read("../index.css");
const column = await read("./board-column.css");
const button = await read("../components/button.css");
const tabs = await read("../components/tabs.css");

/** `:root`'s custom properties in index.css: the first `:root` block (light), then the one in the dark media query. */
function root(scheme: "light" | "dark") {
  const at = scheme === "light" ? index.indexOf(":root {") : index.indexOf(":root {", index.indexOf("@media (prefers-color-scheme: dark)"));
  const body = index.slice(at, index.indexOf("\n}", at));
  const out: Record<string, string> = {};
  for (const [, k, v] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k!] = v!.replace(/\s+/g, " ").trim();
  return out;
}
const lch = (value: string) => {
  const m = /^lch\(([\d.]+)% ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (!m) throw new Error(`not an lch token: ${value}`);
  return m.slice(1).filter(Boolean).map(Number);
};

/** generateTheme on Linear's presets: the base theme's bgSub, and the elevated theme the board's items paint in. */
function linear(scheme: "light" | "dark") {
  const light = scheme === "light";
  const [L, C, H] = light ? [97.94, 0.5, 282] : [5.52, 0.4, 272];
  const contrast = light ? 30 : 27;
  const s = ((light ? -1 : 1) * Math.min(contrast, 30)) / 30;
  const f = ((light ? -0.9 : 0.8) * contrast) / 10;
  const clamp = (l: number, c: number) => [Math.min(100, Math.max(0, l)), Math.max(0, c)];
  const cAdj = (b: number[], l: number, c = 0) => clamp(b[0]! + l * s, b[1]! + c * s);
  const pAdj = (b: number[], l: number, c = 0) => clamp(b[0]! + l * f, b[1]! + c * f);
  const base = [L, C];
  const elevated = cAdj(base, light ? -8 : 4.125, 0.5);
  return {
    hue: H,
    bgSub: light ? cAdj(base, 3.5) : cAdj(base, -3.25, 0),
    bgBase: elevated,
    bgBaseHover: light ? cAdj(elevated, 3.5) : cAdj(elevated, 4.25, 0.5),
    bgBorderFaintThin: light ? pAdj(elevated, 3, 1) : pAdj(elevated, 3.5, 0.5),
  };
}
/** Equal to Linear's printed value (3 decimals; its float maths lands 9.2325 on 9.232). */
function same(token: string, expected: number[], alpha?: number) {
  const got = lch(token),
    want = [...expected, ...(alpha === undefined ? [] : [alpha])];
  expect(got).toHaveLength(want.length);
  got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThanOrEqual(0.001));
}

test("card, card hover, the add pill and its border are Linear's elevated bgBase, bgBaseHover, bgBase/.5, bgBorderFaintThin", () => {
  for (const scheme of ["light", "dark"] as const) {
    const t = root(scheme),
      l = linear(scheme);
    same(t["--card"]!, [...l.bgBase, l.hue]);
    same(t["--card-hover"]!, [...l.bgBaseHover, l.hue]);
    same(t["--card-half"]!, [...l.bgBase, l.hue], 0.5);
    same(t["--card-line"]!, [...l.bgBorderFaintThin, l.hue]);
  }
  // The values the lead read live on linear.app (dark, 2026-11-14).
  expect(root("dark")["--card-half"]).toBe("lch(9.232% 0.85 272 / 0.5)");
  expect(root("dark")["--card-line"]).toBe("lch(16.793% 1.93 272)");
  expect(root("dark")["--card-hover"]).toBe("lch(13.058% 1.3 272)");
});

test("the column backdrop is the base theme's bgSub at .4 and .1, the page bgBase", () => {
  for (const scheme of ["light", "dark"] as const) {
    const t = root(scheme),
      l = linear(scheme);
    same(t["--col-top"]!, [...l.bgSub, l.hue], 0.4);
    same(t["--col-bottom"]!, [...l.bgSub, l.hue], 0.1);
  }
  expect(root("dark")["--panel"]).toBe("lch(5.52% 0.4 272)");
});

test("the column header is a solid bgSub/.4 strip and the body's gradient starts 46px up, at the header's top", () => {
  expect(column).toMatch(/\.board-column \.board-column-heading \{[^}]*background: var\(--col-top\)/);
  expect(column).toMatch(/\.board-column:has\(\.board-column-heading\) \{\s*--board-column-header: 46px;/);
  expect(column).toMatch(
    /\.board-column-body \{\s*background: linear-gradient\(var\(--col-top\), var\(--col-bottom\)\) 0 calc\(-1 \* var\(--board-column-header\)\) \/ 100%\s+calc\(100% \+ var\(--board-column-header\)\) no-repeat;/,
  );
});

test("the Add new issue pill: full width, 28px, bgBase/.5 on a bgBorderFaintThin border, bgBaseHover under the pointer, shown on column hover", () => {
  const rule = (selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(column)?.[1] ?? "";
  const pill = rule(".ui-button.board-add");
  for (const decl of ["width: 100%", "height: 28px", "border-color: var(--card-line)", "background-color: var(--card-half)", "color: var(--card-fg-3)"])
    expect(pill).toContain(decl);
  const hover = rule(".ui-button.board-add:is(:hover, :active):not(:disabled)");
  expect(hover).toContain("background-color: var(--card-hover)");
  expect(hover).toContain("color: var(--card-fg-2)");
  expect(rule(".board-add-slot")).toContain("opacity: 0");
  expect(column).toMatch(/\.board-column-body:hover \.board-add-slot,\s*\.board-add-slot:focus-within \{\s*opacity: 1;/);
});

test("the board renders the pill with only a plus and Linear's label, and no 'Add issue' text", async () => {
  const view = await Bun.file(new URL("./board-view.tsx", import.meta.url)).text();
  expect(view).toContain(`aria-label="Add new issue" className="ui-button board-add"`);
  expect(view).not.toContain("Add issue\n");
  expect(view).not.toContain("> Add issue");
});

test("header view tabs are the shared tab Button: controlTertiaryHover under the pointer, WEe.tab when active", async () => {
  const chrome = await Bun.file(new URL("../features/navigation/app-chrome.tsx", import.meta.url)).text();
  expect(chrome).toContain(`<Button variant="tab" size="medium" aria-pressed={on} data-active={on || undefined}`);
  expect(button).toMatch(/\.ui-button\[data-variant="tab"\]:hover \{\s*background: var\(--control-tertiary-hover\);/);
  // The active rule comes after the pressed one (same specificity), so an active tab is controlTertiarySelected.
  const pressed = button.indexOf(`.ui-button[data-variant="tab"][aria-pressed="true"]`);
  const active = button.indexOf(`.ui-button[data-variant="tab"][data-active="true"]`);
  expect(pressed).toBeGreaterThan(-1);
  expect(active).toBeGreaterThan(pressed);
  expect(button.slice(active)).toMatch(/^[^}]*background: var\(--tab-on\);\s*color: var\(--fg\);/);
  // Tabs (the roving tablists) hover the same way, never the darker row hover.
  expect(tabs).toMatch(/\.ui-tab:hover \{\s*background: var\(--control-tertiary-hover\);/);
});

test("the column's header rules reach its heading inside ContextMenu's display: contents wrapper", async () => {
  // ColumnHeading wraps the h2 in ContextMenu (action-menu.tsx), a `div.contents`: a child combinator never matches it, which
  // left the header strip unpainted and the body's gradient starting at its own top.
  const heading = await Bun.file(new URL("./board-view.tsx", import.meta.url)).text();
  expect(heading).toMatch(/<ContextMenu label=\{`Column \$\{bucket\.name\}`\}[^>]*>\s*<h2 className="board-column-heading/);
  expect(column).not.toMatch(/>\s*\.board-column-heading/);
});
