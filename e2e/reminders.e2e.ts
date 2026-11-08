import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);
test("reminders schedule, persist, reschedule and cancel without Jira writes", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.key("h", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Reminder time'`);
    await page.key("Enter");
    expect(await page.eval(`!!document.querySelector('[aria-label="Reminder time"]')`)).toBe(true);
    await page.click('[cmdk-item][data-value="An hour from now"]');
    await page.waitFor(`!!document.querySelector('[aria-label^="Reminder scheduled"]')`);
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
    const { requests } = await (await fetch(`${APP}__fixture`)).json();
    expect(requests.some((r: any) => r.method !== "GET" && r.path.startsWith("/api/"))).toBe(false);
  } finally {
    await page.close();
  }
});
test("overdue reminders deliver once after reopening the app", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.click("#issue-options");
    await page.click('[cmdk-item][data-value="Remind me"]');
    await page.click('[cmdk-item][data-value="An hour from now"]');
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]').textContent.includes('Saved')`,
    );
    await page.cmd("Page.addScriptToEvaluateOnNewDocument", {
      source: "const now=Date.now;Date.now=()=>now()+3601000",
    });
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
  } finally {
    await page.close();
  }
});
test("several overdue reminders each appear in order and custom Escape restores focus", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
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
    await page.cmd("Page.addScriptToEvaluateOnNewDocument", {
      source: "const now=Date.now;Date.now=()=>now()+3601000",
    });
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-toast]')?.textContent.includes('Reminder: Browser fixture 2')`,
    );
    await page.waitFor(
      `document.querySelector('[data-toast]')?.textContent.includes('Reminder: Browser fixture 3')`,
      10000,
    );
  } finally {
    await page.close();
  }
});
