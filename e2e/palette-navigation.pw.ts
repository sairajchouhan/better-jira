import { expect, test } from "./app";

/** Package P (palette, search, navigation): Linear's nested "Open …" pages, recents and search. */
const dialog = (label: string) => `document.querySelector('[role=dialog][aria-label="${label}"]')`;
const rows = `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.textContent)`;
const input = `document.querySelector('[cmdk-input]')`;

test("BJ-165: O F / O T / O V open the ⌘K palette frame on their page; Help falls back to the palette; picker inputs are named", async ({ open }) => {
  const p = await open();
  await test.step("O T is the palette, its chip names the page, ⌫ leaves it for the root", async () => {
    await p.keys("ot");
    await p.waitFor(`!!${dialog("Open team")}&&!!${input}`);
    expect(await p.eval(`${dialog("Open team")}.textContent`)).toContain("Team");
    expect(await p.eval<string[]>(rows)).toContain("Browser audit");
    await p.key("Backspace");
    await p.waitFor(`${input}?.placeholder==='Search issues or type a command…'`);
    await p.key("Escape");
    await p.waitFor(`!${input}`);
  });
  await test.step("O V and O F open their pages", async () => {
    await p.keys("ov");
    await p.waitFor(`!!${dialog("Open view")}&&!!${input}`);
    await p.key("Escape");
    await p.keys("of");
    await p.waitFor(`!!${dialog("Open favorite")}&&!!${input}`);
    await p.key("Escape");
    await p.waitFor(`!${input}`);
  });
  await test.step("with the sidebar hidden, ? opens Help in the palette frame", async () => {
    await p.key("[");
    await p.waitFor(`!document.getElementById('help-menu')`);
    await p.key("?", "shift");
    await p.waitFor(`!!${dialog("Help")}&&!!${input}`);
    expect(await p.eval<string[]>(rows)).toEqual([expect.stringContaining("Keyboard shortcuts")]);
    await p.key("Enter");
    await p.waitFor(`!!${dialog("Keyboard Shortcuts")}`);
    await p.key("Escape");
    await p.key("[");
  });
  await test.step("a property picker's search input has an accessible name", async () => {
    await p.click('[data-key="TEST-1"]');
    await p.key("Escape");
    await p.key("p");
    await p.waitFor(`!!${input}`);
    expect(await p.eval(`${input}.getAttribute('aria-label')`)).toBeTruthy();
  });
});

const heading = (name: string) =>
  `[...document.querySelectorAll('[cmdk-group]')].find(g=>g.querySelector('[cmdk-group-heading]')?.textContent===${JSON.stringify(name)})`;
const groupRows = (name: string) => `[...(${heading(name)}?.querySelectorAll('[cmdk-item]')??[])].map(n=>n.textContent)`;

test("BJ-35: search and O I list recently opened issues and recent searches", async ({ open }) => {
  const p = await open();
  for (const key of ["TEST-2", "TEST-3"]) {
    await p.click(`[data-key="${key}"]`);
    await p.waitFor(`new URLSearchParams(location.search).get('issue')==='${key}'`);
  }
  await p.key("Escape");
  await p.waitFor(`!new URLSearchParams(location.search).get('issue')`);
  await p.key("/");
  await p.waitFor(`${groupRows("Recent")}.length===2`);
  expect((await p.eval<string[]>(groupRows("Recent"))).map((t) => t.slice(0, 6))).toEqual(["TEST-3", "TEST-2"]);
  await p.type("fixture 4");
  await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent.includes('TEST-4')`);
  await p.key("Enter");
  await p.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-4'`);
  await p.key("Escape");
  await p.keys("oi");
  await p.waitFor(`!!document.querySelector('[role=dialog][aria-label="Open issue"]')&&${groupRows("Recent searches")}.length===1`);
  expect((await p.eval<string[]>(groupRows("Recent")))[0]).toContain("TEST-4");
  await p.click(`[cmdk-item][data-value="search:fixture 4"]`);
  expect(await p.eval(`document.querySelector('[cmdk-input]').value`)).toBe("fixture 4");
});

