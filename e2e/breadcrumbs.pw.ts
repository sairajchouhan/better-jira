import { expect, test, shownIssue } from "./app";

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
      expect(await page.eval(`location.pathname`)).toBe("/team/1/all");
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
    const page = await open("?issue=TEST-2&view=page");
    await page.waitFor(`!!document.getElementById('summary')`);
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
