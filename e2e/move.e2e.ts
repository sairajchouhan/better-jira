import { expect, test } from "./app";

test("dragging a card to another column moves the issue there and transitions it in Jira", async ({ page, app }) => {
  await app.seed({ writable: true });
  const todo = page.getByRole("grid", { name: "Todo" });
  const doing = page.getByRole("grid", { name: "Doing" });
  const moving = { name: "TEST-2 Browser fixture 2", exact: true };

  await todo
    .getByRole("row", moving)
    .getByText("Browser fixture 2", { exact: true })
    .dragTo(doing.getByRole("row", { name: "TEST-3 Browser fixture 3", exact: true }));

  await expect(doing.getByRole("row", moving)).toBeVisible();
  await expect(todo.getByRole("row", moving)).toHaveCount(0);
  await expect
    .poll(app.jiraWrites)
    .toContainEqual({ key: "TEST-2", ops: expect.arrayContaining([{ op: "status", status: "doing" }]) });

  await page.reload();
  await expect(doing.getByRole("row", moving)).toBeVisible();
  await expect(todo.getByRole("row", moving)).toHaveCount(0);
});
