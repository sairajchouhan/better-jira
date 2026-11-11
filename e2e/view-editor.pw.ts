import { test, expect, PREFS_KEY } from "./app";
test("draft reload, cancel, create toast, edit, duplicate and themed delete", async ({
  open,
}) => {
  const app = await open(),
    p = app.page;
  try {
    const before = await app.eval(
      `localStorage.getItem(${JSON.stringify(PREFS_KEY)})`,
    );
    await p
      .getByRole("button", { name: "Save current view", exact: true })
      .click();
    await expect(p).toHaveURL(/\/view\/new/);
    await p
      .getByRole("textbox", { name: "View name", exact: true })
      .fill("Draft survives reload");
    await p.reload();
    await expect(
      p.getByRole("textbox", { name: "View name", exact: true }),
    ).toHaveValue("Draft survives reload");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await app.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`),
    ).toBe(before);
    await p
      .getByRole("button", { name: "Save current view", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "View name", exact: true })
      .fill("My new view");
    await p.getByRole("button", { name: "Create view", exact: true }).click();
    await expect(
      p.getByRole("status").filter({ hasText: "View created" }),
    ).toContainText("My new view");
    const route = new URL(p.url()).pathname;
    await p
      .getByRole("button", { name: "View options for My new view" })
      .click();
    await p.getByRole("option", { name: "Edit…", exact: true }).click();
    await expect(p).toHaveURL(new RegExp(`${route}/edit`));
    await p
      .getByRole("textbox", { name: "View name", exact: true })
      .fill("Renamed");
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await p.getByRole("button", { name: "View options for Renamed" }).click();
    await p.getByRole("option", { name: "Duplicate…", exact: true }).click();
    await expect(
      p.getByRole("textbox", { name: "View name", exact: true }),
    ).toHaveValue("");
    await expect(
      p.getByRole("textbox", { name: "View description" }),
    ).toHaveValue("");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await p.getByRole("button", { name: "View options for Renamed" }).click();
    await p.getByPlaceholder("Search actions…").fill("Delete");
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter");
    await expect(p.getByRole("dialog")).toContainText("Renamed");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "View options for Renamed" }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});

test("draft filters, display and icon stay detached through reload and cancel", async ({
  open,
}) => {
  const app = await open(),
    p = app.page;
  try {
    const before = await app.eval(
      `localStorage.getItem(${JSON.stringify(PREFS_KEY)})`,
    );
    await p
      .getByRole("button", { name: "Save current view", exact: true })
      .click();
    await p.getByRole("button", { name: "Choose view icon and color" }).click();
    await p.getByRole("button", { name: "Purple", exact: true }).click();
    await p.getByRole("button", { name: "Emojis", exact: true }).click();
    await p.getByPlaceholder("Search icons…").fill("rocket");
    await p.getByRole("option").filter({ hasText: "🚀" }).click();
    await expect(
      p.getByRole("button", { name: "Choose view icon and color" }),
    ).toContainText("🚀");
    await p.getByRole("button", { name: "Add filter", exact: true }).click();
    await app.hover("text=Dates");
    await app.waitFor(
      `!!document.querySelector('[aria-label="Filter Dates"]')`,
    );
    await app.hover("text=Due date");
    await app.click("text=Overdue");
    await p
      .getByRole("button", { name: "Display options", exact: true })
      .click();
    await p.getByRole("tab", { name: "List", exact: true }).click();
    await p.keyboard.press("Escape");
    await p.reload();
    await expect(p.locator("[data-layout=list]")).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Choose view icon and color" }),
    ).toContainText("🚀");
    expect(
      await app.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`),
    ).toBe(before);
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(
      await app.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`),
    ).toBe(before);
    await p.goBack();
    await expect(
      p.getByRole("textbox", { name: "View name", exact: true }),
    ).toBeVisible();
    await p.goForward();
    await expect(
      p.getByRole("textbox", { name: "View name", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
  }
});
