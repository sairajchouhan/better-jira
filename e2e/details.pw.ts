import { expect, test, type App as Page, fixture, sleep } from "./app";

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
  // The issue opened before the editor chunk arrived: its stand-ins differ a little in height from the editors that take
  // over, so the timestamp settles once both are in.
  await page.waitFor(`!!document.querySelector("#description.ProseMirror") && !!document.querySelector("#comment.ProseMirror")`);
  await page.hover("#issue-created a");
  await page.waitFor(`!!document.querySelector('[role=tooltip]')`);
  expect(await page.eval(`document.querySelector('[role=tooltip]').textContent`)).toBe(
    await page.eval(`document.querySelector('#issue-created a').getAttribute('aria-label')`),
  );
});

/** From before the first paint: each `.rich-content` removed (by its scope, or "stand-in" for the loader's), how many
 *  mutation batches left an issue's description without one once it had shown one, and, once `tops` is set, the issue
 *  body's scroll position after each batch and each frame. Reading it lays out the page, as anything measuring would. */
const WATCH_EDITORS = `
  window.__editors = { removed: [], empty: 0, seen: false, tops: null };
  const scrolled = () => {
    const log = window.__editors, body = document.querySelector(".issue-detail-body");
    if (log.tops && body) log.tops.push(body.scrollTop);
  };
  new MutationObserver((records) => {
    const log = window.__editors;
    for (const record of records)
      for (const node of record.removedNodes) {
        if (node.nodeType !== 1) continue;
        for (const editor of node.matches(".rich-content") ? [node] : node.querySelectorAll(".rich-content"))
          log.removed.push(editor.dataset.scope ?? (editor.getAttribute("aria-busy") ? "stand-in" : "unscoped"));
      }
    const description = document.querySelector(".issue-description");
    if (description?.querySelector(".rich-content")) log.seen = true;
    else if (description && log.seen) log.empty++;
    scrolled();
  }).observe(document, { childList: true, subtree: true });
  const frame = () => (scrolled(), requestAnimationFrame(frame));
  requestAnimationFrame(frame);
`;

