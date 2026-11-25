import { expect, test } from "./app";

test("the board shows each issue in its status column, and a card opens that issue", async ({ page, app }) => {
  await app.seed();
  const todo = page.getByRole("grid", { name: "Todo" });
  const doing = page.getByRole("grid", { name: "Doing" });

  for (const name of [
    "TEST-1 Rich browser fixture",
    "TEST-2 Browser fixture 2",
    "TEST-4 Browser fixture 4",
    "TEST-5 Browser fixture 5",
    "TEST-6 Browser fixture 6",
  ]) {
    await expect(todo.getByRole("row", { name, exact: true })).toBeVisible();
    await expect(doing.getByRole("row", { name, exact: true })).toHaveCount(0);
  }
  await expect(doing.getByRole("row", { name: "TEST-3 Browser fixture 3", exact: true })).toBeVisible();
  await expect(todo.getByRole("row", { name: "TEST-3 Browser fixture 3", exact: true })).toHaveCount(0);

  await todo
    .getByRole("row", { name: "TEST-4 Browser fixture 4", exact: true })
    .getByText("Browser fixture 4", { exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Issue title" })).toHaveValue("Browser fixture 4");
});
