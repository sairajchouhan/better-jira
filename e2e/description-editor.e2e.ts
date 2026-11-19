import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./app";

const openIssue = async (page: Page, key: string, title: string) => {
  await page
    .getByRole("grid", { name: "Todo" })
    .getByRole("row", { name: `${key} ${title}`, exact: true })
    .getByText(title, { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue(title);
};
const descriptionOf = (page: Page) => page.getByRole("textbox", { name: "Issue description" });
/** The editor has taken over from its read-only stand-in, which is busy until the editor's chunk arrives. */
const editorReady = async (description: Locator) => {
  await expect(description).toBeVisible();
  await expect(description).not.toHaveAttribute("aria-busy", "true");
};

/** The text of an ADF document, its blocks one per line. */
const plain = (node: any): string =>
  node?.type === "text"
    ? node.text
    : (node?.content ?? []).map(plain).join(node?.type === "doc" ? "\n" : "");
const jiraDescription = async (app: { jiraIssue(key: string): Promise<{ full: any }> }) =>
  (await app.jiraIssue("TEST-2")).full.fields.description;

/** Places the caret at the end of the line that reads `text`. Under parallel runs the click that first focused the editor
 *  sometimes left the caret at the start of the line, so the line is clicked again once the editor has focus. */
const caretAfter = async (page: Page, text: string) => {
  const description = descriptionOf(page),
    line = description.getByText(text, { exact: true });
  await editorReady(description);
  await line.click();
  await expect(description).toBeFocused();
  await line.click();
  await page.keyboard.press("End");
};
/** A paste of `text` as the clipboard's plain text, as the system clipboard would deliver it. */
const paste = (description: Locator, text: string) =>
  description.evaluate((editor, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, text);

test("32. an edited description autosaves to Jira and survives a reload", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Steps to reproduce" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await expect(description).toHaveText("Steps to reproduce");

  await caretAfter(page, "Steps to reproduce");
  await page.keyboard.type(" on a fresh board");

  // No blur and no submit: the pause after typing saves it.
  await expect.poll(async () => plain(await jiraDescription(app))).toBe("Steps to reproduce on a fresh board");
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  await page.reload();
  await expect(description).toHaveText("Steps to reproduce on a fresh board");
});

test("33. headings, lists, checklists, code, tables and links typed in the editor reach Jira and come back the same", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Plan" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "Plan");

  const keys = ["Enter", "Tab", "ArrowDown"];
  for (const input of [
    "Enter", "## Rollout heading", "Enter",
    "Read [the guide](https://example.com/guide) first", "Enter",
    "- bullet one", "Enter", "Enter",
    "1. first step", "Enter", "Enter",
    "[]", "check one", "Enter", "Enter",
    "```", "let answer = 42;", "ArrowDown",
    "|--", "head a", "Tab", "head b", "Tab", "cell a", "Tab", "cell b",
  ])
    await (keys.includes(input) ? page.keyboard.press(input) : page.keyboard.type(input));

  const text = (value: string) => ({ type: "text", text: value });
  const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] });
  const item = (value: string) => ({ type: "listItem", content: [paragraph(value)] });
  const cell = (value: string) => ({ type: "tableCell", content: [paragraph(value)] });
  await expect.poll(async () => (await jiraDescription(app)).content, { timeout: 10_000 }).toEqual([
    paragraph("Plan"),
    { type: "heading", attrs: { level: 2 }, content: [text("Rollout heading")] },
    {
      type: "paragraph",
      content: [
        text("Read "),
        { ...text("the guide"), marks: [{ type: "link", attrs: { href: "https://example.com/guide" } }] },
        text(" first"),
      ],
    },
    { type: "bulletList", content: [item("bullet one")] },
    expect.objectContaining({ type: "orderedList", content: [item("first step")] }),
    {
      type: "taskList",
      attrs: { localId: expect.any(String) },
      content: [
        { type: "taskItem", attrs: { state: "TODO", localId: expect.any(String) }, content: [text("check one")] },
      ],
    },
    expect.objectContaining({ type: "codeBlock", content: [text("let answer = 42;")] }),
    expect.objectContaining({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("head a"), cell("head b")] },
        { type: "tableRow", content: [cell("cell a"), cell("cell b")] },
      ],
    }),
  ]);
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  const sent = await jiraDescription(app),
    writes = (await app.jiraWrites()).length;

  await page.reload();
  await editorReady(description);
  await expect(description.getByRole("heading", { level: 2, name: "Rollout heading" })).toBeVisible();
  await expect(description.getByRole("link", { name: "the guide" })).toHaveAttribute("href", "https://example.com/guide");
  await expect(description.getByRole("listitem").filter({ hasText: "bullet one" })).toBeVisible();
  await expect(description.getByRole("listitem").filter({ hasText: "first step" })).toBeVisible();
  await expect(
    description.getByRole("listitem").filter({ hasText: "check one" }).getByRole("checkbox", { name: "Checklist item" }),
  ).not.toBeChecked();
  await expect(description.getByRole("code")).toHaveText("let answer = 42;");
  const table = description.getByRole("table");
  await expect(table.getByRole("row", { name: "head a head b" })).toBeVisible();
  await expect(table.getByRole("row", { name: "cell a cell b" })).toBeVisible();
  // Opening it again writes nothing: Jira still holds exactly what it was sent.
  expect(await jiraDescription(app)).toEqual(sent);
  expect(await app.jiraWrites()).toHaveLength(writes);
});