test("BJ-193: an issue opened while its details load mounts each editor once", async ({ open }) => {
  await fixture.reset();
  // An issue in the address loads the editor chunk at once; the next issue opens with that chunk ready.
  const page = await open("?issue=TEST-2", { setup: WATCH_EDITORS });
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`);
  // Jira's details arrive after the issue opened, as they do for an issue not read yet (TEST-2's neighbours were).
  await page.page.route(/\/api\/issues\/TEST-3$/, async (route) => {
    await sleep(300);
    await route.continue();
  });
  expect((await fixture.log()).requests.map((r) => r.path)).not.toContain("/api/issues/TEST-3");
  await page.click('[data-key="TEST-3"]');
  await page.waitFor(`document.querySelector("#description")?.dataset.scope === "TEST-3:description"`);
  await sleep(500);
  expect(await page.eval(`window.__editors.removed.filter((scope) => scope.startsWith("TEST-3"))`)).toEqual([]);
  expect(await page.eval(`document.querySelectorAll(".issue-description .rich-content").length`)).toBe(1);
});

// Each frame, the issue's layout and which editors are real, so a test can compare the stand-ins' frame with the editors'.
const WATCH_LAYOUT = `
  window.__layout = [];
  const frame = () => {
    const description = document.querySelector(".issue-description");
    const activity = [...document.querySelectorAll("h3")].find((h) => h.textContent === "Activity");
    const field = document.querySelector('[aria-label="Leave a comment…"]');
    const composer = field?.closest(".rich-editor") ?? field;
    if (description && activity && composer)
      window.__layout.push({
        at: performance.now(),
        description: !!document.querySelector("#description.ProseMirror"),
        comment: !!document.querySelector("#comment.ProseMirror"),
        busy: document.querySelectorAll('.rich-content[aria-busy="true"]').length,
        descriptionHeight: description.getBoundingClientRect().height,
        activityTop: activity.getBoundingClientRect().top,
        composerHeight: composer.getBoundingClientRect().height,
      });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
`;

for (const smartLinks of [false, true])
  test(`BJ-198: the editors take over from their stand-ins in one frame and move nothing${smartLinks ? " (smart links)" : ""}`, async ({
    open,
  }) => {
    await fixture.reset({ smartLinks });
    const page = await open("", { height: 1400, setup: WATCH_LAYOUT });
    // A cold editor chunk: held until both stand-ins show (BJ-110).
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.page.route("**/*.js", async (route) => {
      const response = await route.fetch();
      if ((await response.text()).includes("Invalid content for node")) await gate;
      await route.fulfill({ response });
    });
    await page.click('[data-key="TEST-2"]');
    try {
      // Released as soon as both show, inside React's 300ms Suspense reveal throttle.
      await page.waitFor(`document.querySelectorAll('.rich-content[aria-busy="true"]').length === 2`);
      await page.eval(`window.__released = performance.now()`);
    } finally {
      release();
    }
    await page.waitFor(`!!document.querySelector("#description.ProseMirror") && !!document.querySelector("#comment.ProseMirror")`);
    await sleep(300);
    type Frame = { at: number; description: boolean; comment: boolean; busy: number; descriptionHeight: number; activityTop: number; composerHeight: number };
    const frames = await page.eval<Frame[]>(`window.__layout`);
    const before = frames.findLast((f) => f.busy === 2)!,
      after = frames.at(-1)!;
    expect(before).toBeDefined();
    // Both editors replace their stand-ins in the same frame: no stand-in waits behind React's Suspense reveal throttle.
    expect(frames.filter((f) => f.busy === 1)).toEqual([]);
    expect(after).toMatchObject({ description: true, comment: true, busy: 0 });
    // And as soon as the chunk arrives (~50ms to fetch and run it): React's throttle held them until 300ms after the
    // stand-ins showed, ~200ms after this release.
    expect(frames.find((f) => f.busy === 0)!.at - (await page.eval<number>(`window.__released`))).toBeLessThan(160);
    const layout = ({ descriptionHeight, activityTop, composerHeight }: Frame) => ({ descriptionHeight, activityTop, composerHeight });
    expect(layout(after)).toEqual(layout(before));
    // Nothing moved in any frame between.
    expect(new Set(frames.slice(frames.indexOf(before)).map((f) => JSON.stringify(layout(f)))).size).toBe(1);
  });

test("BJ-193: the editor takes over from its stand-in in one frame, keeping a scroll made while the issue opens", async ({
  open,
}) => {
  await fixture.reset();
  const page = await open("", { height: 420, setup: WATCH_EDITORS });
  // The editor chunk is held until the issue shows, so the stand-ins show first (BJ-110).
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.page.route("**/*.js", async (route) => {
    const response = await route.fetch();
    if ((await response.text()).includes("Invalid content for node")) await gate;
    await route.fulfill({ response });
  });
  await page.click('[data-key="TEST-1"]');
  let top: number;
  try {
    await page.waitFor(`!!document.querySelector('.issue-description [aria-busy="true"].rich-content')`);
    // Near the end, as a reader landing on the issue might scroll.
    top = await page.eval<number>(`(() => {
      const body = document.querySelector(".issue-detail-body");
      body.scrollTop = body.scrollHeight - body.clientHeight - 40;
      window.__editors.tops = [];
      return body.scrollTop;
    })()`);
    expect(top).toBeGreaterThan(0);
  } finally {
    release();
  }
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`);
  await sleep(300);
  expect(await page.eval(`window.__editors.empty`)).toBe(0);
  expect(await page.eval(`window.__editors.removed.filter((scope) => scope !== "stand-in")`)).toEqual([]);
  // Never clamped by an empty frame; scroll anchoring may move it down as the editor's blocks render taller.
  expect(await page.eval(`Math.min(...window.__editors.tops)`)).toBeGreaterThanOrEqual(top);
});

