import { expect, test } from "bun:test";

/**
 * The board's scroller and column pitch against Linear's IssueList.CUOYX8Am.js and CustomerCountPopover.BoSxdZS_.js.
 * Read as text, as board-colours.test.ts reads the board's CSS: the classes are the values.
 */
const view = await Bun.file(new URL("./board-view.tsx", import.meta.url)).text();
const scroller = /<div ref=\{boardScroller\}[^>]*className="([^"]+)"/.exec(view)?.[1] ?? "";

test("BJ-388: the board scroller never chains its overscroll and keeps 90px clear above and below a scrolled-to card", () => {
  // boardRowsScroller: overscroll-behavior none (sx-8du1vd), scroll-padding-top and -bottom 90px (sx-i6ts1u, sx-1xkdd5q).
  expect(scroller.split(" ")).toEqual(expect.arrayContaining(["overflow-auto", "overscroll-none", "scroll-py-[90px]"]));
});

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

test("BJ-241: list groups stack with no margin, each a 36px header, 2px under it and 2px after its rows, as Linear's", () => {
  // ListCell: the header row's `marginBottom: e.marginBottom ?? 2`; live Linear pads each group 2px at the bottom.
  const section = /<section key=\{c\.id\} className="([^"]*)">/.exec(view)?.[1]?.split(" ") ?? [];
  expect(section).toEqual(["pb-0.5"]);
  const heading = /<div data-list-group=\{bucket\.name\} className="([^"]+)"/.exec(view)?.[1]?.split(" ") ?? [];
  expect(heading).toEqual(expect.arrayContaining(["h-9", "mb-0.5"]));
  expect(heading.some((c) => /^m[ty]?-(?!0\.5)/.test(c))).toBe(false);
});

test("BJ-241: a sub-group keeps 2px under its header and after its rows; the list pads 0 above and 8px below, as Linear's", () => {
  // Live Linear sub-grouped by priority: each sub-group header (36px) has marginBottom 2 and each sub-group ends 2px later.
  const subgroup = /<div data-list-subgroup=\{r\.name\} className="([^"]+)"/.exec(view)?.[1]?.split(" ") ?? [];
  expect(subgroup).toEqual(expect.arrayContaining(["h-9", "mb-0.5"]));
  expect(view).toContain('<div key={r.id} className={d.rows !== "none" ? "pb-0.5" : undefined}>');
  // The list scroller: padding-top 0, padding-bottom 8px (live --x-paddingTop / --x-paddingBottom).
  const list = /<div data-scroll-restoration-id=\{`board-\$\{board\.id\}`\} className="([^"]+)">/.exec(view)?.[1]?.split(" ") ?? [];
  expect(list).toEqual(["flex-1", "overflow-auto", "pb-2"]);
});
