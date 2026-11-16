import { expect, test } from "bun:test";

// Linear's scrollbars (style-kMXsq6uH.css; theme from generateTheme in startup-root.BhUCnb9L.js). Fails if the tokens,
// the layering, the @supports guards or a container's own rule drift.
const dir = new URL("./", import.meta.url);
const source = await Bun.file(new URL("index.css", dir)).text();
/** index.css without its comments, so a rule's own text is what the tests read. */
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
const read = (path: string) => Bun.file(new URL(path, dir)).text();

/** The block that opens at the first `{` after `head`, braces balanced. */
function block(source: string, head: string, from = 0) {
  const at = source.indexOf(head, from);
  if (at < 0) throw new Error(`no ${head}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unclosed ${head}`);
}
/** The `@layer base { … }` block that holds the scrollbar rules. */
const base = block(css, "@layer base", css.indexOf(".scrollbar-probe"));

test("the scrollbar colours are generateTheme's: labelFaint +0.3 L, hover +0.8 light / +0.4 dark, active labelFaint", () => {
  const light = block(css, ":root");
  expect(light).toContain("--fg-4: lch(64.64% 1.25 282)");
  expect(light).toContain("--app-scrollbar-bg: lch(64.94% 1.25 282)");
  expect(light).toContain("--app-scrollbar-bg-hover: lch(65.44% 1.25 282)");
  expect(light).toContain("--app-scrollbar-bg-active: lch(64.64% 1.25 282)");
  const dark = block(css, "@media (prefers-color-scheme: dark)");
  expect(dark).toContain("--fg-4: lch(36.975% 1.2 272)");
  expect(dark).toContain("--app-scrollbar-bg: lch(37.275% 1.2 272)");
  expect(dark).toContain("--app-scrollbar-bg-hover: lch(37.375% 1.2 272)");
  expect(dark).toContain("--app-scrollbar-bg-active: lch(36.975% 1.2 272)");
});

test("obtrusive scrollbars turn thin and themed in the base layer, under every component's own rule", () => {
  expect(block(base, ":root")).toContain("--scrollbar-width: 12px");
  const body = block(base, "body.layoutScrollbarObtrusive {");
  expect(body).toContain("--scrollbar-min-size: 32px");
  expect(body).toContain("--scrollbar-color: var(--app-scrollbar-bg)");
  const all = block(base, "body.layoutScrollbarObtrusive *");
  expect(all).toContain("scrollbar-width: thin");
  expect(all).toContain("scrollbar-color: var(--scrollbar-color) transparent");
  expect(block(base, "body.layoutScrollbarObtrusive svg *")).toContain("scrollbar-width: auto");
});

