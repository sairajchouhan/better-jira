import { test, expect } from "./app";

test("BJ-110 keeps the document visible while its first editor chunk loads", async ({ open }) => {
  const app = await open();
  const initial = await app.page.evaluate(() => performance.getEntriesByType("resource").filter((r: any) => r.initiatorType === "script").map(r => r.name));
  for (const url of initial) {
    const code = await (await app.page.request.get(url)).text();
    expect(code).not.toContain("ProseMirror");
    expect(code).not.toContain("ENTimeExpressionParser");
  }
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let editorRequested = false;
  await app.page.route("**/*.js", async route => {
    const response = await route.fetch();
    if ((await response.text()).includes("ProseMirror")) {
      editorRequested = true;
      await gate;
    }
    await route.fulfill({ response });
  });
  await app.click("[data-key=TEST-1]");
  try {
    await expect(app.page.locator('[aria-busy="true"].rich-content')).toBeVisible();
    expect(editorRequested).toBe(true);
  } finally { release(); }
  await expect(app.page.locator(".ProseMirror").first()).toBeVisible();
});
