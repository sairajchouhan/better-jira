import { expect, fixture, test } from "./app";

const nav = 'nav[aria-label="Main navigation"]';
const active = `${nav} [aria-current="true"]`;

test("My issues is one active destination, including repeat clicks and opening the same board", async ({ open }) => {
  const app = await open("?board=1");
  const mine = app.page.locator(nav).getByRole("link", { name: /^My issues/ });
  await mine.click();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(app.page.locator(active)).toContainText("My issues");
  await mine.click();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await app.page.locator(nav).getByRole("link", { name: "Browser audit", exact: false }).click();
  await expect(app.page).toHaveURL(`${fixture.url}team/1/all`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(mine).not.toHaveAttribute("aria-current");
  await app.page.goBack();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(app.page.locator(active)).toContainText("My issues");
  await app.page.goBack();
  await expect(app.page).toHaveURL(`${fixture.url}team/1/all`);
});

test("another board then Back restores My issues without creating a board-plus-mine entry", async ({ open }) => {
  await fixture.reset({ bulk: 10 });
  const app = await open("?board=1");
  const mine = app.page.locator(nav).getByRole("link", { name: /^My issues/ });
  await mine.click();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator('[data-key="BULK-1"]:visible')).toHaveCount(1);
  await expect(app.page.locator('[data-key="TWO-1"]:visible')).toHaveCount(1);
  await app.page.locator(nav).getByRole("link", { name: /Second board/ }).click();
  await expect(app.page).toHaveURL(`${fixture.url}team/2/all`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(mine).not.toHaveAttribute("aria-current");
  await app.page.goBack();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(app.page.locator(active)).toContainText("My issues");
  await app.page.goForward();
  await expect(app.page).toHaveURL(`${fixture.url}team/2/all`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(app.page.locator(active)).toContainText("Second board");
});

test("legacy board-and-mine links reload into the standalone destination", async ({ open }) => {
  const app = await open("?board=1");
  await app.page.goto(`${fixture.url}?board=1&mine=1`);
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator(active)).toHaveCount(1);
  await expect(app.page.locator(active)).toContainText("My issues");
  await app.page.reload();
  await expect(app.page).toHaveURL(`${fixture.url}my-issues`);
  await expect(app.page.locator(active)).toHaveCount(1);
});