test("overlay scrollbars get the same thin thumb in scrollbarBg on a transparent track, never a ::-webkit-scrollbar", () => {
  // Our difference from Linear (.raj/linear-differences.md): Chrome's native overlay bar widens onto a grey track on hover.
  expect(block(base, "body {")).toContain("--scrollbar-color: var(--app-scrollbar-bg)");
  const overlay = block(base, "body:not(.layoutScrollbarObtrusive) * {");
  expect(overlay).toContain("scrollbar-width: thin");
  expect(overlay).toContain("scrollbar-color: var(--scrollbar-color) transparent");
  expect(base).toContain("body:not(.layoutScrollbarObtrusive),\n  body:not(.layoutScrollbarObtrusive) * {");
  expect(block(base, "body:not(.layoutScrollbarObtrusive) svg *")).toContain("scrollbar-width: auto");
  // A ::-webkit-scrollbar rule turns an overlay bar into a classic one that takes room: only obtrusive bodies get them.
  const webkit = [...css.matchAll(/[^{};]*::-webkit-scrollbar[^{]*(?=\{)/g)].flatMap(([s]) => s.split(",")).map((s) => s.trim());
  for (const selector of webkit.filter((s) => s.startsWith("body")))
    expect(selector).toStartWith("body.layoutScrollbarObtrusive");
});

test("the ::-webkit-scrollbar thumb only applies where scrollbar-width is missing, with Linear's sizes and states", () => {
  const fallback = block(base, "@supports not (scrollbar-width: thin)");
  expect(block(fallback, "::-webkit-scrollbar-thumb")).toContain("border: 3px solid #0000");
  expect(block(fallback, "::-webkit-scrollbar-thumb")).toContain("border-radius: var(--scrollbar-width)");
  expect(block(fallback, "::-webkit-scrollbar-thumb:vertical")).toContain("min-height: var(--scrollbar-min-size)");
  expect(block(fallback, "::-webkit-scrollbar-thumb:hover")).toContain("--scrollbar-color: var(--app-scrollbar-bg-hover)");
  expect(block(fallback, "::-webkit-scrollbar-thumb:active")).toContain("--scrollbar-color: var(--app-scrollbar-bg-active)");
  // Nowhere outside the fallback does a body-wide ::-webkit-scrollbar rule apply.
  expect(base.replace(fallback, "")).not.toContain("::-webkit-scrollbar");
});

test("the probe box is Linear's: 0 tall, 50px wide, always scrolling, its child empty", () => {
  const probe = block(css, ".scrollbar-probe {");
  expect(probe).toContain("height: 0;");
  expect(probe).toContain("width: 50px");
  expect(probe).toContain("overflow-y: scroll");
  // TTe's probe is just those three; its child div has no rule of its own.
  expect(probe).not.toContain("visibility");
  expect(css).not.toMatch(/\.scrollbar-probe\s*>/);
});

test("the inbox list and the list layout keep a stable gutter through one shared class", async () => {
  expect(block(block(css, "@layer components", css.indexOf(".ui-scroll-stable") - 400), ".ui-scroll-stable")).toContain(
    "scrollbar-gutter: stable",
  );
  expect(await read("routes/inbox.tsx")).toContain('className="ui-scroll-stable min-h-0 flex-1 overflow-y-auto');
  expect(await read("routes/board-view.tsx")).toContain('className="ui-scroll-stable flex-1 overflow-auto pb-2"');
});

test("hideScrollbars is one layered class, used by the menus, the create-issue chips and the editor toolbar", async () => {
  const hide = block(css, "@layer components", css.indexOf(".scrollbar-probe"));
  expect(block(hide, ".ui-hide-scrollbars {")).toContain("scrollbar-width: none");
  expect(block(hide, ".ui-hide-scrollbars::-webkit-scrollbar")).toContain("display: none");
  expect(await read("components/menu.tsx")).toContain('className="menu-list ui-hide-scrollbars"');
  expect(await read("features/issue/personal-controls.tsx")).toContain("create-issue-properties ui-hide-scrollbars");
  expect(await read("features/editor/rich-editor.tsx")).toContain("ui-hide-scrollbars fixed flex flex-nowrap overflow-x-auto");
  expect(await read("features/issue/create-issue.css")).not.toContain("scrollbar-width");
});

test("a scrolling action menu fades its edges along its scroll timeline", () => {
  const fades = block(css, "@supports (animation-timeline: auto)", css.indexOf(".ui-hide-scrollbars::-webkit-scrollbar"));
  expect(block(fades, ".menu-list.ui-hide-scrollbars:not(.command-menu *) {")).toContain("scroll-timeline: --scroll-affordance block");
  const edge = block(fades, ".menu-list.ui-hide-scrollbars:not(.command-menu *)::after {", fades.indexOf("::before {"));
  expect(edge).toContain("background-image: linear-gradient(to top, var(--menu), transparent)");
  expect(edge).toContain("animation-range: calc(100% - 24px) 100%");
  expect(block(fades, ".menu-list.ui-hide-scrollbars:not(.command-menu *)::before {")).toContain("animation-range: 0 24px");
  expect(block(fades, ".menu-list.ui-hide-scrollbars:not(.command-menu *)::before,")).toContain("height: 24px");
});

test("the command menu keeps a thin scrollbar in a stable gutter, its end padding giving way to it", () => {
  const list = block(css, ".command-menu .menu-list {");
  expect(list).toContain("scrollbar-width: thin");
  expect(list).toContain("scrollbar-gutter: stable");
  expect(block(css, ".command-menu .menu-list .menu-item::before")).toContain(
    "right: max(0px, calc(6px - var(--scrollbar-width)))",
  );
});

test("the sidebar, board columns, list and issue body scroll as Linear's do", async () => {
  expect(block(css, ".sidebar-scroller {")).toContain("scrollbar-gutter: stable");
  expect(block(css, ".sidebar-scroller {")).toContain("padding-right: max(0px, calc(8px - var(--scrollbar-width)))");
  expect(block(block(css, "@supports (hanging-punctuation: first)"), ".sidebar-scroller")).toContain("scrollbar-gutter: auto");
  expect(block(css, ".board-column-scroller {")).toContain("scrollbar-gutter: stable");
  expect(block(css, "body.layoutScrollbarObtrusive .board-column-scroller")).toContain("padding-right: 0");
  // VirtualGridList leaves scroll correction to the browser's anchoring when measured heights replace estimates: never off.
  expect(css).not.toContain("overflow-anchor: none");
  expect(block(css, ".issue-detail-body {")).toContain("scrollbar-gutter: stable");
  expect(block(css, ".rich-content .tableWrapper {")).toContain("scrollbar-color: transparent transparent");
  expect(block(css, ".rich-content .tableWrapper:hover {")).toContain("scrollbar-color: var(--scrollbar-color) transparent");
  const board = await read("routes/board-view.tsx");
  expect(board).toContain('"board-column-scroller overflow-y-auto"');
  expect(await read("features/navigation/app-chrome.tsx")).toContain("sidebar-scroller flex w-[244px]");
});

test("main.tsx installs the probe before the first render", async () => {
  const main = await read("main.tsx");
  expect(main.indexOf("installScrollbarProbe();")).toBeGreaterThan(-1);
  expect(main.indexOf("installScrollbarProbe();")).toBeLessThan(main.indexOf("createRoot(elem)"));
});