test("BJ-46: ⌘K opens the last viewed issue", async ({ open }) => {
  const p = await open();
  await p.key("k", "meta");
  await p.type("last viewed");
  expect(await p.eval<string[]>(rows)).not.toContain("Open last viewed issue");
  await p.key("Escape");
  for (const key of ["TEST-2", "TEST-3"]) {
    await p.click(`[data-key="${key}"]`);
    await p.waitFor(`new URLSearchParams(location.search).get('issue')==='${key}'`);
  }
  await p.key("Escape");
  await p.key("k", "meta");
  await p.type("last viewed");
  await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent==='Open last viewed issue'`);
  await p.key("Enter");
  await p.waitFor(`new URLSearchParams(location.search).get('issue')==='TEST-2'`);
});

test("BJ-64: a keyword and a space in ⌘K focuses search on that entity type", async ({ open }) => {
  const p = await open();
  await p.key("k", "meta");
  await p.type("t ");
  await p.waitFor(`!!${dialog("Open team")}&&${input}?.value===''`);
  expect(await p.eval<string[]>(rows)).toContain("Browser audit");
  await p.key("Backspace");
  await p.type("i ");
  await p.waitFor(`!!${dialog("Open issue")}`);
  await p.type("fixture 4");
  await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent.includes('TEST-4')`);
});

test("BJ-65: search and O D find a document by its body text and open it", async ({ open }) => {
  const p = await open("?issue=TEST-2&view=page");
  await p.waitFor(`!!document.getElementById('comment')`);
  await p.click("#issue-options");
  await p.click("text=Add document…");
  await p.waitFor(`document.activeElement?.getAttribute('aria-label')==='Document title'`);
  await p.type("Rollout plan");
  await p.click("#resource-document");
  await p.type("Ship the zebra build first");
  await p.waitFor(`document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`);
  await p.key("Escape");
  await p.key("Escape");
  await p.waitFor(`!new URLSearchParams(location.search).get('document')`);
  await p.key("/");
  await p.type("zebra");
  await p.waitFor(`${groupRows("Documents")}.length===1`);
  expect((await p.eval<string[]>(groupRows("Documents")))[0]).toContain("Rollout plan");
  await p.key("Escape");
  await p.keys("od");
  await p.waitFor(`!!${dialog("Open document")}&&${groupRows("Documents")}.length===1`);
  await p.key("Enter");
  await p.waitFor(`!!new URLSearchParams(location.search).get('document')`);
});

test("BJ-80: G U goes to the views page", async ({ open }) => {
  const p = await open();
  await p.keys("gu");
  await p.waitFor(`location.pathname==='/views'`);
});

test("BJ-63: search remembers its chosen ordering", async ({ open }) => {
  const p = await open();
  await p.key("/");
  await p.click('[aria-label="Ordering: Most relevant"]');
  await p.click("text=Last updated");
  await p.waitFor(`!!document.querySelector('[aria-label="Ordering: Last updated"]')`);
  await p.type("fixture");
  await p.waitFor(`${groupRows("Issues (6)")}.length===6`);
  await p.key("Escape");
  await p.waitFor(`!${input}`);
  await p.key("/");
  await p.waitFor(`!!document.querySelector('[aria-label="Ordering: Last updated"]')`);
});

const tab = (name: string) => `[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent===${JSON.stringify(name)})`;

test("BJ-28: My issues has Assigned, Created, Subscribed and Activity tabs, each with its own address", async ({ open }) => {
  const p = await open();
  await p.keys("gm");
  await p.waitFor(`location.pathname==='/my-issues'&&${tab("Assigned")}?.getAttribute('aria-pressed')==='true'`);
  expect(await p.eval(`!!${tab("Active")}`)).toBe(false);
  await p.eval(`${tab("Activity")}.click()`);
  await p.waitFor(`location.pathname==='/my-issues/activity'`);
  await p.eval(`location.assign("/my-issues/subscribed")`);
  await p.waitFor(`document.readyState==="complete"&&location.pathname==="/my-issues/subscribed"`);
  await p.waitFor(`${tab("Subscribed")}?.getAttribute('aria-pressed')==='true'`);
});
