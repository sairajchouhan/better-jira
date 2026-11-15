import { expect, test } from "bun:test";

// Linear leaves 60px between the issue's comment box and the end of the page (the issue content's `sx-efzj8c`,
// padding-bottom: 60px). Ours is the comment frame's 12px margin (mb-3) plus the detail grid's bottom padding, so the
// composer ⌃M (Comment on issue) scrolls to sits as high above the page's end as Linear's.
const dir = new URL("./", import.meta.url);
const css = await Bun.file(new URL("index.css", dir)).text();
const frame = await Bun.file(new URL("features/editor/editor-frame.tsx", dir)).text();
const LINEAR_BELOW_COMPOSER = 60;

const rule = (selector: string, from = 0) => {
  const start = css.indexOf(`${selector} {`, from);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
};
const px = (value: string) => Number(value.replace("px", ""));

test("the comment frame keeps its 12px bottom margin", () => {
  expect(frame).toMatch(/"mb-3 rounded-lg border border-line-2 bg-card"/);
});

test("wide: the grid's bottom padding plus the frame's margin is Linear's 60px", () => {
  const block = rule(".issue-detail-grid").match(/padding-block:\s*([\d.]+px)\s+([\d.]+px);/);
  expect(block).not.toBeNull();
  expect(12 + px(block![2]!)).toBe(LINEAR_BELOW_COMPOSER);
});

test("narrow: the stacked layout's bottom padding plus the frame's margin is Linear's 60px too", () => {
  const narrow = css.indexOf("@container issue-detail (width < 820px)");
  const padding = rule(".issue-detail-grid", narrow).match(/padding:\s*[\d.]+px\s+[\d.]+px\s+([\d.]+px);/);
  expect(padding).not.toBeNull();
  expect(12 + px(padding![1]!)).toBe(LINEAR_BELOW_COMPOSER);
});
