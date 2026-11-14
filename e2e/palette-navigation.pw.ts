import { expect, fixture, test, shownDocument, shownIssue } from "./app";

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
    await p.waitFor(`${input}?.placeholder==='Type a command or search…'`);
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

test("6.1: ⌘K is Linear's command menu: no backdrop, one frame, icons on every command, Linear's group order", async ({ open }) => {
  const p = await open();
  const palette = dialog("Search issues and commands");
  const headings = `[...document.querySelectorAll('[cmdk-group-heading]')].map(n=>n.textContent)`;
  await test.step("unscoped: centred 720px at 110px, nothing dimmed, a single rounded frame", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("k", "meta");
    await p.waitFor(`!!${palette}&&!!${input}`);
    expect(await p.eval(`${input}.placeholder`)).toBe("Type a command or search…");
    expect(await p.eval(`getComputedStyle(${palette}.parentElement).backgroundColor`)).toBe("rgba(0, 0, 0, 0)");
    expect(await p.eval(`(({width,top})=>[Math.round(width),Math.round(top)])(${palette}.getBoundingClientRect())`)).toEqual([720, 110]);
    // One frame: nothing inside the dialog draws a second rounded, bordered or shadowed box around the menu.
    expect(
      await p.eval(
        `[...${palette}.querySelectorAll('*')].filter(n=>{const s=getComputedStyle(n);return s.boxShadow!=='none'||parseFloat(s.borderRadius)>=12}).length`,
      ),
    ).toBe(0);
    expect(await p.eval(`[...${palette}.querySelectorAll('[cmdk-item]')].filter(n=>!n.querySelector('.menu-icon svg')).map(n=>n.textContent)`)).toEqual([]);
    // A row's shortcut sits at the menu's right edge, 20px in.
    expect(
      await p.eval(
        `(()=>{const row=${palette}.querySelector('[cmdk-item] .menu-hint').closest('[cmdk-item]');return Math.round(row.getBoundingClientRect().right-row.querySelector('.menu-hint').getBoundingClientRect().right)})()`,
      ),
    ).toBe(20);
    const shown = await p.eval<string[]>(headings);
    const linear = ["Notifications", "Issues", "Views", "Filter", "Navigation", "Display options", "Miscellaneous", "Help"];
    expect(shown).toEqual(linear.filter((h) => shown.includes(h)));
    expect(shown.slice(0, 2)).toEqual(["Issues", "Views"]);
    expect(shown.at(-1)).toBe("Help");
    await p.key("Escape");
    await p.waitFor(`!${palette}`);
  });
  await test.step("scoped: the selected issue is the title chip and its commands lead, under no heading", async () => {
    await p.key("j");
    await p.key("k", "meta");
    await p.waitFor(`!!${palette}?.querySelector('.command-menu-title')`);
    expect(await p.eval(`${palette}.querySelector('.command-menu-title').textContent`)).toMatch(/^TEST-\d+·/);
    expect(await p.eval(`!!${palette}.querySelector('[cmdk-group]')?.querySelector('[cmdk-group-heading]')?.textContent`)).toBe(false);
    await p.key("Backspace");
    await p.waitFor(`!${palette}.querySelector('.command-menu-title')`);
    // R3-palette-shortcuts-D3: the first remaining row takes the highlight, so Enter still runs something.
    await p.waitFor(`${palette}.querySelector('[cmdk-item]')?.getAttribute('aria-selected')==='true'`);
    await p.key("Escape");
  });
});

const heading = (name: string) =>
  `[...document.querySelectorAll('[cmdk-group]')].find(g=>g.querySelector('[cmdk-group-heading]')?.textContent===${JSON.stringify(name)})`;
const groupRows = (name: string) => `[...(${heading(name)}?.querySelectorAll('[cmdk-item]')??[])].map(n=>n.textContent)`;

