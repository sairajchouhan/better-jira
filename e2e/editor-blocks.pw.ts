import { expect, test, fixture, type App as Page } from "./app";

// Package E (backlog round 2026-11-12): editor blocks, menus and references, checked through what reaches Jira.

/** The last description the app wrote to the fake Jira for `key`. */
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
/** A fresh line at the end of the description's first paragraph. */
async function newLine(page: Page) {
  await page.waitFor(`!!document.querySelector('#description p')`);
  await page.click("#description p");
  await page.key("End");
  await page.key("Enter");
}

test("BJ-68: a collapsible section from >>> saves as Jira's expand with its title", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await newLine(page);
  await page.type(">>> ");
  await page.waitFor(`!!document.querySelector('#description .rich-expand')`);
  await page.type("Hidden body");
  await page.click('[aria-label="Collapsible section title"]');
  await page.type("Details");
  await page.click("#description p");
  await waitSaved((doc) =>
    doc.content.some(
      (n: any) => n.type === "expand" && n.attrs.title === "Details" && JSON.stringify(n.content).includes("Hidden body"),
    ),
  );
  // It shows collapsed after a reload, and the disclosure opens it.
  await page.reload();
  await page.waitFor(`document.querySelector('#description .rich-expand')?.dataset.open==='false'`);
  await page.click('[aria-label="Expand section"]');
  await page.waitFor(`document.querySelector('#description .rich-expand')?.dataset.open==='true'`);
  expect(await page.eval(`document.querySelector('[aria-label="Collapsible section title"]').value`)).toBe("Details");
});
