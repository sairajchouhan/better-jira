import { expect, test } from "bun:test";
import { Glob } from "bun";

// React Aria's collections (GridList, ListBox, Table, Tree) call more hooks when given `dragAndDropHooks` than without, so a
// list whose hooks turn undefined as its state changes (a sub-issue list leaving Manual ordering) breaks the Rules of Hooks and
// crashes to the error boundary (React #311). Pass the hooks always and turn drag off with `useDragAndDrop`'s `isDisabled`.
test("no collection swaps its dragAndDropHooks for undefined", async () => {
  const conditional: string[] = [];
  for await (const path of new Glob("src/client/**/*.tsx").scan(".")) {
    if (path.includes(".test.")) continue;
    const source = await Bun.file(path).text();
    for (const match of source.matchAll(/dragAndDropHooks=\{([^}]*)\}/g)) {
      if (/[?&|]/.test(match[1] ?? "")) conditional.push(`${path}:${source.slice(0, match.index).split("\n").length}`);
    }
  }
  expect(conditional).toEqual([]);
});