test("BJ-35: search and O I list recently opened issues and recent searches", async ({ open }) => {
  const p = await open();
  for (const key of ["TEST-2", "TEST-3"]) {
    await p.click(`[data-key="${key}"]`);
    await p.waitFor(`${shownIssue}==='${key}'`);
  }
  await p.key("Escape");
  await p.waitFor(`!${shownIssue}`);
  await p.key("/");
  await p.waitFor(`${groupRows("Recent")}.length===2`);
  expect((await p.eval<string[]>(groupRows("Recent"))).map((t) => t.slice(0, 6))).toEqual(["TEST-3", "TEST-2"]);
  await p.type("fixture 4");
  await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent.includes('TEST-4')`);
  await p.key("Enter");
  await p.waitFor(`${shownIssue}==='TEST-4'`);
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
    await p.waitFor(`${shownIssue}==='${key}'`);
  }
  await p.key("Escape");
  await p.key("k", "meta");
  await p.type("last viewed");
  await p.waitFor(`document.querySelector('[cmdk-item][data-selected=true]')?.textContent==='Open last viewed issue'`);
  await p.key("Enter");
  await p.waitFor(`${shownIssue}==='TEST-2'`);
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
  await p.waitFor(`!${shownDocument}`);
  await p.key("/");
  await p.type("zebra");
  await p.waitFor(`${groupRows("Documents")}.length===1`);
  expect((await p.eval<string[]>(groupRows("Documents")))[0]).toContain("Rollout plan");
  await p.key("Escape");
  await p.keys("od");
  await p.waitFor(`!!${dialog("Open document")}&&${groupRows("Documents")}.length===1`);
  await p.key("Enter");
  await p.waitFor(`!!${shownDocument}`);
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

const cards = `[...document.querySelectorAll('main [data-key]')].map(n=>n.dataset.key)`;
const tab = (name: string) => `[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent===${JSON.stringify(name)})`;

test("BJ-77: O U opens a user's issues, with their Assigned and Created tabs", async ({ open }) => {
  const p = await open();
  await p.keys("ou");
  await p.waitFor(`!!${dialog("Open user")}`);
  await p.type("alex");
  await p.key("Enter");
  await p.waitFor(`location.pathname==='/profiles/alex'`);
  await p.waitFor(`${cards}.join()==='TEST-2'`);
  await p.waitFor(`!!document.querySelector('nav[aria-label=Breadcrumb] [aria-label="Alex"]')`);
  await p.eval(`${tab("Created")}.click()`);
  await p.waitFor(`location.pathname==='/profiles/alex/created'&&${cards}.length===0`);
});

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

const clickItem = (scope: string, text: string) =>
  `[...document.querySelectorAll('${scope} [cmdk-item]')].find(n=>n.textContent.trim()===${JSON.stringify(text)})?.click()`;

test("BJ-62: Search's Filter bar narrows results by priority and the chip removes it", async ({ open }) => {
  const p = await open();
  await p.key("/");
  await p.waitFor(`!!${dialog("Search issues")}`);
  await p.click('[role=dialog][aria-label="Search issues"] button[aria-label="Filter"]');
  await p.waitFor(`!!${dialog("Filter")}`);
  await p.eval(clickItem('[role=dialog][aria-label="Filter"]', "Priority"));
  await p.waitFor(`[...document.querySelectorAll('[role=dialog][aria-label="Filter"] [cmdk-item]')].some(n=>n.textContent.trim()==='Urgent')`);
  await p.eval(clickItem('[role=dialog][aria-label="Filter"]', "Urgent"));
  await p.waitFor(`!${dialog("Filter")}&&!!${dialog("Search issues")}`);
  await p.waitFor(`${dialog("Search issues")}.textContent.includes('Priority is')`);
  const keys = `[...${dialog("Search issues")}.querySelectorAll('[cmdk-item]')].map(n=>n.textContent).join('|')`;
  await p.waitFor(`${keys}.includes('TEST-4')`);
  expect(await p.eval<string>(keys)).not.toContain("TEST-1");
  await p.click('[aria-label="Remove Priority filter"]');
  await p.waitFor(`!${dialog("Search issues")}.textContent.includes('Priority is')`);
});

test("A3, B2, B5: ⌘K lists the issue's values, finds commands by Linear's keywords, and copies the issue as a prompt", async ({ open }) => {
  const copied = `window.__copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.__copied.push(t)}}})`;
  const p = await open("", { setup: copied });
  const values = `[...document.querySelectorAll('[cmdk-item]')].map(n=>n.getAttribute('data-value'))`;
  const selectedValue = `document.querySelector('[cmdk-item][data-selected=true]')?.getAttribute('data-value')`;
  const clear = () =>
    p.eval(
      `(()=>{const i=document.querySelector('[cmdk-input]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  const scoped = async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("k", "meta");
    await p.waitFor(`!!document.querySelector('.command-menu-title')`);
  };
  await p.key("j");
  await p.waitFor(`!!document.querySelector("[data-key][data-selected=true]")`);
  const issue = await p.eval<string>(`document.querySelector("[data-key][data-selected=true]").getAttribute("data-key")`);
  const doing = `document.querySelector('[cmdk-item][data-value="cmd:status:Doing Change status › Doing"]')`;

  await test.step("A3: status and priority values hoist from 2 characters, assignee from 3, with Linear's breadcrumb", async () => {
    await scoped();
    await p.type("d");
    await p.waitFor(`!!document.querySelector('[cmdk-item]')`);
    expect(await p.eval<string[]>(values)).not.toContain("cmd:status:Doing Change status › Doing");
    await p.type("o");
    await p.waitFor(`${values}.includes('cmd:status:Doing Change status › Doing')`);
    // Linear's PCn: a status the query starts, in workflow order (Doing before Done).
    const listed = await p.eval<string[]>(values);
    expect(listed.indexOf("cmd:status:Doing Change status › Doing")).toBeLessThan(listed.indexOf("cmd:status:Done Change status › Done"));
    await clear();
    await p.type("al");
    await p.waitFor(`!!document.querySelector('[cmdk-item]')`);
    expect(await p.eval<string[]>(values)).not.toContain("cmd:assign:Alex Assign to › Alex");
    await p.type("e");
    await p.waitFor(`${values}.includes('cmd:assign:Alex Assign to › Alex')`);
    await p.key("Escape");
  });

  await test.step("A3: \"doin\" then ↵ sets the status through the undoable write", async () => {
    const before = (await fixture.log()).writes.length;
    await scoped();
    await p.type("doin");
    await p.waitFor(`${selectedValue}==='cmd:status:Doing Change status › Doing'`);
    await p.key("Enter");
    await p.waitFor(`!document.querySelector('[cmdk-input]')`);
    await expect.poll(async () => (await fixture.log()).writes.length).toBeGreaterThan(before);
    await scoped();
    await p.type("doin");
    await p.waitFor(`!!${doing}?.querySelector('.menu-checkmark')`);
    await p.key("Escape");
    await p.eval("document.activeElement?.blur()");
    await p.key("z", "meta");
    await scoped();
    await p.type("doin");
    // Undone: Doing is no longer the issue's checked status.
    await p.waitFor(`!!${doing}&&!${doing}.querySelector('.menu-checkmark')`);
    await p.key("Escape");
  });

  await test.step("B2: keywords find Undo, the sidebar toggle and Open document", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("k", "meta");
    await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
    for (const [query, name] of [
      ["revert", "Undo"],
      ["hide sidebar", "Toggle left sidebar"],
      ["goto", "Open document"],
    ] as const) {
      await clear();
      await p.type(query);
      await p.waitFor(`${values}.includes(${JSON.stringify(`cmd:${name}`)})`);
    }
    await p.key("Escape");
  });

  await test.step("B5: ⌘⌥P copies Linear's prompt with its toast; ⌘K offers the coding tools from 2 characters", async () => {
    await p.eval("document.activeElement?.blur()");
    await p.key("p", "meta", "alt");
    await p.waitFor(`window.__copied.length===1`);
    const prompt = await p.eval<string>(`window.__copied[0]`);
    expect(prompt.startsWith(`Work on Jira issue ${issue}:\n\nSuggested branch name: audit/${issue.toLowerCase()}-`)).toBe(true);
    await p.waitFor(`[...document.querySelectorAll('[data-toast]')].some(t=>t.textContent.includes('Prompt copied to clipboard'))`);
    await scoped();
    await p.type("cu");
    await p.waitFor(`${values}.includes('cmd:copy-prompt:Open in Cursor Work on issue › Open in Cursor')`);
    for (const tool of ["Claude Code desktop", "Codex desktop", "T3 Code"]) {
      await clear();
      await p.type(tool.slice(0, 4).toLowerCase());
      await p.waitFor(`${values}.includes(${JSON.stringify(`cmd:copy-prompt:Open in ${tool} Work on issue › Open in ${tool}`)})`);
    }
    await clear();
    await p.type("prompt");
    await p.waitFor(`${values}.includes('cmd:Copy as prompt')`);
    await p.key("Escape");
  });
});

