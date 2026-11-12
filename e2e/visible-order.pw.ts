import { expect, test } from "./app";
import { defaultPreferences } from "../src/shared/view-model";

const position = `document.querySelector('[aria-label="Issue position"]')?.textContent`;

test("the open issue's position counts the view's temporary filters as soon as one is added", async ({
  open,
}) => {
  const page = await open();
  try {
    const prefs = defaultPreferences();
    const draft = {board:1,kind:"custom",name:"Stepper view",description:"",icon:"filter",color:"gray",filters:prefs.filters,display:prefs.display,scope:prefs.scope,mine:false};
    const saved = await page.eval<{ id: string }>(
      `fetch('/api/views', {method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(draft))}}).then(r=>r.json())`,
    );
    await page.goto(`/view/${saved.id}?board=1`);
    await page.waitFor(`location.pathname.startsWith("/view/stepper-view-")`);
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`${position}==="1 / 6"`);
    // A temporary filter on the saved view: Priority is Normal keeps TEST-1 and TEST-5.
    await page.click('[aria-label="Add filter"]');
    await page.hover('[cmdk-item][data-value="Priority"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Filter Priority"]')`);
    await page.hover('[aria-label="Filter Priority"]');
    await page.click('[aria-label="Priority filter"] [cmdk-item][data-value="Normal Normal"]');
    await page.waitFor(`document.querySelectorAll('[data-key]').length===2`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Priority filter"]')`);
    expect(await page.eval(`new URL(location.href).searchParams.get('issue')`)).toBe("TEST-1");
    await page.waitFor(`${position}==="1 / 2"`);
  } finally {
    await page.close();
  }
});
