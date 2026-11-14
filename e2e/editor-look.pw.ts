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

test("BJ-176: menus, the table handle, the toolbar and collapsible sections take Linear's sizes", async ({ open }) => {
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
  await test.step("the block handle (a table's gutter button; text blocks have none) is 20px", async () => {
    await page.key("Enter");
    await page.type("/table");
    await page.key("Enter");
    const box = await page.waitFor<number[]>(
      `(()=>{const n=document.querySelector('.rich-block-handle');if(!n)return;const r=n.getBoundingClientRect();return [r.width,r.height]})()`,
    );
    expect(box).toEqual([20, 20]);
  });
  await test.step("the selection toolbar divides its groups with 1×16px separators", async () => {
    // On plain text: the description's first line ends in a link, whose popover stands in for the toolbar.
    await page.click("#description > p");
    await page.key("End");
    await page.key("Enter");
    await page.type("plain");
    await page.key("ArrowLeft", "shift");
    const separator = await page.waitFor<number[]>(
      `(()=>{const n=document.querySelector('[aria-label="Description formatting"] [role="separator"]');if(!n)return;const r=n.getBoundingClientRect();return [r.width,r.height]})()`,
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

// Linear's typography (style-kMXsq6uH.css `@layer base`, `@layer reset`; DGe.container in startup-root): its own
// Inter 4.1 files, self-hosted, preloaded; Inter for keycaps; the monospace stack for code only.
test("the app renders Linear's font: self-hosted Inter Variable, its stack, features and code font", async ({ open }) => {
  const page = await open("?issue=TEST-1&view=page");
  await page.waitFor(`!!document.querySelector('#description pre code')`);
  await page.eval(`document.fonts.ready.then(()=>true)`);
  const font = await page.eval<Record<string, unknown>>(
    `(()=>{const b=getComputedStyle(document.body),files=performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/\\.woff2?\\b/.test(n));return {
      upright:document.fonts.check('13px "Inter Variable"'),italic:[...document.fonts].some(f=>f.family.replace(/"/g,'')==='Inter Variable'&&f.style==='italic'),
      loaded:[...document.fonts].some(f=>f.family.replace(/"/g,'')==='Inter Variable'&&f.style==='normal'&&f.status==='loaded'&&f.unicodeRange.startsWith('U+0-2B1B')),
      family:b.fontFamily,rendering:b.textRendering,smoothing:b.webkitFontSmoothing,
      preload:!!document.querySelector('link[rel=preload][as=font][type="font/woff2"][crossorigin][href*="InterVariable-"]'),
      selfHosted:files.length>0&&files.every(n=>new URL(n).origin===location.origin),
    }})()`,
  );
  expect(font).toEqual({
    upright: true,
    italic: true,
    loaded: true,
    family:
      '"Inter Variable", "SF Pro Display", -apple-system, "system-ui", "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", "Linear Thai", sans-serif',
    rendering: "optimizelegibility",
    smoothing: "antialiased",
    preload: true,
    selfHosted: true,
  });
  // The editor keeps Inter's contextual alternates on (DGe.container font-feature-settings:"calt").
  expect(await styleOf(page, "#description > p", ["fontFeatureSettings", "fontVariantLigatures"])).toEqual(['"calt"', "normal"]);
  // Code blocks use Linear's code-block stack at 12px on 20px lines (read live); both stacks add ui-monospace where
  // Berkeley Mono can't ship. The block itself and inline code use --font-monospace.
  const block =
    '"Berkeley Mono", "Fira Code", "Jetbrains Mono", ui-monospace, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", "Kohinoor Devanagari", "Nirmala UI", "Noto Sans Devanagari", monospace';
  const mono = '"Berkeley Mono", ui-monospace, "SFMono Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace';
  expect(await styleOf(page, "#description pre code", ["fontFamily", "fontSize", "lineHeight", "fontFeatureSettings"])).toEqual([
    block,
    "12px",
    "20px",
    "normal",
  ]);
  expect(await styleOf(page, "#description pre .cb-gutter", ["fontFamily"])).toEqual([block]);
  expect(await styleOf(page, "#description pre", ["fontFamily"])).toEqual([mono]);
  // A keycap is Inter with "cv08","zero", as Linear's reset leaves kbd on the surrounding font.
  expect(
    await page.eval(
      `(()=>{const k=document.createElement('kbd');k.className='ui-keycap';k.textContent='0';document.body.append(k);const s=getComputedStyle(k),r=[s.fontFamily.split(',')[0],s.fontFeatureSettings];k.remove();return r})()`,
    ),
  ).toEqual(['"Inter Variable"', '"cv08", "zero"']);
  // The issue key is Linear's WP (Xxt.entityIdentifier): "tnum","cpsp","calt" and −.02em of its own size.
  expect(
    await page.waitFor(
      `(()=>{const k=document.querySelector('.ui-entity-id');if(!k)return;const s=getComputedStyle(k);return [s.fontFeatureSettings,Math.round(parseFloat(s.letterSpacing)/parseFloat(s.fontSize)*100)/100]})()`,
    ),
  ).toEqual(['"calt", "cpsp", "tnum"', -0.02]); // Chrome lists features in tag order
});
