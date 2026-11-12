import { expect, test, fixture } from "./app";
test("reminders: schedule, reschedule, cancel, and overdue delivery after reopening", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await test.step("reminders schedule, persist, reschedule and cancel without Jira writes", async () => {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.key("h", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Reminder time'`);
    // CORE-8: Linear's centred "Remind me at…" command menu on the issue, whose highlighted first row Enter runs at once.
    expect(
      await page.eval(
        `[document.querySelector('[role=dialog][aria-label="Remind me"]').getBoundingClientRect().width,document.querySelector('[role=dialog][aria-label="Remind me"] .command-menu-key')?.textContent,document.activeElement.placeholder]`,
      ),
    ).toEqual([720, "TEST-2", "Remind me at…"]);
    expect(
      await page.eval(`[...document.querySelectorAll('[role=dialog][aria-label="Remind me"] [cmdk-item]')].map(n=>n.dataset.value).slice(0,2)`),
    ).toEqual(["An hour from now", "In 3 hours"]);
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label^="Reminder scheduled"]')`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Reminder time"]')`)).toBe(false);
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label^="Reminder scheduled"]')`);
    await page.click('[aria-label^="Reminder scheduled"]');
    await page.click("text=Reschedule reminder");
    await page.type("in 2 hours");
    await page.waitFor(`document.querySelectorAll('[role="dialog"] [cmdk-item]').length===2`);
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label^="Reminder scheduled"]')`);
    const label = await page.eval<string>(
      `document.querySelector('[aria-label^="Reminder scheduled"]').getAttribute('aria-label')`,
    );
    expect(label).toContain("Reminder scheduled");
    await page.click('[aria-label^="Reminder scheduled"]');
    await page.click("text=Cancel reminder");
    await page.waitFor(`!document.querySelector('[aria-label^="Reminder scheduled"]')`);
    const { requests } = await (await fetch(`${fixture.url}__fixture`)).json();
    expect(requests.some((r: any) => r.method !== "GET" && r.path.startsWith("/api/"))).toBe(false);
  });
  await test.step("overdue reminders deliver once after reopening the app", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Remind me"]');
    await page.click('[cmdk-item][data-value="An hour from now"]');
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.page.addInitScript("const now=Date.now;Date.now=()=>now()+3601000");
    await page.reload();
    await page.waitFor(`document.body.textContent.includes('Reminder: Browser fixture 2')`);
    await page.waitFor(
      `!document.querySelector('[aria-label^="Reminder scheduled"]')&&!!document.getElementById('comment')`,
    );
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.reload();
    await page.waitFor(
      `!document.querySelector('[aria-label^="Reminder scheduled"]')&&!!document.getElementById('comment')`,
    );
    expect(
      await page.eval(`document.body.textContent.includes('Reminder: Browser fixture 2')`),
    ).toBe(false);
  });
  await test.step("several overdue reminders each appear in order and custom Escape restores focus", async () => {
    const page = await open("?issue=TEST-2&view=page");
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Remind me"]');
    await page.click("text=Custom…");
    await page.waitFor(`!!document.querySelector('[aria-label="Custom reminder time"]')`);
    expect(
      await page.eval(`!!document.querySelector('[aria-label="Custom reminder time"]').min`),
    ).toBe(true);
    await page.key("Escape");
    await page.waitFor(`document.activeElement?.id==='issue-options'`);
    for (const key of ["TEST-2", "TEST-3"]) {
      await page.goto(`?issue=${key}&view=page`);
      await page.click("#issue-options");
      await page.click('[cmdk-item][data-value="Remind me"]');
      await page.click('[cmdk-item][data-value="An hour from now"]');
      await page.waitFor(
        `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
      );
    }
    await page.page.addInitScript("const now=Date.now;Date.now=()=>now()+3601000");
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-toast]')?.textContent.includes('Reminder: Browser fixture 2')`,
    );
    await page.waitFor(
      `document.querySelector('[data-toast]')?.textContent.includes('Reminder: Browser fixture 3')`,
      10000,
    );
  });
});
