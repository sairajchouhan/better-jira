import { expect, test } from "./app";

test("description block conversions keep Jira-valid structure", async ({ open }) => {
  // QA 2026-11-08: Numbered list did nothing on a bulleted list, and Code block on a list item threw TransformError.
  await test.step("a bulleted list switches to numbered, and a list item becomes a code block", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('#description p')`);
    await page.click("#description p");
    await page.key("End");
    await page.key("Enter");
    await page.type("- QA item");
    await page.waitFor(`!!document.querySelector('#description ul li')`);
    // The toolbar's list menu is off in a heading (as Linear's), so select the item rather than the whole document.
    await page.key("ArrowLeft", "meta", "shift");
    await page.click('[aria-label="List"]');
    await page.eval(`[...document.querySelectorAll('[aria-label="List"] [cmdk-item]')].find(n=>n.querySelector('.menu-name').textContent==='Numbered list').click()`);
    expect(
      await page.waitFor<string>(`document.querySelector('#description ol li')?.textContent`),
    ).toContain("QA item");
    expect(await page.eval(`[...document.querySelectorAll('#description ul li')].some(li=>li.textContent.includes('QA item'))`)).toBe(false);
    // The item stays selected through the list change.
    await page.click('[aria-label="Code block"]');
    expect(
      await page.waitFor<string>(
        `[...document.querySelectorAll('#description pre')].map(n=>n.textContent).join('|')`,
      ),
    ).toContain("QA item");
    expect(await page.eval(`[...document.querySelectorAll('#description li')].some(li=>li.textContent.includes('QA item'))`)).toBe(false);
    await page.close();
  });

  // QA pass 3 #3: Heading 1 on quoted text nested the heading in the quote, which Jira rejects.
  await test.step("quoted text becomes a heading outside the quote", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.querySelector('#description p')`);
    await page.click("#description p");
    await page.key("End");
    await page.key("Enter");
    await page.type("> QA quote");
    await page.waitFor(`!!document.querySelector('#description blockquote p')`);
    await page.key("a", "meta");
    await page.click('[aria-label="Text style"]');
    await page.eval(`[...document.querySelectorAll('[aria-label="Text style"] [cmdk-item]')].find(n=>n.querySelector('.menu-name').textContent==='Heading 1').click()`);
    expect(
      await page.waitFor<string>(
        `[...document.querySelectorAll('#description h1')].map(n=>n.textContent).join('|')`,
      ),
    ).toContain("QA quote");
    expect(await page.eval(`!!document.querySelector('#description blockquote')`)).toBe(false);
  });
});
