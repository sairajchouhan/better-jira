import { expect, test } from "./app";

test("renaming an issue in its detail shows the new title on the board and saves it to Jira", async ({ page, app }) => {
  await app.seed({ writable: true, jiraEdits: true });
  const todo = page.getByRole("grid", { name: "Todo" });
  const title = page.getByRole("textbox", { name: "Issue title" });

  await todo
    .getByRole("row", { name: "TEST-2 Browser fixture 2", exact: true })
    .getByText("Browser fixture 2", { exact: true })
    .click();
  await title.fill("Renamed fixture issue");
  await title.press("Tab");

  const renamed = todo.getByRole("row", { name: "TEST-2 Renamed fixture issue", exact: true });
  await expect(renamed).toBeVisible();
  await expect
    .poll(app.jiraWrites)
    .toContainEqual({
      key: "TEST-2",
      ops: expect.arrayContaining([
        { op: "fields", fields: expect.objectContaining({ summary: "Renamed fixture issue" }) },
      ]),
    });

  await page.reload();
  await expect(renamed).toBeVisible();
  await expect(title).toHaveValue("Renamed fixture issue");
});
