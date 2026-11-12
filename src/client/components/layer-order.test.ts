import { expect, test } from "bun:test";
import { Glob } from "bun";

/** Tailwind v4's order: `@layer properties;` (its @property fallbacks) then `@layer theme, base, components, utilities;`. */
const ORDER = "@layer properties, theme, base, components, utilities;";

/** Bun's dev server serves each stylesheet as its own <link>, in an order of its choosing (keycap.css came before the
 *  deduped control-tokens.css), and the first `@layer` a page sees fixes the layer order. A file that opened with
 *  `@layer components { … }` put components ahead of preflight, so dev builds lost button and switch styles. */
test("every stylesheet with its own layer states Tailwind's full layer order first", async () => {
  const late: string[] = [];
  for await (const path of new Glob("src/client/**/*.css").scan(".")) {
    if (path.endsWith("src/client/index.css")) continue; // Tailwind's own import states the order.
    const css = (await Bun.file(path).text()).replace(/\/\*[\s\S]*?\*\//g, "");
    const first = css.match(/@layer[^{;]*[{;]/)?.[0];
    if (first && first.replace(/\s+/g, " ") !== ORDER) late.push(path);
  }
  expect(late).toEqual([]);
});

