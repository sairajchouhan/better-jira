import { expect, test, type App as Page, fixture } from "./app";

async function openIssue(page: Page, key = "TEST-1") {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(
    `!!document.getElementById("summary")&&!document.querySelector('[role=status]')?.textContent?.startsWith("Loading")`,
  );
}

test("issue details: priority picker, reactions, favourites, navigation and property layout", async ({
  open,
}) => {
  const page = await open();
  await test.step("I12: the priority picker lists priorities ranked Urgent to Low, each with its icon", async () => {
    await page.key("j");
    await page.key("p");
    await page.waitFor(`document.querySelectorAll("[cmdk-item]").length>1`);
    expect(
      await page.eval(
        `[...document.querySelectorAll("[cmdk-item]")].map(i=>i.textContent.replace(/[0-9]$/,""))`,
      ),
    ).toEqual(["No priority", "Urgent", "High", "Normal", "Low"]);
    expect(
      await page.eval(
        `[...document.querySelectorAll("[cmdk-item]")].every(i=>i.querySelector("svg"))`,
      ),
    ).toBe(true);
    // Jira's "Urgent" takes Linear's urgent icon (the filled square with "!"), not the no-priority dashes.
    expect(
      await page.eval(
        `[...document.querySelectorAll("[cmdk-item]")].map(i=>!!i.querySelector("svg rect[rx='3']"))`,
      ),
    ).toEqual([false, true, false, false, false]);
    await page.key("Escape");
  });
  await test.step("I14: Enter in the emoji search picks the match", async () => {
    await openIssue(page);
    await page.click('[aria-label="Add reaction"]');
    await page.waitFor(`document.activeElement?.getAttribute("aria-label")==="Search emoji"`);
    await page.type("thumbs up");
    await page.key("Enter");
    await page.waitFor(`!!document.querySelector('[aria-label="Remove 👍 reaction"]')`);
  });
  await test.step("I16: a favourited issue's star turns yellow", async () => {
    await openIssue(page);
    await page.click('[aria-label="Add issue to favorites"]');
    expect(
      await page.waitFor<string>(
        `getComputedStyle(document.querySelector('[aria-label="Remove issue from favorites"]')).color`,
      ),
    ).toBe("rgb(242, 201, 76)");
  });
  await test.step("I18: issue navigation shows its position and next before previous", async () => {
    await openIssue(page, "TEST-1");
    const summary = `(document.getElementById("summary").value??document.getElementById("summary").textContent)`;
    expect(await page.eval(summary)).toBe("Rich browser fixture");
    expect(
      await page.eval(`document.querySelector('[aria-label="Issue position"]').textContent`),
    ).toBe("1 / 6");
    expect(
      await page.eval(
        `[...document.querySelector('[aria-label="Issue position"]').parentElement.querySelectorAll('button')].map(b=>b.title)`,
      ),
    ).toEqual(["Next (J / ↓)", "Previous (K / ↑)"]);
    await page.click('[title="Next (J / ↓)"]');
    expect(await page.waitFor<string>(`${summary}!=="Rich browser fixture"&&${summary}`)).toMatch(
      /^Browser fixture \d$/,
    );
  });
  await test.step("I17/R7: properties are unlabelled 13px/500 rows under section headings, with Linear's page title size", async () => {
    await openIssue(page);
    const props = `document.querySelector("[data-properties]")`;
    expect(await page.eval(`getComputedStyle(${props}.parentElement).borderTopWidth`)).toBe("0px");
    await page.click('[title="Open as full page"]');
    await page.waitFor(`getComputedStyle(document.getElementById("summary")).fontSize==="24px"`);
    expect(await page.eval(`getComputedStyle(document.getElementById("summary")).fontWeight`)).toBe(
      "600",
    );
    expect(await page.eval(`[...${props}.querySelectorAll("h3")].map(h=>h.textContent)`)).toEqual([
      "Properties",
      "Labels",
      "Project",
    ]);
    expect(await page.eval(`${props}.querySelectorAll("dt").length`)).toBe(0);
    expect(await page.eval(`/Reporter|Created|Updated/.test(${props}.textContent)`)).toBe(false);
    const style = `getComputedStyle(document.getElementById("prop-status"))`;
    expect(await page.eval(`[${style}.fontSize,${style}.fontWeight]`)).toEqual(["13px", "500"]);
  });
  await test.step("I15: a link to an unknown issue says it was not found", async () => {
    const page = await open("?issue=NOPE-1");
    // The address names the issue, so its screen says so, as Linear's issue route does.
    await page.waitFor(`document.body.textContent.includes("Issue NOPE-1 not found")`);
  });
});

test("BJ-14: creation uses the issue creator and mirrored timestamp, with an exact-time tooltip", async ({ open }) => {
  await fixture.reset({ distinctCreator: true });
  const page = await open("", { setup: `Date.now = () => Date.parse("2028-11-12T12:00:00Z")` });
  await openIssue(page, "TEST-6");
  expect(await page.eval(`document.querySelector('#issue-created .font-medium').textContent`)).toBe("Alex");
  expect(await page.eval(`document.querySelector('#issue-created time').textContent`)).toBe("2y ago");
  expect(await page.eval(`document.querySelector('#issue-created time').dateTime`)).toBe("2026-11-06T10:00:00Z");
  expect(await page.eval(`document.querySelector('#issue-created a').getAttribute('aria-label')`)).toMatch(/^Fri Nov 6, 2026, /);
  // The scroll event dismisses tooltips, and the description editor rebuilds just after opening (BJ-193): hover only once the
  // timestamp has stayed put for a few frames, so the pointer lands on it and stays there.
  await page.eval(`new Promise(resolve => {
    const link = () => document.querySelector('#issue-created a');
    let last = NaN, still = 0;
    const tick = () => {
      link().scrollIntoView({block: 'center'});
      const top = link().getBoundingClientRect().top;
      still = top === last ? still + 1 : 0;
      last = top;
      if (still >= 40) resolve(undefined); else requestAnimationFrame(tick);
    };
    tick();
  })`);
  console.log("DBG", await page.eval(`new Promise(res => { const b=document.querySelector('.issue-detail-body'); const out=[]; const t0=performance.now(); new MutationObserver(ms=>{ for(const m of ms){ for(const n of m.removedNodes){ if(n.nodeType===1){ out.push(Math.round(performance.now()-t0)+'ms REMOVED '+n.tagName+'.'+String(n.className).slice(0,40)+' in '+String(m.target.className).slice(0,30)+' top='+b.scrollTop); } } } }).observe(b,{childList:true,subtree:true}); b.addEventListener('scroll',()=>out.push(Math.round(performance.now()-t0)+'ms scroll top='+b.scrollTop+' sh='+b.scrollHeight)); setTimeout(()=>res(out.slice(0,25).join('\\n')),1000); })`));
  await page.hover("#issue-created a");
  await page.waitFor(`!!document.querySelector('[role=tooltip]')`);
  expect(await page.eval(`document.querySelector('[role=tooltip]').textContent`)).toBe(
    await page.eval(`document.querySelector('#issue-created a').getAttribute('aria-label')`),
  );
});
