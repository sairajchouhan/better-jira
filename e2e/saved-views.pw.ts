import { expect, test, PREFS_KEY } from "./app";

test("saved view has a stable route, survives reload and leaves board preferences unchanged", async ({
  open,
}) => {
  const page = await open();
  try {
    const before = await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`);
    await page.click('[aria-label="Save current view"]');
    await page.click('[aria-label="View name"]');
    await page.type("Stable view");
    await page.click("text=Create view");
    await page.waitFor(`location.pathname.startsWith('/view/')`);
    const path = await page.eval("location.pathname");
    expect(await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)).toBe(before);
    await page.reload();
    expect(await page.eval("location.pathname")).toBe(path);
    expect(await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)).toBe(before);
    const overlay = {
      id: "temporary",
      join: "and",
      children: [{ id: "priority", field: "priority", op: "is", values: ["High"] }],
    };
    const encoded = Buffer.from(JSON.stringify({ v: 1, filters: overlay })).toString(
      "base64url",
    );
    await page.goto(`${path}?filter=${encoded}`);
    await page.waitFor(`document.body.textContent.includes("Priority is High")`);
    await page.reload();
    expect(await page.eval("new URL(location.href).searchParams.get('filter')")).toBe(encoded);
    expect(await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)).toBe(before);
    await page.click("text=Clear");
    await page.waitFor(`!new URL(location.href).searchParams.has('filter')`);
    await page.page.goBack();
    await page.waitFor(`new URL(location.href).searchParams.has('filter')`);
    await page.page.goForward();
    await page.waitFor(`!new URL(location.href).searchParams.has('filter')`);
    await page.click("text=Stable view");
    expect(await page.eval("location.pathname")).toBe(path);
  } finally {
    await page.close();
  }
});
