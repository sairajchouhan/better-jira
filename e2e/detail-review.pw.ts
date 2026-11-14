import { expect, test } from "./app";

const GRID = `document.querySelector('.issue-detail-grid')`;
const near = (actual: number[], expected: number[], within: number) =>
  expected.every((value, i) => Math.abs(actual[i]! - value) < within);

test("issue detail layout across widths: measured grid, fixed properties, and pills below 820px", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page", { width: 1864, height: 900 });
  await page.waitFor(`!!document.getElementById('comment')`);
  await page.eval("document.fonts.ready");
  const columns = () =>
    page.eval<number[]>(`getComputedStyle(${GRID}).gridTemplateColumns.split(' ').map(parseFloat)`);

  await test.step("measured grid columns interpolate: at 1864px", async () => {
    expect(near(await columns(), [117.25, 807.5, 400, 117.25], 3)).toBe(true);
    expect(await page.eval(`getComputedStyle(${GRID}).columnGap`)).toBe("56px");
  });

  await test.step("measured grid columns interpolate: at 1400px, and properties remain fixed while scrolling", async () => {
    await page.page.setViewportSize({ width: 1400, height: 900 });
    await expect.poll(async () => near(await columns(), [0, 647.9, 365, 0], 3)).toBe(true);
    expect(
      Math.abs(
        (await page.eval<number>(`parseFloat(getComputedStyle(${GRID}).columnGap)`)) - 44.35,
      ),
    ).toBeLessThan(0.2);
    await page.eval(
      `document.querySelector('.issue-detail-content').insertAdjacentHTML('beforeend','<div style="height:1500px">Scroll fixture</div>');document.querySelector('.issue-detail-body').scrollTop=2000`,
    );
    await page.waitFor(`document.querySelector('.issue-detail-body').scrollTop>500`);
    // RAJ-52 scrolled 800px: the Properties heading stays 74.75px under the scroller's top, where it started (127.75 with the scroller at 53).
    expect(
      Math.abs(
        (await page.eval<number>(
          `document.querySelector('.issue-detail-properties h3').getBoundingClientRect().top-document.querySelector('.issue-detail-body').getBoundingClientRect().top`,
        )) - 74.75,
      ),
    ).toBeLessThan(0.3);
  });

  await test.step("pills follow Linear order, omit unset dates and milestones, and switch below an 820px container", async () => {
    await page.page.setViewportSize({ width: 1074, height: 900 });
    await page.reload(); // drops the scroll fixture
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(
      await page.eval(`getComputedStyle(document.querySelector('[data-properties]')).display`),
    ).toBe("block");
    await page.page.setViewportSize({ width: 1073, height: 900 });
    await page.waitFor(
      `getComputedStyle(document.querySelector('[data-properties]')).display==='flex'`,
    );
    expect(
      await page.eval(
        `document.getElementById('summary').getBoundingClientRect().left-document.querySelector('.issue-detail-body').getBoundingClientRect().left`,
      ),
    ).toBe(14);
    expect(
      await page.eval(
        `document.getElementById('prop-status').getBoundingClientRect().left-document.getElementById('summary').getBoundingClientRect().left`,
      ),
    ).toBe(6);
    expect(await page.eval(`document.getElementById('prop-due')`)).toBeNull();
    expect(await page.eval(`document.getElementById('prop-milestone')`)).toBeNull();
    expect(
      await page.eval(
        `[...document.querySelectorAll('[data-properties] button[id]')].sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y||a.getBoundingClientRect().x-b.getBoundingClientRect().x).map(b=>b.id)`,
      ),
    ).toEqual([
      "prop-status",
      "prop-priority",
      "prop-assignee",
      "prop-type",
      "prop-project",
      "prop-labels",
    ]);
    await page.click("#prop-project");
    await page.click("text=No epic");
    expect(await page.eval(`document.getElementById('prop-project').innerText`)).toBe("Epic");
  });
});

