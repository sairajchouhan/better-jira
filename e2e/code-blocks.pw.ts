import { expect, fixture, test } from "./app";

// Package D (BJ-178): Linear's code block, on the fixture's TypeScript block "const answer = 42;".
const pre = "#description pre.code-block";
const code = `document.querySelector('${pre} > code')`;
/** The codeBlock nodes of the last description fakeJira was sent. */
const savedBlocks = async () => {
  const writes = (await fixture.log()).writes.flatMap((w: any) => w.ops);
  const description = writes.filter((o) => o.op === "fields" && o.fields.description).at(-1)?.fields.description;
  return (description?.content ?? []).filter((n: any) => n.type === "codeBlock");
};

test("code blocks: highlighting, toolbar, collapse and keys", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-1&view=page");
  await page.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.waitFor(`!!document.querySelector('#description[contenteditable=true] pre')`);

  await test.step("the block is highlighted with Linear's classes and numbered", async () => {
    expect(await page.waitFor<string>(`document.querySelector('${pre} .syntax-keyword')?.textContent`)).toBe("const");
    expect(await page.eval(`document.querySelector('${pre} .syntax-constant-numeric')?.textContent`)).toBe("42");
    expect(await page.eval(`document.querySelector('${pre} .cb-gutter').textContent`)).toBe("1");
    expect(await page.eval(`document.querySelector('${pre} .cb-language').textContent`)).toBe("TypeScript");
  });

  await test.step("⌘/ comments the line, ⌘A selects only the block", async () => {
    await page.click(`${pre} > code`);
    await page.key("End");
    await page.key("/", "meta");
    expect(await page.eval(`${code}.textContent`)).toBe("// const answer = 42;");
    await page.key("/", "meta");
    expect(await page.eval(`${code}.textContent`)).toBe("const answer = 42;");
    await page.key("a", "meta");
    expect(await page.eval(`getSelection().toString()`)).toBe("const answer = 42;");
  });

  await test.step("the language picker stores the language in Jira, and Auto detect removes it", async () => {
    await page.hover(pre);
    await page.click(`${pre} .cb-language`);
    await page.type("Pyth");
    await page.key("Enter");
    expect(await page.waitFor<string>(`document.querySelector('${pre} .cb-language').textContent`)).toBe("Python");
    await expect.poll(async () => (await savedBlocks())[0]?.attrs, { timeout: 8000 }).toEqual({ language: "python" });
    await page.hover(pre);
    await page.click(`${pre} .cb-language`);
    await page.type("Auto");
    await page.key("Enter");
    await expect.poll(async () => (await savedBlocks())[0], { timeout: 8000 }).toEqual({
      type: "codeBlock",
      content: [{ type: "text", text: "const answer = 42;" }],
    });
  });

  await test.step("Copy content copies the code with Linear's toast", async () => {
    await page.hover(pre);
    await page.click(`${pre} [aria-label="Copy content"]`);
    expect(
      await page.waitFor<string>(`document.querySelector('.ui-toast')?.textContent`),
    ).toContain("Code contents copied to clipboard");
    expect(await page.eval(`navigator.clipboard.readText()`)).toBe("const answer = 42;");
  });

  await test.step("Display options turn line numbers off and wrapping on", async () => {
    await page.hover(pre);
    await page.click(`${pre} [aria-label="Display options"]`);
    const toggle = (label: string) =>
      page.eval(
        `[...document.querySelectorAll('[aria-label="Display options"][role=group] label')].find(l=>l.textContent==='${label}').querySelector('input').click()`,
      );
    await toggle("Show line numbers");
    await toggle("Wrap lines");
    expect(await page.eval(`document.querySelector('${pre}').dataset.lineNumbers`)).toBe("false");
    expect(await page.eval(`document.querySelector('${pre}').dataset.lineWrap`)).toBe("true");
    expect(await page.eval(`getComputedStyle(document.querySelector('${pre} .cb-gutter')).display`)).toBe("none");
    expect(await page.eval(`getComputedStyle(document.querySelector('${pre}')).whiteSpace`)).toBe("pre-wrap");
    await page.key("Escape");
  });

  await test.step("a block of 30 lines collapses to 15 and expands again", async () => {
    await page.click(`${pre} > code`);
    await page.key("End");
    for (let i = 2; i <= 30; i++) {
      await page.key("Enter");
      await page.type(`line ${i}`);
    }
    expect(await page.eval(`${code}.textContent.split("\\n").length`)).toBe(30);
    await page.hover(pre);
    await page.click(`${pre} .cb-copy [aria-label="Collapse"]`);
    expect(await page.eval(`document.querySelector('${pre}').dataset.collapsed`)).toBe("true");
    expect(await page.eval(`${code}.getBoundingClientRect().height`)).toBeLessThan(
      await page.eval<number>(`${code}.scrollHeight`),
    );
    await page.click(`${pre} .cb-ex-col button`);
    expect(await page.eval(`document.querySelector('${pre}').dataset.collapsed`)).toBeUndefined();
    await expect.poll(async () => (await savedBlocks())[0]?.content?.[0]?.text.split("\n").length, { timeout: 8000 }).toBe(30);
  });

  await test.step("⌫ in an emptied block turns it back into a paragraph", async () => {
    await page.click(`${pre} > code`);
    await page.key("a", "meta");
    await page.key("Backspace");
    expect(await page.eval(`${code}.textContent`)).toBe("");
    await page.key("Backspace");
    expect(await page.eval(`!!document.querySelector('${pre}')`)).toBe(false);
  });
});
