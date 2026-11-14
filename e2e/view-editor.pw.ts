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
    await p.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "New view", exact: true }).click();
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
    await p.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "New view", exact: true }).click();
    await expect(p.getByText("Personal", { exact: true })).toHaveCount(0); // BJ-141: custom drafts have no scope line either
    await p
      .getByRole("textbox", { name: "View name", exact: true })
      .fill("My new view");
    // BJ-151: saved live-Linear measurements; check both intrinsic widths (including the transparent border).
    const widths = await p.locator('.view-editor-heading .ui-button').evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().width));
    expect(widths[0]).toBeCloseTo(57.83, 1);
    expect(widths[1]).toBeCloseTo(86.12, 1);
    await p.getByRole("button", { name: "Create view", exact: true }).click();
    await expect(
      p.getByRole("status").filter({ hasText: "View created" }),
    ).toContainText("My new view");
    await expect(p.getByRole("button", { name: "Open view", exact: true })).toBeVisible();
    const route = new URL(p.url()).pathname;
    await app.eval(
      `Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>{window.__copied=t}}})`,
    );
    await p.getByRole("button", { name: "Issue view options" }).click();
    await p.getByRole("menuitem", { name: "Copy link", exact: true }).click();
    await expect(p.locator("[data-toast]").filter({ hasText: /^View link copied to clipboard$/ })).toBeVisible(); // BJ-145
    expect(await app.eval("window.__copied")).toBe(new URL(route, p.url()).href);
    await p
      .getByRole("button", { name: "Issue view options" })
      .click();
    await p.getByRole("menuitem", { name: "Edit…", exact: true }).click();
    await expect(p).toHaveURL(new RegExp(`${route}/edit`));
    await p
      .getByRole("textbox", { name: "View name", exact: true })
      .fill("Renamed");
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await p.getByRole("button", { name: "Issue view options" }).click();
    await p.getByRole("menuitem", { name: "Duplicate…", exact: true }).click();
    await expect(
      p.getByRole("textbox", { name: "View name", exact: true }),
    ).toHaveValue("");
    await expect(
      p.getByRole("textbox", { name: "View description" }),
    ).toHaveValue("");
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    // Every saved view is listed inline in the sidebar's Views section, like boards.
    await p.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Renamed", exact: true }).click();
    await p.getByRole("button", { name: "Issue view options" }).click();
    await p.keyboard.type("Delete"); // Linear's menus filter as you type; the search field stays hidden until then
    await expect(p.getByRole("combobox", { name: "Find view options" })).toHaveValue("Delete");
    await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter");
    await expect(p.getByRole("dialog")).toHaveText('Delete the view "Renamed"?CancelDelete');
    await p.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Issue view options" }),
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
    await p.getByRole("button", { name: "Add new view", exact: true }).click();
    await expect(p.getByText("Personal", { exact: true })).toHaveCount(0); // tab drafts have no scope line
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
    await expect(p.locator(".ui-filter-bar")).toBeVisible();
    await expect(p.locator(".ui-filter-actions")).toBeHidden(); // editor Cancel/Save are the only save controls
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
