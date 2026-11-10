import { expect, test } from "./app";

test("board loads fixture issues and j selects the first card", async ({ open }) => {
  const page = await open();
  expect(await page.eval(`document.querySelectorAll("[data-key]").length`)).toBeGreaterThan(3);
  await page.key("j");
  await page.waitFor(`!!document.querySelector("[data-key][data-selected=true]")`);
});