test("34. ticking a checklist item saves it to Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  const task = (id: string, value: string) => ({
    type: "taskItem",
    attrs: { localId: id, state: "TODO" },
    content: [{ type: "text", text: value }],
  });
  await app.changeInJira({
    key: "TEST-2",
    description: {
      type: "doc",
      version: 1,
      content: [{ type: "taskList", attrs: { localId: "list-1" }, content: [task("item-1", "Ship it"), task("item-2", "Write docs")] }],
    },
  });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await editorReady(description);
  const box = (value: string) =>
    description.getByRole("listitem").filter({ hasText: value }).getByRole("checkbox", { name: "Checklist item" });
  await expect(box("Write docs")).not.toBeChecked();

  await box("Write docs").click();

  await expect(box("Write docs")).toBeChecked();
  const states = async () =>
    (await jiraDescription(app)).content[0].content.map((item: any) => [plain(item), item.attrs.state]);
  await expect.poll(states).toEqual([["Ship it", "TODO"], ["Write docs", "DONE"]]);
  await page.reload();
  await expect(box("Write docs")).toBeChecked();
  await expect(box("Ship it")).not.toBeChecked();
});

test("35. a pasted URL becomes a link Jira keeps", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Reference" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "Reference");
  await page.keyboard.press("Enter");

  await paste(description, "https://example.org/runbook");

  await expect(description.getByRole("link", { name: "https://example.org/runbook" })).toHaveAttribute(
    "href",
    "https://example.org/runbook",
  );
  await expect.poll(async () => (await jiraDescription(app)).content[1]).toEqual({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: "https://example.org/runbook",
        marks: [{ type: "link", attrs: { href: "https://example.org/runbook" } }],
      },
    ],
  });
  await page.reload();
  await expect(description.getByRole("link", { name: "https://example.org/runbook" })).toBeVisible();
});

test("35. pasted Markdown becomes headings, formatting, lists and code in Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Notes" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "Notes");
  await page.keyboard.press("Enter");

  await paste(
    description,
    "## Pasted heading\n\nSome **bold** words and a [link](https://example.com/spec)\n\n- first point\n- second *point*\n\n```ts\nconst pasted = true;\n```",
  );

  await expect(description.getByRole("heading", { level: 2, name: "Pasted heading" })).toBeVisible();
  await expect(description.getByRole("link", { name: "link", exact: true })).toHaveAttribute("href", "https://example.com/spec");
  await expect(description.getByRole("code")).toHaveText("const pasted = true;");
  const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
  await expect.poll(async () => (await jiraDescription(app)).content.slice(1)).toEqual([
    { type: "heading", attrs: { level: 2 }, content: [text("Pasted heading")] },
    {
      type: "paragraph",
      content: [
        text("Some "),
        text("bold", [{ type: "strong" }]),
        text(" words and a "),
        text("link", [{ type: "link", attrs: { href: "https://example.com/spec" } }]),
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [text("first point")] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [text("second "), text("point", [{ type: "em" }])] }] },
      ],
    },
    { type: "codeBlock", attrs: { language: "ts" }, content: [text("const pasted = true;")] },
  ]);
  await page.reload();
  await expect(description.getByRole("heading", { level: 2, name: "Pasted heading" })).toBeVisible();
});

