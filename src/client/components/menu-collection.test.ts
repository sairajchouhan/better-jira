import { expect, test } from "bun:test";

// Issue options › Remind me crashed the app's overlay as "in 2 d" was typed (React's "Maximum update depth exceeded"): the time
// rows wrapped Menu.Empty in a `<div role="status">`. A plain element inside a Menu.List is no React Aria collection node: it never
// gets one, stays dirty, and every read of the collection makes a new one, so React re-renders until it gives up.
test("no plain element wraps a menu row, group, divider or empty state", async () => {
  const wrapped = /<(div|span|p|section|li|ul)\b[^>]*>\s*(\{[^}]*\}\s*)?<Menu\.(Empty|Item|Submenu|Group|GroupHeader|Divider|TextDivider)\b/;
  const found: string[] = [];
  for await (const path of new Bun.Glob("src/client/**/*.tsx").scan(".")) {
    const text = await Bun.file(path).text();
    if (wrapped.test(text)) found.push(path);
  }
  expect(found).toEqual([]);
});
