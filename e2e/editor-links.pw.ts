import { expect, test } from "./app";

const editor = `document.querySelector('#description .ProseMirror')`;
const linkTo = (href: string) => `#description .ProseMirror a[href="${href}"]`;
const reference = "https://example.test/reference";
const mac = `navigator.platform.includes('Mac')`;
const opened = async (page: { eval: <T>(e: string) => Promise<T> }) =>
  page.eval<string | null>(`(()=>{const u=window.__opened??null;window.__opened=null;return u})()`);

test("BJ-179: a click on a link in the focused description selects it and shows Linear's link editor", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('${linkTo(reference)}')`);
  await page.eval(`window.open=(url)=>{window.__opened=url;return null}`);
  await page.click("#description h2");
  await page.click(linkTo(reference));
  expect(await opened(page)).toBeNull();
  expect(await page.eval(`getSelection().toString()`)).toBe("Formatted fixture");
  await page.waitFor(`!!document.querySelector('[aria-label="Link URL"]')`);
  expect(
    await page.eval(`(()=>{const i=document.querySelector('[aria-label="Link URL"]');return [i.placeholder,i.value]})()`),
  ).toEqual(["Enter link URL", reference]);
  expect(await page.eval(`[...document.querySelectorAll('[aria-label="Link"] button')].map(b=>b.ariaLabel)`)).toEqual([
    "Open in new window",
    "Remove link",
  ]);
  // The editor keeps focus, and the link editor stands in for the formatting toolbar.
  expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
  expect(await page.eval(`!!document.querySelector('[aria-label="Description formatting"]')`)).toBe(false);

  await test.step("Mod held marks links clickable; Mod-click and middle-click open the link", async () => {
    const key = (type: string) =>
      `${editor}.dispatchEvent(new KeyboardEvent('${type}',{key:${mac}?'Meta':'Control',bubbles:true}))`;
    await page.eval(key("keydown"));
    expect(await page.eval(`${editor}.classList.contains('link-active')`)).toBe(true);
    await page.eval(key("keyup"));
    expect(await page.eval(`${editor}.classList.contains('link-active')`)).toBe(false);
    await page.eval(
      `document.querySelector('${linkTo(reference)}').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,detail:1,metaKey:${mac},ctrlKey:!${mac}}))`,
    );
    expect(await opened(page)).toBe(reference);
    await page.eval(
      `document.querySelector('${linkTo(reference)}').dispatchEvent(new MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1}))`,
    );
    expect(await opened(page)).toBe(reference);
  });

  await test.step("⌘K edits the link: a new address applies on ↵ and the caret goes back after it", async () => {
    await page.key("k", "meta");
    await page.waitFor(`document.activeElement?.ariaLabel==='Link URL'`);
    await page.key("a", "meta");
    await page.type("example.test/next");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('${linkTo("https://example.test/next")}')`);
    expect(await page.eval(`document.querySelector('#description').contains(document.activeElement)`)).toBe(true);
    expect(await page.eval(`getSelection().isCollapsed`)).toBe(true);
    expect(await page.eval(`!!document.querySelector('[aria-label="Link URL"]')`)).toBe(false);
  });

  await test.step("Remove link unlinks it", async () => {
    await page.click(linkTo("https://example.test/next"));
    await page.click('[aria-label="Remove link"]');
    await page.waitFor(`!document.querySelector('${linkTo("https://example.test/next")}')`);
    expect(await page.eval<string>(`${editor}.textContent`)).toContain("Formatted fixture");
  });
});
