import { expect, test, fixture } from "./app";

// Editor parity package A (BJ-176): Linear's editor typography and chrome. Every value comes from Linear's bundle
// (style-kMXsq6uH.css, FS() and zrn.editorSurface in startup-root.CnUSfl4j.js) or a read-only getComputedStyle on a
// linear.app issue description (2026-11-12).

/** getComputedStyle(`selector`)[prop] for each prop, inside the description. */
const styleOf = (page: any, selector: string, props: string[], pseudo = "") =>
  page.eval(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return null;const s=getComputedStyle(n${pseudo ? `,${JSON.stringify(pseudo)}` : ""});return ${JSON.stringify(props)}.map(p=>s[p])})()`,
  );

test("BJ-176: the description reads like Linear's: 15px/450 text on a borderless surface with 16/6/22px rhythm", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description table')`);
  // R p + R .text-node: 15px, 1.6, 450, -.00666667em.
  expect(await styleOf(page, "#description > p", ["fontSize", "lineHeight", "fontWeight", "letterSpacing"])).toEqual([
    "15px",
    "24px",
    "450",
    "-0.1px",
  ]);
  // St.editorSurface: margin 0 -14px, padding 10px 14px 16px; no card around it.
  expect(await styleOf(page, "#description", ["marginLeft", "marginRight", "padding", "borderTopWidth"])).toEqual([
    "-14px",
    "-14px",
    "10px 14px 16px",
    "0px",
  ]);
  expect(await styleOf(page, ".issue-description .rich-editor", ["borderTopWidth"])).toEqual(["0px"]);
  // h2 (first block): 19px/28px, 600, labelTitle; no top margin as the first block, 16px under it.
  expect(await styleOf(page, "#description > h2", ["fontSize", "lineHeight", "fontWeight", "marginTop", "marginBottom"])).toEqual([
    "19px",
    "28px",
    "600",
    "0px",
    "16px",
  ]);
  // Rhythm: text → list 6px, list → code block 22px, code block → table 22px.
  expect(await styleOf(page, "#description > ul", ["marginTop", "paddingLeft"])).toEqual(["6px", "24px"]);
  expect(await styleOf(page, "#description > pre", ["marginTop"])).toEqual(["22px"]);
  expect(await styleOf(page, "#description > .tableWrapper", ["marginTop"])).toEqual(["22px"]);
  // Marks: bold 600, links in purpleText with no underline at rest.
  expect(await styleOf(page, "#description strong", ["fontWeight"])).toEqual(["600"]);
  expect(await styleOf(page, "#description a", ["textDecorationLine"])).toEqual(["none"]);
  // The bullet is Linear's ::before disc in the gutter, not a native marker.
  expect(await styleOf(page, "#description > ul > li", ["listStyleType"])).toEqual(["none"]);
  expect(await styleOf(page, "#description > ul > li", ["position", "content"], "::before")).toEqual([
    "absolute",
    "counter(editor-ul, disc)",
  ]);
  // Code block chrome: radius 6px, a hairline (0.5px; Chromium draws it 1px at DPR 1), no wrapping, 12px/16px padding
  // and its own horizontal scroll.
  expect(await styleOf(page, "#description pre", ["borderTopLeftRadius", "borderTopStyle", "whiteSpace"])).toEqual([
    "6px",
    "solid",
    "pre",
  ]);
  expect(await styleOf(page, "#description pre code", ["padding", "overflowX"])).toEqual(["12px 16px", "auto"]);
  // Table frame: rounded hairline, separate borders, cells 5px 8px.
  expect(await styleOf(page, "#description table", ["borderTopLeftRadius", "borderCollapse", "borderTopStyle"])).toEqual([
    "6px",
    "separate",
    "solid",
  ]);
  expect(await styleOf(page, "#description th", ["padding"])).toEqual(["5px 8px"]);
});

test("BJ-176: menus, the block handle, the toolbar and collapsible sections take Linear's sizes", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  const width = (label: string) =>
    page.waitFor<number>(`document.querySelector('[aria-label="${label}"]')?.getBoundingClientRect().width`);
  await page.waitFor(`!!document.querySelector('#description > p')`);
  await page.click("#description > p");
  await page.key("End");
  await page.key("Enter");
  await test.step("slash menu 240px; emoji and mention menus 350px (EditorComponent widths)", async () => {
    await page.type("/");
    expect(await width("Insert block")).toBe(240);
    await page.key("Escape");
    await page.type(" :sm");
    expect(await width("Insert emoji")).toBe(350);
    await page.key("Escape");
    await page.type(" @");
    expect(await width("Mention people")).toBe(350);
    await page.key("Escape");
  });
  await test.step("the block handle is 20px", async () => {
    await page.waitFor(`!!document.querySelector('.rich-block-handle')`);
    const box = await page.eval<number[]>(
      `(()=>{const r=document.querySelector('.rich-block-handle').getBoundingClientRect();return [r.width,r.height]})()`,
    );
    expect(box).toEqual([20, 20]);
  });
  await test.step("the selection toolbar divides its groups with 1×16px separators", async () => {
    await page.click("#description > p");
    await page.key("End");
    await page.key("ArrowLeft", "shift");
    const separator = await page.waitFor<number[]>(
      `(()=>{const n=document.querySelector('[role="toolbar"] [role="separator"]');if(!n)return;const r=n.getBoundingClientRect();return [r.width,r.height]})()`,
    );
    expect(separator).toEqual([1, 16]);
  });
  await test.step("a collapsible section is borderless with a gutter toggle and Linear's placeholder", async () => {
    await page.click("#description > p");
    await page.key("End");
    await page.key("Enter");
    await page.type(">>> ");
    await page.waitFor(`!!document.querySelector('#description .rich-expand')`);
    expect(await styleOf(page, "#description .rich-expand", ["borderTopWidth", "paddingLeft"])).toEqual(["0px", "24px"]);
    expect(
      await page.eval(`document.querySelector('[aria-label="Collapsible section title"]').placeholder`),
    ).toBe("Add section title…");
    // The toggle sits in the gutter, 5px left of the section's own edge.
    const offset = await page.eval<number>(
      `(()=>{const s=document.querySelector('#description .rich-expand').getBoundingClientRect(),t=document.querySelector('.rich-expand-toggle').getBoundingClientRect();return t.left-s.left})()`,
    );
    expect(offset).toBe(-5);
  });
});
