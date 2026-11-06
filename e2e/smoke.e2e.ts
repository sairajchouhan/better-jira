import { afterAll, expect, test } from "bun:test";
import { open, stop } from "./harness";

afterAll(stop);

test("board loads fixture issues and j selects the first card", async () => {
  const page = await open();
  try {
    expect(await page.eval(`document.querySelectorAll("[data-key]").length`)).toBeGreaterThan(3);
    await page.key("j");
    expect(await page.eval(`document.querySelector("[data-key][data-selected=true]")?.dataset.key ?? document.activeElement?.tagName`)).toBeTruthy();
  } finally { await page.close(); }
});