// TEST-3 becomes TEST-2's sub-issue, so the issue page has a Sub-issues heading below its description.
const WITH_SUB_ISSUE = `const read=fetch;window.fetch=async(...args)=>{const response=await read(...args);if(new URL(String(args[0]),location.href).pathname!=='/api/issues')return response;const issues=await response.json();issues.find(i=>i.key==='TEST-3').parent='TEST-2';return Response.json(issues)};`;
// Each frame once the issue shows: whether the description is the loading skeleton, and where the Sub-issues heading is.
const WATCH_RELOAD = `
  window.__frames = [];
  const frame = () => {
    const heading = document.querySelector("[data-sub-issues] button");
    if (document.getElementById("summary") && heading)
      window.__frames.push({
        skeleton: !!document.querySelector(".issue-description [role=status]"),
        subIssues: heading.getBoundingClientRect().top,
      });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
`;
type ReloadFrame = { skeleton: boolean; subIssues: number };

test("reloading an issue page: the description holds Linear's 190px skeleton while its record loads, and nothing below it moves meanwhile", async ({
  open,
}) => {
  await fixture.reset();
  const page = await open("?issue=TEST-2&view=page", { setup: WITH_SUB_ISSUE + WATCH_RELOAD });
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.page.route(/\/api\/issues\/TEST-2$/, async (route) => {
    await gate;
    await route.continue();
  });
  try {
    await page.page.reload();
    await page.waitFor(`!!document.querySelector(".issue-description [role=status]")`, 15000);
    // Past Linear's 250ms delay and the fade.
    await sleep(700);
    // Linear's document fallback (`Jjn`): 24px above and below, at least 190px, three 18px bars 9px apart, 50–100% wide.
    expect(
      await page.eval(`(() => {
        const slot = document.querySelector(".issue-description [role=status]"), box = slot.getBoundingClientRect(), style = getComputedStyle(slot);
        const bars = [...slot.querySelectorAll("[aria-hidden] > div")];
        const heading = document.querySelector("[data-sub-issues] button").getBoundingClientRect();
        return {
          height: box.height,
          padding: [style.paddingTop, style.paddingBottom],
          shown: getComputedStyle(slot.querySelector("[aria-hidden]")).opacity,
          bars: bars.map((bar) => { const r = bar.getBoundingClientRect(), s = getComputedStyle(bar); return [r.height, s.marginBottom, s.borderRadius, r.width >= box.width / 2 - 2 && r.width <= box.width]; }),
          below: heading.top >= box.bottom,
        };
      })()`),
    ).toEqual({
      height: 190,
      padding: ["24px", "24px"],
      shown: "1",
      bars: [
        [18, "9px", "12px", true],
        [18, "9px", "12px", true],
        [18, "9px", "12px", true],
      ],
      below: true,
    });
  } finally {
    release();
  }
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`);
  const waiting = (await page.eval<ReloadFrame[]>(`window.__frames`)).filter((f) => f.skeleton);
  expect(waiting.length).toBeGreaterThan(0);
  expect(new Set(waiting.map((f) => f.subIssues)).size).toBe(1);
});

test("reloading an issue page reads its record alongside the app's load, so the first paint has the description and the Sub-issues heading never moves", async ({
  open,
}) => {
  await fixture.reset();
  const page = await open("?issue=TEST-2&view=page", { setup: WITH_SUB_ISSUE + WATCH_RELOAD });
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`);
  // The mirror's list waits (up to 2s) for the issue's record: Linear's PageDataPreloader asks for it with the app's own load.
  let answer!: () => void,
    beforeList: boolean | undefined;
  const answered = new Promise<boolean>((resolve) => (answer = () => resolve(true)));
  await page.page.route(/\/api\/issues\/TEST-2$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response });
    answer();
  });
  await page.page.route(/\/api\/issues$/, async (route) => {
    beforeList = await Promise.race([answered, sleep(2000).then(() => false)]);
    await route.continue();
  });
  await page.page.reload();
  await page.waitFor(`!!document.querySelector("#description.ProseMirror")`, 15000);
  await sleep(300);
  expect(beforeList).toBe(true);
  const frames = await page.eval<ReloadFrame[]>(`window.__frames`);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.filter((f) => f.skeleton)).toEqual([]);
  expect(new Set(frames.map((f) => f.subIssues)).size).toBe(1);
});
