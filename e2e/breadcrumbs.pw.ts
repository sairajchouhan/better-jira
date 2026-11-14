import { expect, fixture, test, shownIssue } from "./app";

for (const parent of ["Browser audit", "Issues"]) {
  test(`issue breadcrumb ${parent} returns to All issues on the current board`, async ({
    open,
  }) => {
    const page = await open();
    try {
      await page.click("text=Active");
      await page.click('[data-key="TEST-1"]');
      await page.waitFor(`!!document.getElementById('summary')`);
      await page.click('[title="Open as full page"]');
      const breadcrumb = `document.querySelector('[aria-label="Breadcrumb"]')`;
      expect(await page.eval(`${breadcrumb}?.textContent`)).toMatch(
        /Browser audit.*Issues.*TEST-1/,
      );
      await page.click(`[aria-label="Breadcrumb"] [aria-label="${parent}"]`);
      await page.waitFor(`!document.getElementById('summary')`);
      expect(await page.eval(`location.pathname`)).toBe("/board/1/all");
      expect(await page.eval(`!!${shownIssue}`)).toBe(false);
      expect(
        await page.eval(
          `[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='All issues')`,
        ),
      ).toBe(true);
      await page.eval("history.back()");
      await page.waitFor(`!!document.getElementById('summary')`);
      expect(await page.eval(`${shownIssue}`)).toBe("TEST-1");
    } finally {
      await page.close();
    }
  });
}

test("breadcrumbs: board crumb by keyboard, exiting panels and search, and the issue crumb layout", async ({
  open,
}) => {
  const page = await open();
  await test.step("board breadcrumb opens All issues with the keyboard", async () => {
    await page.click("text=Backlog");
    await page.eval(
      `document.querySelector('[aria-label="Breadcrumb"] [aria-label="Issues"]')?.focus()`,
    );
    await page.key("Enter");
    expect(
      await page.eval(
        `[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent==='All issues')`,
      ),
    ).toBe(true);
  });
  await test.step("breadcrumb exits the side panel, My issues and text search", async () => {
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.click('nav[aria-label="Main navigation"] a[href="/my-issues"]'); // My issues, after Inbox, Search and New issue
    await page.key("f", "meta");
    await page.waitFor(`document.activeElement?.id==='find-in-view'`);
    await page.type("no matching issue");
    await page.click('[aria-label="Breadcrumb"] [aria-label="My issues"]');
    await page.waitFor(`!document.getElementById('summary')`);
    expect(await page.eval(`!!document.getElementById('find-in-view')`)).toBe(false);
    expect(await page.eval(`document.querySelectorAll('[data-key]').length`)).toBe(6);
  });
  await test.step("the issue crumb shows the key then the title on one line, and the position dims its total, like Linear", async () => {
    // Opened from the list, so the page counts that list (a direct link counts nothing, as Linear's empty breadcrumb stack).
    const page = await open();
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.getElementById('summary')`);
    await page.click('[title="Open as full page"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Breadcrumb"] [data-crumb-issue]')`);
    const crumb = `document.querySelector('[aria-label="Breadcrumb"] [data-crumb-issue]')`;
    expect(
      await page.eval(
        `[${crumb}.textContent,getComputedStyle(${crumb}.lastElementChild).whiteSpace,getComputedStyle(${crumb}.lastElementChild).textOverflow,getComputedStyle(${crumb}.firstElementChild).marginRight]`,
      ),
    ).toEqual(["TEST-2Browser fixture 2", "nowrap", "ellipsis", "5.6px"]);
    const position = `document.querySelector('[aria-label="Issue position"]')`;
    // Linear (RAJ-52 from the team list): "2" in lch(61.803 1.2 272), " / 25" in lch(36.975 1.2 272).
    expect(
      await page.eval(
        `[getComputedStyle(${position}).color,getComputedStyle(${position}.firstElementChild).color,${position}.textContent]`,
      ),
    ).toEqual(["lch(61.803 1.2 272)", "lch(36.975 1.2 272)", "2 / 6"]);
  });
  await test.step("at 390px the issue key stays whole and clear of the favorite star; the title truncates, Issues and the position give way (Opus review 4)", async () => {
    const page = await open("?issue=TEST-2&view=page", { width: 390, height: 844 });
    await page.waitFor(`!!document.getElementById('summary')`);
    const key = `document.querySelector('[aria-label="Breadcrumb"] [data-crumb-issue]').firstElementChild`;
    const [width, scroll, right, star] = await page.eval<[number, number, number, number]>(
      `[${key}.getBoundingClientRect().width,${key}.scrollWidth,${key}.getBoundingClientRect().right,document.querySelector('[role="switch"][aria-label$="favorites"]').getBoundingClientRect().left]`,
    );
    expect(width).toBeGreaterThanOrEqual(scroll);
    expect(width).toBeGreaterThan(30);
    expect(right).toBeLessThanOrEqual(star);
  });
});