test("C7: a Jira or app issue link pasted into ⌘K, or a key typed alone, offers that issue first; ↵ opens it, ⌘↵ in a new tab", async ({ open }) => {
  const p = await open();
  await p.eval(`window.open=(url)=>{window.__opened=url;return null}`);
  const first = `document.querySelector('[cmdk-item]')`;
  const opened = () => p.eval<string | null>(`(()=>{const u=window.__opened??null;window.__opened=null;return u})()`);
  const paste = async (text: string) => {
    await p.eval("document.activeElement?.blur()");
    await p.key("k", "meta");
    await p.waitFor(`!!document.querySelector('[cmdk-input]')`);
    await p.page.keyboard.insertText(text);
  };
  await test.step("a /browse/ link on this site: the issue is the first row, and ↵ opens it here", async () => {
    await paste("https://example.atlassian.net/browse/TEST-3");
    await p.waitFor(`${first}?.getAttribute('data-value')==='TEST-3'&&${first}.getAttribute('data-selected')==='true'`);
    expect(await p.eval(`[...document.querySelectorAll('[cmdk-item][data-value="TEST-3"]')].length`)).toBe(1);
    await p.key("Enter");
    await p.waitFor(`${shownIssue}==='TEST-3'`);
  });
  await test.step("a board link's selectedIssue: ⌘↵ opens the issue's page here in a new tab", async () => {
    await paste("https://example.atlassian.net/jira/software/projects/TEST/boards/1?selectedIssue=TEST-4");
    await p.waitFor(`${first}?.getAttribute('data-value')==='TEST-4'`);
    await p.key("Enter", "meta");
    expect(await opened()).toBe(`${new URL(p.page.url()).origin}/issue/TEST-4`);
    await p.waitFor(`!document.querySelector('[cmdk-input]')`);
  });
  await test.step("this app's own issue link, and a key typed alone in any case", async () => {
    await paste(`${new URL(p.page.url()).origin}/issue/TEST-2`);
    await p.waitFor(`${first}?.getAttribute('data-value')==='TEST-2'`);
    await p.key("Escape");
    await paste("test5");
    await p.waitFor(`${first}?.getAttribute('data-value')==='TEST-5'`);
    await p.key("Escape");
  });
  await test.step("an issue off every board: the server's read of it, opening Jira's page", async () => {
    await paste("https://example.atlassian.net/browse/OPS-7");
    await p.waitFor(`${first}?.getAttribute('data-value')==='jira:OPS-7'`);
    expect(await p.eval<string>(`${first}.textContent`)).toMatch(/OPS-7.*Rotate the staging keys/);
    await p.key("Enter");
    expect(await opened()).toBe("https://example.atlassian.net/browse/OPS-7");
  });
  await test.step("a link no issue answers: Linear's No issues found for this link", async () => {
    await paste("https://other.atlassian.net/browse/PX-3");
    await p.waitFor(`${first}?.textContent==='No issues found for this link'`);
    await p.key("Escape");
  });
});
