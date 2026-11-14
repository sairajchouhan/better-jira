import { expect, test, fixture, type App as Page, shownIssue } from "./app";

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
  // QA-3 D5: the title takes the caret, as Linear's heading does; Enter moves on to the body.
  await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Collapsible section title'`);
  await page.type("Details");
  await page.key("Enter");
  await page.type("Hidden body");
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

test("BJ-42 / BJ-57 / BJ-43: the slash, emoji and @ menus insert blocks, emoji and issue references", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  const menu = (label: string) =>
    page.waitFor<string[]>(
      `(()=>{const items=[...document.querySelectorAll('[aria-label="${label}"] [role^=menuitem] .menu-name')].map(n=>n.textContent);return items.length&&items})()`,
    );
  await test.step("BJ-42: / then a name, Enter: a divider", async () => {
    await newLine(page);
    await page.type("/");
    expect(await menu("Insert block")).toContain("Collapsible section");
    await page.type("divi");
    expect(await menu("Insert block")).toEqual(["Divider"]);
    await page.key("Enter");
    await page.waitFor(`!document.querySelector('[aria-label="Insert block"]')`);
    expect(await page.eval(`document.getElementById('description').textContent.includes('/divi')`)).toBe(false);
  });
  await test.step("BJ-57: :tad then Enter inserts 🎉", async () => {
    await page.type("Shipped :tad");
    expect((await menu("Insert emoji"))[0]).toContain(":tada:");
    await page.key("Enter");
  });
  await test.step("BJ-43: @ an issue key picks the issue; a typed key becomes a reference too", async () => {
    await page.type(" see @TEST-3");
    await page.waitFor(
      `[...document.querySelectorAll('[aria-label="Mention people"] [role^=menuitem]')].some(n=>n.textContent.startsWith('TEST-3'))`,
    );
    await page.eval(
      `[...document.querySelectorAll('[aria-label="Mention people"] [role^=menuitem]')].find(n=>n.querySelector('.menu-name').textContent.startsWith('TEST-3')).click()`,
    );
    await page.type("and TEST-4 ");
  });
  await page.click("#description h2");
  await waitSaved((doc) => {
    const json = JSON.stringify(doc);
    return (
      doc.content.some((n: any) => n.type === "rule") &&
      json.includes('"shortName":":tada:"') &&
      json.includes("/browse/TEST-3") &&
      json.includes("/browse/TEST-4")
    );
  });
  expect(await page.eval(`[...document.querySelectorAll('#description a.smart-link[data-smart-link=issue] .smart-link-affix')].map(n=>n.textContent.trim())`)).toEqual([
    "TEST-3",
    "TEST-4",
  ]);
});

test("links in the description open on click: other sites in a new tab, an issue reference in the app", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description .ProseMirror a[href="https://example.test/reference"], #description a[href="https://example.test/reference"]')`);
  await page.eval(`window.open=(url)=>{window.__opened=url;return null}`);
  await page.click('#description a[href="https://example.test/reference"]');
  expect(await page.eval(`window.__opened`)).toBe("https://example.test/reference");
  await page.click("#description h2");
  await page.key("End");
  await page.key("Enter");
  await page.type("see TEST-4 ");
  await page.waitFor(`[...document.querySelectorAll('#description a.smart-link[data-smart-link=issue] .smart-link-affix')].some(n=>n.textContent.trim()==='TEST-4')`);
  await page.eval(`[...document.querySelectorAll('#description a.smart-link[data-smart-link=issue]')].find(n=>n.textContent.includes('TEST-4')).click()`);
  await page.waitFor(`${shownIssue}==='TEST-4'`);
});

test("BJ-69: Create issue from selection opens the composer titled with the selected text, related to this issue", async ({
  open,
}) => {
  await fixture.reset({ writable: true, createSuccess: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  await page.key("End");
  await page.key("Home", "shift");
  await page.click('[aria-label="Create issue from selection"]');
  expect(await page.waitFor<string>(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value`)).toBe(
    "Rich fixture heading",
  );
  await page.eval(
    `[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent==='Create issue').click()`,
  );
  await expect
    .poll(async () => (await fixture.log()).writes.flatMap((w: any) => w.ops.map((op: any) => [w.key, op.op, op.fields?.summary ?? op.kind])), {
      timeout: 8000,
    })
    .toEqual([
      ["TEST-NEW1", "create", "Rich fixture heading"],
      ["TEST-2", "link", "related"],
      ["TEST-2", "fields", undefined], // BJ-69: the selected text became a reference to the new issue
    ]);
});

test("BJ-69: the created issue replaces the selected text with a reference, saved under its Jira key", async ({ open }) => {
  await fixture.reset({ writable: true, createSuccess: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  await page.key("End");
  await page.key("Home", "shift");
  await page.click('[aria-label="Create issue from selection"]');
  await page.waitFor(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value === "Rich fixture heading"`);
  await page.key("Enter", "meta");
  await page.eval(`history.pushState({},'', '/issue/TEST-2');dispatchEvent(new PopStateEvent('popstate'))`);
  // The heading's text is now Jira's smart link to the new issue, drawn as its mention chip (which shows the new issue's title).
  await page.waitFor(`!!document.querySelector('#description h2 a.smart-link[data-smart-link=issue]')`);
  await waitSaved(doc => JSON.stringify(doc).includes("/browse/TEST-90"));
  const description = JSON.stringify(await savedDescription());
  expect(description).toMatch(/"type":"inlineCard","attrs":\{"url":"[^"]*\/browse\/TEST-90"\}/);
  expect(description).not.toContain("Rich fixture heading");
  await page.reload();
  await page.waitFor(`!!document.querySelector('#description a[href$="/browse/TEST-90"]')`);
  expect(await page.eval(`document.body.textContent.includes("TEST-90")`)).toBe(true);
});

test("BJ-56 / BJ-55: no block handle (Linear has none for text); ⌥↓ moves the caret's block", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  const blocks = () =>
    page.eval<string[]>(`[...document.getElementById('description').children].map(n=>n.tagName+':'+n.textContent)`);
  const before = await blocks();
  await page.click("#description h2");
  expect(await page.eval(`!!document.querySelector('[aria-label="Block actions"], [aria-label="Block menu"]')`)).toBe(false);
  await page.key("ArrowDown", "alt");
  await page.waitFor(`document.getElementById('description').children[0].textContent===${JSON.stringify(before[1]!.replace(/^[A-Z0-9]+:/, ""))}`);
  expect((await blocks())[1]).toBe(before[0]);
});


test("BJ-170: a refused selection create restores its source text and removes the temporary card", async ({ open }) => {
  await fixture.reset({ writable: true });
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.querySelector('#description h2')`);
  await page.click("#description h2");
  await page.key("End");
  await page.key("Home", "shift");
  await page.click('[aria-label="Create issue from selection"]');
  await page.waitFor(`document.querySelector('[role="dialog"] [aria-label="Issue title"]')?.value === "Rich fixture heading"`);
  await page.key("Enter", "meta");
  await page.waitFor(`document.querySelector('[data-toast]')?.textContent.includes("Jira refused")`);
  await page.key("Escape");
  await page.eval(`history.pushState({},'', '/issue/TEST-2');dispatchEvent(new PopStateEvent('popstate'))`);
  await page.waitFor(`document.querySelector('#description h2')?.textContent === "Rich fixture heading"`);
  await waitSaved(doc => JSON.stringify(doc).includes("Rich fixture heading") && !JSON.stringify(doc).includes("TEST-NEW"));
  expect(await page.eval(`!!document.querySelector('[data-key^="TEST-NEW"]')`)).toBe(false);
});