test("issue comments: card outsets, timestamps and deep links, whitespace and subscribers", async ({
  open,
}) => {
  const page = await open("?issue=TEST-2&view=page");
  await page.waitFor(`!!document.getElementById('comment')`);

  await test.step("comment cards and composer have the measured 8px outsets and subscription text is 12px", async () => {
    await page.click("#comment");
    await page.type("Measure card edges");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-thread]')`);
    const geometry = await page.eval<{ card: number; composer: number; font: string }>(
      `(()=>{const text=document.querySelector('#description > *').getBoundingClientRect().left;return {card:text-document.querySelector('[data-thread]').getBoundingClientRect().left,composer:text-document.querySelector('.issue-activity > div:last-child').getBoundingClientRect().left,font:getComputedStyle(document.getElementById('issue-subscribers').previousElementSibling).fontSize}})()`,
    );
    expect(geometry.card).toBeCloseTo(8, 1);
    expect(geometry.composer).toBeCloseTo(8, 1);
    expect(geometry.font).toBe("12px");
  });

  await test.step("timestamps name precise times, deep-link to comments, and clear on issue navigation", async () => {
    await page.waitFor(`document.getElementById('comment')?.textContent===''`);
    await page.click("#comment");
    await page.cmd("Input.insertText", { text: "Earlier comment\n".repeat(90) });
    await page.key("Enter", "meta");
    await page.waitFor(`document.getElementById('comment')?.textContent===''`);
    await page.click("#comment");
    await page.cmd("Input.insertText", { text: "Timestamp regression comment" });
    await page.key("Enter", "meta");
    const selector = '[data-thread]:last-child [data-comment^="local-"] a:has(time)';
    const link = `document.querySelector(${JSON.stringify(selector)})`;
    await page.waitFor(`!!${link}`);
    const href = await page.eval<string>(`${link}.href`);
    expect(new URL(href).hash).toMatch(/^#comment-local-/);
    expect(await page.eval(`${link}.getAttribute('aria-label')`)).toContain(":");
    await page.waitFor(
      `document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`,
    );
    // Linear: hovering the time shows "Sat Nov 7, 2026, 07:49:03" centred 8px above it.
    expect(await page.eval(`${link}.getAttribute('aria-label')`)).toMatch(
      /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}:\d{2}$/,
    );
    // Settle the scroll first (its event fires on the next frame): a scroll hides the tooltip, as in Linear.
    await page.eval(
      `new Promise(r=>{${link}.scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(r))})`,
    );
    await page.hover(selector);
    await page.waitFor(`!!document.querySelector('.app-tooltip')`, 2000);
    expect(
      await page.eval(
        `(()=>{const t=document.querySelector('.app-tooltip').getBoundingClientRect(),a=${link}.getBoundingClientRect();return [Math.round(a.top-t.bottom),Math.round(Math.abs(t.x+t.width/2-a.x-a.width/2)),document.querySelector('.app-tooltip').textContent===${link}.getAttribute('aria-label')]})()`,
      ),
    ).toEqual([8, 0, true]);
    await page.click(selector);
    expect(await page.eval("location.hash")).toBe(new URL(href).hash);
    await page.click('[title="Next (J / ↓)"]');
    expect(await page.eval("location.hash")).toBe("");
    await page.page.goto(href);
    await page.waitFor(`!!document.querySelector('[data-comment]')`);
    expect(await page.eval("location.hash")).toBe(new URL(href).hash);
    expect(
      await page.eval(`[...document.querySelectorAll('[data-comment]')].map(e=>e.id)`),
    ).toContain(new URL(href).hash.slice(1));
    expect(
      await page.eval(
        `(()=>{const r=document.getElementById(decodeURIComponent(location.hash.slice(1))).getBoundingClientRect();return r.bottom>0&&r.top<innerHeight})()`,
      ),
    ).toBe(true);
  });

  await test.step("whitespace comments stay disabled and subscriber choices expose checked state", async () => {
    await page.waitFor(`!!document.getElementById('comment')`);
    await page.click("#comment");
    await page.key("Enter");
    await page.key("Enter");
    await page.type(" ");
    expect(
      await page.eval(
        `document.querySelector('.rich-editor:has(#comment) [data-variant="send"]').disabled`,
      ),
    ).toBe(true);
    await page.key("Escape");
    await page.click('[aria-label="Change subscribers"]');
    await page.type("Audit Me");
    const checked = `document.querySelector('[cmdk-item][data-selected=true]').getAttribute('aria-checked')`;
    expect(await page.eval(checked)).toBe("false");
    // FILTER-10: Shift+Enter toggles and keeps the menu open (plain Enter closes it).
    await page.key("Enter", "shift");
    expect(await page.eval(checked)).toBe("true");
    await page.key("Escape");
  });
});
