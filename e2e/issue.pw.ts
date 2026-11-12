import { expect, test, sleep, type App as Page } from "./app";

async function openIssue(page: Page, key = "TEST-1") {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(
    `!!document.getElementById("summary")&&!document.querySelector('[role=status]')?.textContent?.startsWith("Loading")`,
  );
}
const editor = (id: string) => `document.querySelector('#${id}[contenteditable=true]')`;

test("issue page editing: description autosave, code block Tab, toolbar rows, comments", async ({
  open,
}) => {
  const page = await open();
  await test.step("I2: Tab inside a description code block indents and keeps focus in the editor", async () => {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`!!${editor("description")}`);
    await page.click("#description pre");
    await page.key("End");
    await page.key("Tab");
    expect(await page.eval(`document.activeElement?.id`)).toBe("description");
    expect(await page.eval(`document.querySelector("#description pre code").textContent`)).toBe(
      "const answer = 42;  ",
    );
  });
  await test.step("I9: the formatting toolbar stays one row when the caret enters a table", async () => {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`!!${editor("description")}`);
    // Like Linear, a focused description shows no toolbar; selecting text shows the floating one.
    await page.click("#description h2");
    expect(
      await page.eval(
        `!!document.getElementById('description').closest('.rich-editor').querySelector('[role=toolbar]')`,
      ),
    ).toBe(false);
    const select = (node: string) =>
      page.eval(
        `(()=>{const n=document.querySelector('${node}'),r=document.createRange();r.selectNodeContents(n.querySelector('p')??n);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`,
      );
    const toolbar = `document.getElementById('description').closest('.rich-editor').querySelector('[role=toolbar]')?.getBoundingClientRect().height`;
    await select("#description h2");
    await page.waitFor(`${toolbar}>0`);
    const before = await page.eval<number>(toolbar);
    await select("#description td");
    await page.waitFor(`${toolbar}>0`);
    expect(await page.eval<number>(toolbar)).toBe(before);
    expect(before).toBeLessThan(40);
  });
  await test.step("I7: a sent comment keeps focus in the comment box, renders Markdown, and can be edited and deleted", async () => {
    await openIssue(page);
    await page.click("#comment");
    await page.type("**bold** first");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===1`);
    await sleep(150);
    expect(await page.eval(`document.activeElement?.id`)).toBe("comment");
    expect(await page.eval(`document.querySelector("[data-comment] strong")?.textContent`)).toBe(
      "bold",
    );
    await page.hover("[data-comment]");
    await page.click('[data-comment] [aria-label="Comment options"]');
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Edit comment"`);
    await page.key("End");
    await page.type(" again");
    await page.click("text=Save comment");
    await page.waitFor(
      `document.querySelector("[data-comment]")?.textContent.includes("first again")`,
    );
    await page.hover("[data-comment]");
    await page.click('[data-comment] [aria-label="Comment options"]');
    await page.click("text=Delete");
    await page.click('[aria-label="Delete this comment?"] button[data-autofocus]');
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===0`);
  });
  await test.step("I6: a line break typed in a comment shows as a line break", async () => {
    await openIssue(page);
    await page.click("#comment");
    await page.type("line one");
    await page.key("Enter");
    await page.type("line two");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll("[data-comment]").length===1`);
    expect(
      await page.eval(`document.querySelector("[data-comment] .comment-body").innerText.trim()`),
    ).toMatch(/^line one\n+line two$/);
  });
  await test.step("R4/I8: the description is edited in place and autosaves, so a reload keeps the change", async () => {
    await openIssue(page);
    await page.key("i", "ctrl", "shift");
    await page.waitFor(`document.activeElement===${editor("description")}`);
    await page.click("#description h2");
    await page.key("End");
    await page.type(" edited");
    expect(await page.eval(`!!document.querySelector('[role=dialog] #description')`)).toBe(false);
    await sleep(1500);
    await page.reload();
    await openIssue(page);
    expect(
      await page.waitFor<string>(`document.querySelector("#description h2")?.textContent`),
    ).toBe("Rich fixture heading edited");
  });
  await test.step("I9b: the floating toolbar sits 8px above the selection, on one row inside a narrow window", async () => {
    for (const width of [1272, 420]) {
      const page = await open("?issue=TEST-2&view=page", { width, height: 800 });
      try {
        await page.waitFor(`!!document.getElementById('comment')`);
        await page.click("#description");
        await page.waitFor(`!!${editor("description")}`);
        // A block at least 150px down, so the toolbar goes above it (its measured height decides the gap).
        await page.eval(
          `(()=>{const d=document.getElementById('description'),top=d.getBoundingClientRect().top,n=[...d.querySelectorAll('p')].find(n=>n.getBoundingClientRect().top-top>=150&&n.textContent.length>3),r=document.createRange();r.selectNodeContents(n);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`,
        );
        const toolbar = `document.getElementById('description').closest('.rich-editor').querySelector('[role=toolbar]')`;
        await page.waitFor(`!!${toolbar}`);
        await sleep(150);
        const [gap, height, left, right] = await page.eval<[number, number, number, number]>(
          `(()=>{const t=${toolbar}.getBoundingClientRect(),s=getSelection().getRangeAt(0).getClientRects()[0];return [s.top-t.bottom,t.height,t.left,innerWidth-t.right]})()`,
        );
        expect(Math.abs(gap - 8)).toBeLessThan(1);
        expect(height).toBeLessThan(40);
        expect(left).toBeGreaterThan(11);
        expect(right).toBeGreaterThan(11);
      } finally {
        await page.close();
      }
    }
  });
});