/**
 * Linear's issue breadcrumb (startup-root `Hpi`): the epic in the project slot (by key, the user's choice over Linear's name), then the issues the page was opened through, then
 * the issue; the counter steps what it was opened from. Fixture with `epics` and `subtask`: TEST-7 "Fixture epic" lists TEST-2 and
 * TEST-3; TEST-6 is TEST-5's Subtask, and TEST-5 is in no epic.
 */
test("issue breadcrumb follows how the page was reached: a link, an epic's Sub-issues, a parent's sub-issues, a reload", async ({ open }) => {
  await fixture.reset({ epics: true, subtask: true });
  const crumbs = `[...document.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map(li=>li.querySelector('[data-crumb-issue] .ui-entity-id')?.textContent??li.querySelector('a,span')?.getAttribute('aria-label')??li.textContent.replace('›','').trim())`;
  const position = `document.querySelector('[aria-label="Issue position"]')?.textContent ?? null`;
  const page = await open("?issue=TEST-2&view=page");

  const epic = 'nav[aria-label="Breadcrumb"] a[href="/issue/TEST-7"]';
  await test.step("a direct link shows the epic by key (its icon, its title as the tooltip) then the issue, and no counter", async () => {
    await page.waitFor(`!!document.querySelector('[aria-label="Breadcrumb"] [data-crumb-issue]')`);
    expect(await page.eval(crumbs)).toEqual(["TEST-7", "TEST-2"]);
    expect(await page.eval(`!!document.querySelector('nav[aria-label="Breadcrumb"] li:first-child svg')`)).toBe(true);
    expect(await page.eval(`document.querySelector('${epic}').textContent`)).toBe("TEST-7");
    expect(await page.eval(`document.querySelector('${epic}').title`)).toBe("Fixture epic");
    expect(await page.eval(position)).toBeNull();
  });

  await test.step("the epic crumb opens the epic; a row of its Sub-issues opens with the counter through the epic's issues", async () => {
    await page.click(epic);
    await page.waitFor(`location.pathname==='/issue/TEST-7'`);
    await page.waitFor(`!!document.querySelector('[data-sub-issues="TEST-7"] [data-sub-issue="TEST-3"] a')`);
    await page.click('[data-sub-issues="TEST-7"] [data-sub-issue="TEST-3"] a');
    await page.waitFor(`location.pathname==='/issue/TEST-3'`);
    expect(await page.eval(crumbs)).toEqual(["TEST-7", "TEST-3"]);
    expect(await page.eval(position)).toMatch(/^\d \/ 2$/);
    // ↓/↑ step the epic's issues and keep the breadcrumb.
    const at = await page.eval<string>(position);
    await page.key(at.startsWith("1") ? "j" : "k");
    await page.waitFor(`location.pathname==='/issue/TEST-2'`);
    expect(await page.eval(crumbs)).toEqual(["TEST-7", "TEST-2"]);
    expect(await page.eval(position)).toMatch(/^\d \/ 2$/);
  });

  await test.step("a reload falls back to the direct link's breadcrumb", async () => {
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Breadcrumb"] [data-crumb-issue]')`);
    expect(await page.eval(crumbs)).toEqual(["TEST-7", "TEST-2"]);
    expect(await page.eval(position)).toBeNull();
  });

  await test.step("from a parent's sub-issues: the parent by key, its title as the tooltip; it links back, and Back restores the trail", async () => {
    await page.goto("?issue=TEST-5&view=page");
    await page.waitFor(`!!document.querySelector('[data-sub-issues="TEST-5"] [data-sub-issue="TEST-6"] a')`);
    await page.click('[data-sub-issues="TEST-5"] [data-sub-issue="TEST-6"] a');
    await page.waitFor(`location.pathname==='/issue/TEST-6'`);
    // TEST-5 is in no epic, so no epic crumb; one sub-issue, so no counter (Linear shows none for a list of one).
    const parent = 'nav[aria-label="Breadcrumb"] a[href="/issue/TEST-5"]';
    await page.waitFor(`!!document.querySelector('${parent}')`);
    expect(await page.eval(`document.querySelectorAll('nav[aria-label="Breadcrumb"] li').length`)).toBe(2);
    expect(await page.eval(`document.querySelector('${parent}').textContent`)).toBe("TEST-5");
    expect(await page.eval(`document.querySelector('${parent}').title`)).toMatch(/\S/);
    expect(await page.eval(`document.querySelector('${parent}').getAttribute('aria-current')`)).toBeNull();
    // Right-click: the parent's copy rows.
    await page.page.locator(parent).click({ button: "right" });
    await page.waitFor(`!!document.querySelector('[role="dialog"][aria-label="Issue options"] [cmdk-item]')`);
    expect(await page.eval(`document.querySelector('[role="dialog"][aria-label="Issue options"] [cmdk-item]').textContent`)).toContain("Copy ID");
    await page.key("Escape");
    await page.click(parent);
    await page.waitFor(`location.pathname==='/issue/TEST-5'`);
    expect(await page.eval(`document.querySelectorAll('nav[aria-label="Breadcrumb"] li').length`)).toBe(1);
    await page.eval("history.back()");
    await page.waitFor(`location.pathname==='/issue/TEST-6'`);
    await page.waitFor(`!!document.querySelector('${parent}')`);
  });
});
