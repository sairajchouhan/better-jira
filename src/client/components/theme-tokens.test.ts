import { expect, test } from "bun:test";

/**
 * control-tokens.css against Linear's generateTheme (startup-root.CnUSfl4j.js): each theme level's
 * bgBorderSolidAlphaThin is `re(bgBorderSolidThin)` of that level's own bgBase, and a dialog is the elevated theme.
 */
const css = (await Bun.file(new URL("./control-tokens.css", import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `--name: value` a selector sets, light or dark, merged in source order. */
function tokens(selector: string, scheme: "light" | "dark") {
  const out: Record<string, string> = {};
  const dark = /@media \(prefers-color-scheme: dark\) \{/g;
  const darkRanges: [number, number][] = [];
  for (const m of css.matchAll(dark)) {
    let depth = 0,
      i = m.index + m[0].length - 1;
    for (; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) break;
    }
    darkRanges.push([m.index, i]);
  }
  const inDark = (at: number) => darkRanges.some(([a, b]) => at > a && at < b);
  for (const m of css.matchAll(/([^{};/]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== selector || (inDark(m.index) && scheme === "light")) continue;
    for (const [, k, v] of m[2]!.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[k!] = v!.trim();
  }
  return out;
}
const lightness = (lch: string) => Number(/lch\(([\d.]+)%/.exec(lch)![1]);
const alpha = (lch: string) => Number(/\/ ([\d.]+)\)/.exec(lch)![1]);

/** generateTheme's `re`: a solid border as an alpha over its own base, 1.09× darker in light, ink white in dark. */
function re(base: number, border: number, scheme: "light" | "dark") {
  const t = scheme === "light" ? ((base - border) / base) * 1.09 : (border - base) / (100 - base);
  return Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;
}

const BASE = { light: 97.94, dark: 5.52 };

test("root --border-solid-alpha-thin is Linear's base bgBorderSolidAlphaThin: .15 light, .229 dark", () => {
  for (const scheme of ["light", "dark"] as const) {
    const root = tokens(":root", scheme);
    const value = alpha(root["--border-solid-alpha-thin"]!);
    expect(value).toBe(re(BASE[scheme], lightness(root["--border-solid-thin"]!), scheme));
  }
  expect(alpha(tokens(":root", "light")["--border-solid-alpha-thin"]!)).toBe(0.15);
  expect(alpha(tokens(":root", "dark")["--border-solid-alpha-thin"]!)).toBe(0.229);
});

test("every elevation level's --border-solid-alpha-thin is re() of its own bgBase and bgBorderSolidThin", () => {
  const levels = ["[data-elevation]", '[data-elevation="2"]', '[data-elevation="dialog"]'];
  for (const scheme of ["light", "dark"] as const) {
    let inherited = tokens("[data-elevation]", scheme);
    for (const level of levels) {
      const own = { ...inherited, ...tokens(level, scheme) };
      if (level === "[data-elevation]") inherited = own;
      expect(alpha(own["--border-solid-alpha-thin"]!)).toBe(
        re(lightness(own["--panel"]!), lightness(own["--border-solid-thin"]!), scheme),
      );
    }
  }
});

test("a dialog paints Linear's elevated theme (dark bgBase 9.232), not the menu theme (12.72)", () => {
  const dialog = { ...tokens("[data-elevation]", "dark"), ...tokens('[data-elevation="dialog"]', "dark") };
  expect(dialog["--panel"]).toBe("lch(9.232% 0.85 272)");
  expect(dialog["--border-thin"]).toBe("lch(22.193% 1.93 272)");
  expect(alpha(dialog["--border-solid-alpha-thin"]!)).toBe(0.238);
  // Light's elevated theme equals its menu theme, so a light dialog repoints nothing.
  expect(tokens('[data-elevation="dialog"]', "light")).toEqual({});
  expect(alpha(tokens(":root", "light")["--modal-overlay"]!)).toBe(0.25);
  expect(alpha(tokens(":root", "dark")["--modal-overlay"]!)).toBe(0.4);
});
