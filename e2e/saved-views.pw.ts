import { expect, test, PREFS_KEY } from "./app";
import { defaultPreferences } from "../src/shared/view-model";

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
    // BJ-137: an old /view/<id> link lands on the slugged address.
    const path = `/view/stable-view-${saved.id}`;
    await page.waitFor(`location.pathname === ${JSON.stringify(path)}`);
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

// Linear keeps a view's hidden columns in its view preferences (IssueList ht: getPreference(`hiddenColumns`),
// setAndSavePreference), and an empty column stays shown only through Show empty columns (`showEmptyGroups`).
test("a saved view keeps its hidden columns, and Show empty columns keeps an empty column shown", async ({
  open,
}) => {
  const page = await open();
  try {
    const before = await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`);
    const prefs = defaultPreferences();
    const draft = {board:1,kind:"tab",name:"Columns tab",description:"",icon:"filter",color:"gray",filters:prefs.filters,display:prefs.display,scope:"all",mine:false};
    const saved = await page.eval<{ id: string }>(`fetch('/api/views', {method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(draft))}}).then(r=>r.json())`);
    await page.goto(`/view/${saved.id}?board=1`);
    const aside = 'aside[aria-label="Hidden columns"]';
    const hiddenNames = `[...document.querySelectorAll('${aside} [aria-label^="Show "]')].map(b=>b.getAttribute("aria-label").slice(5))`;
    const column = (name: string) => `!!document.querySelector('[aria-label="Options for ${name}"]')`;
    const viewHidden = () =>
      page.eval<string[]>(`fetch('/api/views').then(r=>r.json()).then(vs=>vs.find(v=>v.id===${JSON.stringify(saved.id)}).hidden.status ?? [])`);
    // Empty columns start in Hidden columns, as Linear hides them without Show empty columns.
    await page.waitFor(`!!document.querySelector('${aside}')`);
    const [empty] = await page.eval<string[]>(hiddenNames);
    expect(empty).toBeTruthy();
    expect(await page.eval(column(empty!))).toBe(false);

    await test.step("Hide column on a column with issues keeps it hidden in this view across a reload", async () => {
      await page.click('[aria-label="Options for Todo"]');
      await page.click("text=Hide column");
      await page.waitFor(`${hiddenNames}.includes("Todo")`);
      expect(await viewHidden()).toEqual(["Todo"]);
      await page.reload();
      await page.waitFor(`${hiddenNames}.includes("Todo")`);
      expect(await page.eval(column("Todo"))).toBe(false);
      // The board's own settings are untouched.
      expect(await page.eval(`localStorage.getItem(${JSON.stringify(PREFS_KEY)})`)).toBe(before);
    });

    await test.step("Show empty columns shows the empty column; hiding it keeps it hidden even so", async () => {
      await page.click('[aria-label="Display options"]');
      await page.click('[role="switch"][aria-label="Show empty columns"]');
      await page.key("Escape");
      await page.waitFor(column(empty!));
      expect(await page.eval(hiddenNames)).toEqual(["Todo"]);
      await page.click(`[aria-label="Options for ${empty}"]`);
      await page.click("text=Hide column");
      await page.waitFor(`${hiddenNames}.includes(${JSON.stringify(empty)})`);
      await page.reload();
      await page.waitFor(`${hiddenNames}.includes(${JSON.stringify(empty)})`);
      expect(await page.eval(column(empty!))).toBe(false);
    });

    await test.step("Show from Hidden columns brings it back, and it stays shown while empty", async () => {
      await page.click(`${aside} [aria-label="Show ${empty}"]`);
      await page.waitFor(column(empty!));
      expect(await viewHidden()).toEqual(["Todo"]);
      await page.reload();
      await page.waitFor(column(empty!));
      expect(await page.eval(hiddenNames)).toEqual(["Todo"]);
    });
  } finally {
    await page.close();
  }
});
