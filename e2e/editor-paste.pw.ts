import { expect, test, fixture, type App as Page } from "./app";

// Package C (editor parity 2026-11-12): pasting into the description like Linear, checked through what reaches Jira.

const savedDescription = async (key = "TEST-2") => {
  const writes = (await fixture.log()).writes.filter((w: { key: string }) => w.key === key);
  for (const write of writes.reverse())
    for (const op of write.ops) if (op.op === "fields" && op.fields.description) return op.fields.description;
  return null;
};
const waitSaved = (match: (doc: any) => boolean) =>
  expect.poll(async () => {
    const doc = await savedDescription();
    return !!doc && match(doc);
  }, { timeout: 8000 }).toBe(true);
async function newLine(page: Page) {
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.key("Enter");
}
/** A paste event on the description carrying `data` by clipboard type. */
const paste = (page: Page, data: Record<string, string>) =>
  page.eval(
    `(()=>{const data=new DataTransfer();for(const [k,v] of Object.entries(${JSON.stringify(data)}))data.setData(k,v);document.getElementById('description').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`,
  );
const blur = (page: Page) => page.click("#description h2");
const has = (doc: any, test: (node: any) => boolean): boolean => test(doc) || (doc.content ?? []).some((n: any) => has(n, test));

test("BJ-174 rows 73, 75: a pasted URL becomes a link; this app's issue link becomes Jira's issue card", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await paste(page, { "text/plain": "https://example.test/docs" });
  await page.waitFor(`[...document.querySelectorAll('#description a')].some(a=>a.href==='https://example.test/docs')`);
  expect(await page.eval(`!!document.querySelector('[aria-label="Pasted link"]')`)).toBe(false);
  await page.key("Enter");
  const origin = await page.eval<string>("location.origin");
  await paste(page, { "text/plain": `${origin}/?issue=TEST-3` });
  await blur(page);
  await waitSaved(
    (doc) =>
      has(doc, (n) => n.marks?.some((m: any) => m.type === "link" && m.attrs.href === "https://example.test/docs")) &&
      has(doc, (n) => n.type === "inlineCard" && n.attrs.url.endsWith("/browse/TEST-3")),
  );
});

test("BJ-174 rows 17, 56: a YouTube link offers Embed video; Tab embeds it, Esc keeps the link", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const items = `[...document.querySelectorAll('[aria-label="Pasted link"] [cmdk-item]')].map(n=>n.textContent)`;
  await newLine(page);
  await paste(page, { "text/plain": url });
  expect(await page.waitFor<string[]>(`(()=>{const i=${items};return i.length&&i})()`)).toEqual([
    expect.stringContaining("Embed video"),
    expect.stringContaining("Keep as link"),
  ]);
  await page.key("Escape");
  await page.waitFor(`!document.querySelector('[aria-label="Pasted link"]')`);
  expect(await page.eval(`[...document.querySelectorAll('#description a')].some(a=>a.href===${JSON.stringify(url)})`)).toBe(true);
  await page.key("Enter");
  await paste(page, { "text/plain": url });
  await page.waitFor(`!!document.querySelector('[aria-label="Pasted link"]')`);
  await page.key("Tab");
  await page.waitFor(`document.querySelector('#description .rich-embed iframe')?.src==='https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'`);
  await blur(page);
  await waitSaved((doc) => doc.content.some((n: any) => n.type === "embedCard" && n.attrs.url === url && n.attrs.layout === "center"));
  await page.reload();
  await page.waitFor(`!!document.querySelector('#description .rich-embed iframe')`, 15000);
});

test("BJ-177 rows 76, 77: Markdown, VS Code code and Notion/Google Docs formatting paste as rich text", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await paste(page, {
    "text/plain": "weighted code",
    "text/html": '<p><span style="font-weight:700">weighted</span> <div class="notion-inline-code-container">code</div></p>',
  });
  // Each paste ends in a paragraph, so the next one isn't pasted into a code block.
  await paste(page, { "text/plain": "## Plan\n\n- one\n- two\n\n```ts\nconst x = 1\n```\n\nthen" });
  await page.waitFor(`[...document.querySelectorAll('#description h2')].some(h=>h.textContent==='Plan')`);
  await paste(page, { "text/plain": "    def f():\n        return 1\n", "vscode-editor-data": '{"version":1,"mode":"python"}' });
  await blur(page);
  await waitSaved(
    (doc) =>
      has(doc, (n) => n.type === "heading" && n.content?.[0]?.text === "Plan") &&
      has(doc, (n) => n.type === "bulletList" && n.content.length === 2) &&
      has(doc, (n) => n.type === "codeBlock" && n.attrs?.language === "ts" && n.content?.[0]?.text === "const x = 1") &&
      has(doc, (n) => n.type === "codeBlock" && n.attrs?.language === "python" && n.content?.[0]?.text === "def f():\n    return 1") &&
      has(doc, (n) => n.text === "weighted" && n.marks?.some((m: any) => m.type === "strong")) &&
      has(doc, (n) => n.text === "code" && n.marks?.some((m: any) => m.type === "code")),
  );
});

test("BJ-177 row 78: tab-separated rows paste as a table with a header row", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await paste(page, { "text/plain": "Name\tOwner\nAPI\tAna\nUI\tBo" });
  await blur(page);
  await waitSaved((doc) =>
    has(
      doc,
      (n) =>
        n.type === "table" &&
        n.content.length === 3 &&
        n.content[0].content[0].type === "tableHeader" &&
        JSON.stringify(n.content[2]).includes("Bo"),
    ),
  );
});

test("BJ-177 rows 79, 80: a pasted image is uploaded and a long text becomes pasted.txt", async ({ open }) => {
  await fixture.reset();
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  const pixel =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await paste(page, { "text/plain": "shot", "text/html": `<p>shot</p><img src="${pixel}">` });
  await page.waitFor(`[...document.querySelectorAll('#description img')].some(i=>i.src.startsWith('blob:'))`, 8000);
  await paste(page, { "text/plain": Array.from({ length: 101 }, (_, i) => `line ${i}`).join("\n") });
  await page.waitFor(`[...document.querySelectorAll('#description .file-media')].some(n=>n.textContent.includes('pasted.txt'))`, 8000);
  expect(await page.eval(`document.getElementById('description').textContent.includes('line 100')`)).toBe(false);
});

test("BJ-177 rows 81, 84: ⌘⌥⇧V pastes Markdown as text; a paste past Jira's limit is refused with a message", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.key("v", "meta", "alt", "shift");
  await paste(page, { "text/plain": "## not a heading" });
  await page.waitFor(`document.getElementById('description').textContent.includes('## not a heading')`);
  await page.key("v", "meta", "alt", "shift");
  await paste(page, { "text/plain": "x".repeat(33_000) });
  await page.waitFor(`document.querySelector('[data-toast]')?.textContent?.includes("32,767 characters")`);
  expect(await page.eval(`document.getElementById('description').textContent.includes('xxxxxxxxxx')`)).toBe(false);
});