test("35. a pasted Markdown list item that starts with formatting keeps it in Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Notes" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "Notes");
  await page.keyboard.press("Enter");

  await paste(
    description,
    [
      "- **Owner** decides",
      "- [Spec](https://example.com/spec) is final",
      "- `flag` stays on, then *more* text",
      "",
      "1. *First* step",
      "2. ~~Old~~ step",
      "",
      "* [ ] **Ship** it",
    ].join("\n"),
  );

  const text = (value: string, marks?: unknown[]) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
  const item = (...content: unknown[]) => ({ type: "listItem", content: [{ type: "paragraph", content }] });
  await expect.poll(async () => (await jiraDescription(app)).content.slice(1)).toEqual([
    {
      type: "bulletList",
      content: [
        item(text("Owner", [{ type: "strong" }]), text(" decides")),
        item(text("Spec", [{ type: "link", attrs: { href: "https://example.com/spec" } }]), text(" is final")),
        item(text("flag", [{ type: "code" }]), text(" stays on, then "), text("more", [{ type: "em" }]), text(" text")),
      ],
    },
    expect.objectContaining({
      type: "orderedList",
      content: [item(text("First", [{ type: "em" }]), text(" step")), item(text("Old", [{ type: "strike" }]), text(" step"))],
    }),
    {
      type: "taskList",
      attrs: { localId: expect.any(String) },
      content: [
        {
          type: "taskItem",
          attrs: { state: "TODO", localId: expect.any(String) },
          content: [text("Ship", [{ type: "strong" }]), text(" it")],
        },
      ],
    },
  ]);
});

test("35. pasted tab-separated rows become a table with a header row in Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Owners" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "Owners");
  await page.keyboard.press("Enter");

  await paste(description, "Name\tRole\nAda\tEngineer\nLin\tDesigner");

  const table = description.getByRole("table");
  await expect(table.getByRole("columnheader", { name: "Role" })).toBeVisible();
  await expect(table.getByRole("row", { name: "Lin Designer" })).toBeVisible();
  const cell = (type: string, value: string) => ({
    type,
    content: [{ type: "paragraph", content: [{ type: "text", text: value }] }],
  });
  await expect.poll(async () => (await jiraDescription(app)).content[1]).toEqual(
    expect.objectContaining({
      type: "table",
      content: [
        { type: "tableRow", content: [cell("tableHeader", "Name"), cell("tableHeader", "Role")] },
        { type: "tableRow", content: [cell("tableCell", "Ada"), cell("tableCell", "Engineer")] },
        { type: "tableRow", content: [cell("tableCell", "Lin"), cell("tableCell", "Designer")] },
      ],
    }),
  );
  await page.reload();
  await expect(table.getByRole("row", { name: "Ada Engineer" })).toBeVisible();
});

/** The bar over a description Jira refused, which asks which version to keep. */
const conflictBar = (page: Page) =>
  page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Use Jira's version" }) });

