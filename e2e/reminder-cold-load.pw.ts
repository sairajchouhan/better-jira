import { expect, test } from "./app";

test("document reminder presets are available while the lazy date parser is blocked", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor("!!document.getElementById('comment')");
  await page.click("#issue-options");
  await page.click("text=Add document…");
  await page.waitFor("document.activeElement?.getAttribute('aria-label')==='Document title'");
  await page.type("Cold reminder");
  await page.waitFor("!!document.getElementById('resource-document')");
  await page.eval("document.activeElement?.blur()");
  // The custom step must also remain independent of a parser that never loads.
  await page.page.route("**/*typed-time*.js", (route) => route.abort());
  await page.key("h", "shift");
  const menu = page.page.getByRole("dialog", { name: "Remind me", exact: true });
  await expect(menu.getByRole("menuitem", { name: "An hour from now" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Custom…" }).click();
  await expect(page.page.getByLabel("Custom reminder time")).toBeVisible();
  await page.page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(menu.getByRole("menuitem", { name: "Tomorrow" })).toBeVisible();
});
