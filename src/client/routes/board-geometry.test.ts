import { expect, test } from "bun:test";

/**
 * The board's scroller and column pitch against Linear's IssueList.CUOYX8Am.js and CustomerCountPopover.BoSxdZS_.js.
 * Read as text, as board-colours.test.ts reads the board's CSS: the classes are the values.
 */
const view = await Bun.file(new URL("./board-view.tsx", import.meta.url)).text();

test("BJ-386: board columns sit 348px apart, a 340px column and 8px between, in every row", () => {
  // Linear's issue board column is qe=348 (`et`), its background calc(100% - 8px) (columnBackgroundWidth): 340 drawn, 8 between.
  const width = Number(/data-board-column=\{bucket\.name\} className="[^"]*\bw-\[(\d+)px\]/.exec(view)?.[1]);
  const header = /className="sticky top-0 z-10 flex w-max gap-(\d+) bg-panel"/.exec(view)?.[1];
  const row = /"flex h-full min-h-0 gap-(\d+)"/.exec(view)?.[1];
  const lane = /"contents" : "flex gap-(\d+)"/.exec(view)?.[1];
  const header340 = /<div key=\{col\.id\} className="[^"]*\bw-\[(\d+)px\]/.exec(view)?.[1];
  // Tailwind's spacing unit is 4px.
  for (const gap of [header, row, lane]) expect(width + Number(gap) * 4).toBe(348);
  expect(Number(header340)).toBe(width);
  expect(width).toBe(340);
});