/** The user edits a description someone has since changed in Jira; Jira refuses the save and the editor asks. */
const conflict = async (page: Page, app: Parameters<Parameters<typeof test>[2]>[0]["app"]) => {
  await app.seed({ writable: true });
  await app.changeInJira({ key: "TEST-2", description: "Original words" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  await expect(descriptionOf(page)).toHaveText("Original words");
  await app.changeInJira({ key: "TEST-2", description: "Changed in Jira", unseen: true });

  await caretAfter(page, "Original words");
  await page.keyboard.type(" and mine");

  await expect(conflictBar(page)).toContainText("Someone changed this description in Jira", { timeout: 10_000 });
  expect(plain(await jiraDescription(app))).toBe("Changed in Jira");
};

test("36. after someone changed the description in Jira, Use Jira's version shows and keeps Jira's text", async ({ page, app }) => {
  await conflict(page, app);
  const description = descriptionOf(page);

  await conflictBar(page).getByRole("button", { name: "Use Jira's version" }).click();

  await expect(conflictBar(page)).toHaveCount(0);
  await expect(description).toHaveText("Changed in Jira");
  expect(plain(await jiraDescription(app))).toBe("Changed in Jira");
  await page.reload();
  await expect(description).toHaveText("Changed in Jira");
  await expect(conflictBar(page)).toHaveCount(0);
  expect(plain(await jiraDescription(app))).toBe("Changed in Jira");
});

test("36. after someone changed the description in Jira, Keep mine saves the user's text to Jira", async ({ page, app }) => {
  await conflict(page, app);
  const description = descriptionOf(page);

  await conflictBar(page).getByRole("button", { name: "Keep mine" }).click();

  await expect(conflictBar(page)).toHaveCount(0);
  await expect.poll(async () => plain(await jiraDescription(app))).toBe("Original words and mine");
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  await page.reload();
  await expect(description).toHaveText("Original words and mine");
  expect(plain(await jiraDescription(app))).toBe("Original words and mine");
});

test("36. after Keep mine has saved, a reload doesn't bring the conflict bar back", async ({ page, app }) => {
  await conflict(page, app);

  await conflictBar(page).getByRole("button", { name: "Keep mine" }).click();
  await expect.poll(async () => plain(await jiraDescription(app))).toBe("Original words and mine");
  await expect(page.getByRole("status", { name: "Jira save status" })).toHaveText("Saved to Jira");
  await page.reload();

  await expect(descriptionOf(page)).toHaveText("Original words and mine");
  await expect(conflictBar(page)).toHaveCount(0);
});

test("37. restoring an earlier version from description history puts it back in Jira", async ({ page, app }) => {
  await app.seed({
    writable: true,
    history: {
      "TEST-2": [
        {
          id: "edit-1",
          at: "2026-11-10T09:00:00Z",
          actor: { id: "priya", name: "Priya" },
          items: [{ field: "description", from: null, fromText: "Draft words", to: null, toText: "First words" }],
        },
      ],
    },
  });
  await app.changeInJira({ key: "TEST-2", description: "First words" });
  await openIssue(page, "TEST-2", "Browser fixture 2");
  const description = descriptionOf(page);
  await caretAfter(page, "First words");
  await page.keyboard.type(" then a mistake");
  await expect.poll(async () => plain(await jiraDescription(app))).toBe("First words then a mistake");

  await page.getByRole("button", { name: "updated the description" }).click();
  const history = page.getByRole("dialog", { name: "Issue description" });
  await history.getByRole("navigation", { name: "Versions" }).getByRole("button", { name: /Saved in this app/ }).click();
  await expect(history.getByLabel("Description version")).toHaveText("First words");
  await history.getByRole("button", { name: "Restore version" }).click();

  await expect(history).toHaveCount(0);
  await expect(page.getByText("Content has been restored.")).toBeVisible();
  await expect(description).toHaveText("First words");
  await expect.poll(async () => plain(await jiraDescription(app))).toBe("First words");
  await page.reload();
  await expect(description).toHaveText("First words");
});

test("37. Issue options › Show description history opens the history", async ({ page, app }) => {
  await app.seed({ writable: true });
  await openIssue(page, "TEST-2", "Browser fixture 2");

  await page.getByRole("button", { name: "Issue options" }).click();
  await page.getByRole("menuitem", { name: "Show description history" }).click();

  await expect(page.getByRole("dialog", { name: "Issue description" })).toBeVisible();
});
