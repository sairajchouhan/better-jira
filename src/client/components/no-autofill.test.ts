import { expect, test } from "bun:test";
import { Glob } from "bun";

// 1Password scans the whole page each time a text field it may fill gets focus (50-150ms on a board), which made menus that focus
// their search open late. Every text field outside a login form spreads NO_AUTOFILL (Linear's O4e), as Linear's inputs do.
const NOT_TEXT = /type="(checkbox|file|range|color|hidden|radio)"|role="switch"/;

test("every text input, textarea and menu search opts out of password-manager autofill", async () => {
  const missing: string[] = [];
  for await (const path of new Glob("src/client/**/*.tsx").scan(".")) {
    if (path.includes(".test.")) continue;
    const source = await Bun.file(path).text();
    for (const match of source.matchAll(/<(input|textarea|Command\.Input)\b([^>]*?)\/?>/gs)) {
      const attrs = match[2] ?? "";
      if (NOT_TEXT.test(attrs) || attrs.includes("NO_AUTOFILL")) continue;
      missing.push(`${path}:${source.slice(0, match.index).split("\n").length}`);
    }
  }
  expect(missing).toEqual([]);
});
