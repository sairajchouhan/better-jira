import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The board's "Hidden columns" list against Linear's IssueList.CUOYX8Am.js `$l` (boardColumnWrapper): the board scroller's
 * last child, sticky to the top only (sx-7wzq59, sx-13vifvy, no left or right), 350px with 12px on its right, so it scrolls
 * sideways with the columns; 20px from them beside swimlanes. Live Linear: off-screen right on a board wider than the window,
 * moving 1:1 with scrollLeft, on a team board and on My issues alike.
 */
const view = await Bun.file(new URL("./board-view.tsx", import.meta.url)).text();

/** The JSX between the board scroller's opening tag and its matching `</div>` (the view has no self-closing div). */
function scrollerBody(source: string): string {
  const start = source.indexOf("<div ref={boardScroller}");
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (!depth) return source.slice(start, m.index);
  }
  return "";
}

const bucket = (id: string, count = 0) => ({ id, name: id, issues: Array.from({ length: count }, () => ({}) as never) });

test("Hidden columns is the board scroller's last child, so it scrolls sideways with the columns", () => {
  const body = scrollerBody(view);
  expect(body.includes("<HiddenColumns")).toBe(true);
  // Spaced between: at the right edge while the columns fit, after the last column once they overflow.
  const scroller = /<div ref=\{boardScroller\}[^>]*className="([^"]+)"/.exec(view)?.[1]?.split(" ") ?? [];
  expect(scroller).toEqual(expect.arrayContaining(["flex", "justify-between", "overflow-auto"]));
});

test("the columns fill the board's height, and swimlanes grow past it so their header row stays sticky", () => {
  // Stretched to the scroller's height, the lanes' wrapper would end there and carry the sticky header row away with it.
  const wrapper = /<div className=\{d\.rows === "none" \? "([^"]+)" : "([^"]+)"\}>/.exec(scrollerBody(view));
  expect(wrapper?.[1]?.split(" ")).toEqual(expect.arrayContaining(["h-full", "shrink-0"]));
  expect(wrapper?.[2]?.split(" ")).toEqual(expect.arrayContaining(["self-start", "shrink-0"]));
});

test("Hidden columns shows beside swimlanes too, and the bottom strip is the list's alone", () => {
  expect(view).not.toMatch(/d\.rows === "none" && hidden\.length > 0 && \(\s*<HiddenColumns/);
  expect(view).toContain('{d.layout === "list" && hidden.length > 0 && (');
});

test("Hidden columns sticks to the top only, 350px with 12px on its right, 20px from swimlanes", async () => {
  const { HiddenColumns } = await import("./board-view");
  const draw = (swimlanes: boolean) =>
    renderToStaticMarkup(
      <HiddenColumns
        columns={[bucket("In Progress"), bucket("Done", 2)]}
        by="status"
        swimlanes={swimlanes}
        hiddenIds={["Done"]}
        open
        toggle={() => {}}
        reveal={() => {}}
      />,
    );
  const classes = (html: string) => /<aside[^>]*class="([^"]+)"/.exec(html)?.[1]?.split(" ").filter(Boolean) ?? [];
  const plain = classes(draw(false));
  expect(plain).toEqual(expect.arrayContaining(["sticky", "top-0", "h-full", "w-[350px]", "pr-3", "shrink-0", "overflow-y-auto"]));
  // Its right edge meets the scroller's (live Linear), across the scroller's 8px padding.
  expect(plain).toContain("-mr-2");
  expect(/<div ref=\{boardScroller\}[^>]*className="[^"]*\bpx-2\b/.test(view)).toBe(true);
  // Never pinned to a side: no left or right offset.
  expect(plain.some((c) => /^-?(right|left|inset-x|inset)-/.test(c))).toBe(false);
  expect(plain).not.toContain("ml-5");
  expect(classes(draw(true))).toContain("ml-5");
  const html = draw(false);
  expect(html).toContain('data-board-hidden-columns="true"');
  expect(html).toContain('aria-label="Show Done"');
  expect(html).toContain('data-hidden-group="In Progress"');
});
