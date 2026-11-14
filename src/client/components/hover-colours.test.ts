import { expect, test } from "bun:test";

/**
 * BJ-222, BJ-223, BJ-224: the create dialog's chips, the relation pill's hover and every former `--hover` call site,
 * against Linear's generateTheme (startup-root.CnUSfl4j.js `pD`). The theme maths below is the bundle's on its presets
 * (dark base 5.52 0.4 272, contrast 27; light base 97.94 0.5 282, contrast 30), cut down to the tokens these controls
 * paint; the tokens must equal it to Linear's printed 3 decimals.
 */
const read = async (path: string) =>
  (await Bun.file(new URL(path, import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");
const index = await read("../index.css");
const controls = await read("./control-tokens.css");
const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

/** The custom properties `selector` sets in `css`, light (outside any dark media query) or dark (inside one). */
function tokens(css: string, selector: string, scheme: "light" | "dark") {
  const darkRanges: [number, number][] = [];
  for (const m of css.matchAll(/@media \(prefers-color-scheme: dark\) \{/g)) {
    let depth = 0,
      i = m.index + m[0].length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    darkRanges.push([m.index, i]);
  }
  const inDark = (at: number) => darkRanges.some(([a, b]) => at > a && at < b);
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/([^{};/]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== selector || inDark(m.index) !== (scheme === "dark")) continue;
    for (const [, k, v] of m[2]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k!] = v!.replace(/\s+/g, " ").trim();
  }
  return out;
}
const root = (scheme: "light" | "dark") => ({ ...tokens(index, ":root", scheme), ...tokens(controls, ":root", scheme) });

type LC = [number, number];
const clamp = ([l, c]: LC): LC => [Math.min(100, Math.max(0, l)), Math.min(132, Math.max(0, c))];
/** generateTheme for one base: the colour helpers `c` and `d` and the tokens these controls use. */
function theme(base: LC, light: boolean, contrast: number) {
  const s = ((light ? -1 : 1) * Math.min(contrast, 30)) / 30;
  const u = ((light ? -0.8 : 1) * Math.min(contrast, 30)) / 70;
  const c = (b: LC, l: number, ch?: number): LC => clamp([b[0] + l * s, b[1] + (ch === undefined ? 0 : ch * s)]);
  const d = (b: LC, l: number, ch?: number): LC => clamp([b[0] + l * u, b[1] + (ch === undefined ? 0 : ch * u)]);
  // Light elevates by -8·s (lighter) and clamps; a near-white base lands on Linear's lch(100 0).
  return {
    bgBase: base,
    bgSub: light ? c(base, 3.5) : c(base, -3.25, 0),
    bgBaseHover: light ? c(base, 3.5) : c(base, 4.25, 0.5),
    controlSecondary: light ? d(base, -6) : d(base, 12, 0.75),
    controlTertiaryHover: light ? d(base, 9) : d(base, 22, 0.5),
    sidebarLinkBg: light ? c(base, 2.8) : c(base, 6.5, 1),
    elevated: () => theme(light ? clamp([base[0] + 8, 0]) : c(base, 4.125, 0.5), light, contrast),
    sub: () => theme(light ? c(base, 3.5) : c(base, -3.25, 0), light, contrast),
  };
}
const linear = (scheme: "light" | "dark") =>
  scheme === "light" ? { hue: 282, t: theme([97.94, 0.5], true, 30) } : { hue: 272, t: theme([5.52, 0.4], false, 27) };

/** Equal to Linear's printed value: lch(L% C H), 3 decimals. */
function same(token: string | undefined, [l, c]: LC, hue: number) {
  const m = /^lch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(token ?? "");
  if (!m) throw new Error(`not an lch token: ${token}`);
  expect(Math.abs(Number(m[1]) - l)).toBeLessThanOrEqual(0.001);
  expect(Math.abs(Number(m[2]) - c)).toBeLessThanOrEqual(0.001);
  expect(Number(m[3])).toBe(hue);
}

test("BJ-222: the create dialog's chips are Linear's secondary small button in the dialog's theme elevated again", async () => {
  const dark = linear("dark");
  const dialog = dark.t.elevated(),
    raised = dialog.elevated();
  // The box stays the dialog (elevated) theme; the chip row is one level up: live dark chip lch(17.574 1.589 272).
  same(tokens(controls, '[data-elevation="dialog"]', "dark")["--panel"], dialog.bgBase, 272);
  const row = tokens(controls, '[data-elevation="dialog-raised"]', "dark");
  same(row["--panel"], raised.bgBase, 272);
  same(row["--btn"], raised.controlSecondary, 272);
  expect(row["--btn"]).toBe("lch(17.574% 1.589 272)");
  same(row["--control-tertiary-hover"], raised.controlTertiaryHover, 272);
  // Light clamps at bgBase 100: elevating again changes nothing, so the [data-elevation] light block (controlSecondary 100) holds.
  const light = linear("light").t.elevated().elevated();
  same(tokens(controls, "[data-elevation]", "light")["--btn"], light.controlSecondary, 282);
  expect(tokens(controls, '[data-elevation="dialog-raised"]', "light")).toEqual({});

  const create = await source("../features/issue/personal-controls.tsx");
  expect(create).toContain(`<div className="create-issue-properties" data-create-properties data-elevation="dialog-raised">`);
  // Every chip in the row is the shared secondary small Button (Linear's AV → Lj → jv secondary small).
  expect(await source("./pill-select.tsx")).toContain(`<Button variant="secondary" size="small" icon={icon}`);
  expect(create).toMatch(/<Button\s+data-pending-relation\s+variant="secondary"\s+size="small"/);
  expect(create).toMatch(/label="More actions"\s+variant="secondary"\s+size="small"/);
});

test("BJ-223: a relation pill hovers (and holds while its menu is open) with controlTertiaryHover in both themes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const { hue, t } = linear(scheme);
    same(root(scheme)["--control-tertiary-hover"], t.controlTertiaryHover, hue);
  }
  expect(root("light")["--control-tertiary-hover"]).toBe("lch(94.854% 0.5 282)");
  expect(root("dark")["--control-tertiary-hover"]).toBe("lch(14.006% 0.593 272)");
  expect(index).toMatch(/\.relation-pill:hover,\s*\[data-menu-open\] > \[data-relation\] \.relation-pill \{\s*background: var\(--control-tertiary-hover\);/);
  expect(index).not.toContain("--add-hover");
});

test("BJ-224: sidebar rows hover with the sidebar theme's sidebarLinkBg, list-type rows with bgBaseHover", async () => {
  for (const scheme of ["light", "dark"] as const) {
    const { hue, t } = linear(scheme);
    same(root(scheme)["--sidebar-hover"], t.sub().sidebarLinkBg, hue);
    same(root(scheme)["--row-hover"], t.bgBaseHover, hue);
  }
  expect(root("dark")["--sidebar-hover"]).toBe("lch(8.445% 1.3 272)");
  expect(root("light")["--sidebar-hover"]).toBe("lch(91.64% 0.5 282)");
  expect(root("light")["--row-hover"]).toBe("lch(94.44% 0.5 282)");

  // One row class for links and buttons (Search, New issue), lit under the pointer and while its context menu is open.
  const link = await source("../features/navigation/sidebar-link.tsx");
  expect(link).toContain(`"text-fg-2 hover:bg-(--sidebar-hover) in-data-menu-open:bg-(--sidebar-hover)"`);
  expect(await source("../features/navigation/app-chrome.tsx")).toContain(`<button onClick={onClick} className={sidebarRowClass(false)}>`);
  // List, inbox and sub-issue rows are Linear's list item (listItemHover / listItemMenuOpen / itemActive).
  expect(await source("../routes/board-view.tsx")).toContain("hover:bg-(--row-hover) in-data-menu:bg-(--row-hover)");
  expect(await source("../routes/inbox.tsx")).toContain(`"hover:bg-(--row-hover)"`);
  expect(await source("../features/issue/sub-issues.tsx")).toContain(`hover:bg-(--row-hover) \${active ? "bg-(--row-hover)" : ""}`);
});

test("BJ-224: Submit comment is a secondary button, so its fill is the composer's elevated controlSecondary", () => {
  same(root("light")["--send"], linear("light").t.elevated().controlSecondary, 282);
  same(root("dark")["--send"], linear("dark").t.elevated().controlSecondary, 272);
});

test("BJ-224: no control hovers with bgShadeHover, and no blanket open-menu rule paints rows", async () => {
  const glob = new Bun.Glob("**/*.{tsx,css}");
  const dir = new URL("..", import.meta.url).pathname;
  const users: string[] = [];
  for await (const file of glob.scan(dir)) {
    const text = await Bun.file(`${dir}/${file}`).text();
    if (/\bbg-hover\b|hover:bg-hover|var\(--hover\)/.test(text)) users.push(file);
  }
  // Only the two fills that are no hover: the image-comment avatar and the upload pill's button (index.css).
  expect(users).toEqual(["index.css"]);
  expect(index.match(/var\(--hover\)/g)).toHaveLength(2);
  expect(index).not.toContain("--color-hover");
  expect(index).not.toMatch(/\[data-menu-open\] > :first-child/);
});

test("BJ-228: the file block and its node toolbar paint the elevated theme's tokens (Linear `cBe` wraps it in `w_`)", async () => {
  const dark = tokens(controls, '[data-elevation="dialog"]', "dark"),
    light = tokens(controls, "[data-elevation]", "light");
  // bgShadeHover of the elevated theme: c(bgBase, 3, 1) in dark; light paints bgBorderSolidAlpha (`Fx.itemLight`).
  const t = linear("dark").t.elevated().bgBase;
  same(dark["--node-toolbar-item-hover"], clamp([t[0] + 3 * 0.9, t[1] + 0.9]), 272);
  same(root("dark")["--node-toolbar-item-hover"], [8.22, 1.3], 272);
  expect(light["--node-toolbar-item-hover"]).toBe("lch(0 0 0 / 0.147)");
  expect(root("light")["--node-toolbar-item-hover"]).toBe("lch(0 0 0 / 0.15)");
  const toolbar = await read("./node-toolbar.css");
  // The pill fills controlTertiarySelected (--tab-on) under the pointer; an item its own hover token.
  expect(toolbar).toMatch(/\.ui-node-toolbar:hover \{\s*background: var\(--tab-on\);/);
  expect(toolbar).toMatch(/\[data-appearance="node-toolbar"\]:is\(:hover, :active\) \{\s*background: var\(--node-toolbar-item-hover\);\s*color: var\(--fg-2\);/);
  // The block itself: bgBase, a thinPixel bgBorderFaintThin border and shadowLow of its theme, the 6px block radius.
  expect(index).toMatch(/\.file-media \{[^}]*border: var\(--thin-pixel\) solid var\(--border-faint-thin\);[^}]*border-radius: 6px;[^}]*background: var\(--panel\);[^}]*box-shadow: var\(--shadow-low\);/);
  expect(await source("../features/media/file-media.tsx")).toContain('data-elevation="dialog"');
});
