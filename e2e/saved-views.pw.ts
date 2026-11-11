import { expect, test, PREFS_KEY } from "./app";
import { defaultPreferences } from "../src/view-model";

test("saved view has a stable route, survives reload and leaves board preferences unchanged", async ({
  open,
}) => {
  const page = await open();
  try {
    const before = await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`);
    const prefs = defaultPreferences();
    const draft = {board:1,kind:"custom",name:"Stable view",description:"",icon:"filter",color:"gray",filters:prefs.filters,display:prefs.display,scope:prefs.scope,mine:false};
    const saved = await page.eval(`fetch('/api/views', {method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(draft))}}).then(r=>r.json())`);
    await page.goto(`/view/${saved.id}?board=1`);
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
    await page.waitFor(`document.querySelector(".view-filter-chip")?.textContent==="PriorityisHigh"`);
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
