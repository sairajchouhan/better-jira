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
      "Epic",
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

/** TEST-2 links five pull requests (Jira counts them with the issue): two open with reviews, one draft, one open, one merged, and
 *  two closed. window.open and the pull request reads stay in the test. */
const SIDEBAR_PRS = [
  { url: "https://github.com/example/app/pull/41", title: "Queue the save", number: "#41", status: "inReview", changesRequested: true, repo: "app", author: "ana-dev", branch: "fix/queue", tool: "GitHub", updated: "2026-11-12T10:00:00Z" },
  { url: "https://github.com/example/app/pull/42", title: "Retry the send", number: "#42", status: "approved", repo: "app", tool: "GitHub", updated: "2026-11-11T10:00:00Z" },
  { url: "https://github.com/example/app/pull/43", title: "Draft the board", number: "#43", status: "draft", repo: "app", tool: "GitHub", updated: "2026-11-10T10:00:00Z" },
  { url: "https://github.com/example/app/pull/44", title: "Open the panel", number: "#44", status: "open", repo: "app", tool: "GitHub", updated: "2026-11-09T10:00:00Z" },
  { url: "https://github.com/example/app/pull/45", title: "Merge the fixture", number: "#45", status: "merged", repo: "app", tool: "GitHub", updated: "2026-11-13T10:00:00Z" },
  { url: "https://github.com/example/app/pull/46", title: "Close the old", number: "#46", status: "declined", repo: "app", tool: "GitHub", updated: "2026-11-08T10:00:00Z" },
  { url: "https://github.com/example/app/pull/47", title: "Close the older", number: "#47", status: "declined", repo: "app", tool: "GitHub", updated: "2026-11-07T10:00:00Z" },
];
const sidebarPrSetup = `(()=>{window.__opened=[];window.open=(u)=>{window.__opened.push(String(u));return null};const real=fetch;window.fetch=async(input,init)=>{const path=new URL(String(input),location.href).pathname;
 if(path==='/api/issues/TEST-2/pull-requests')return Response.json(${JSON.stringify(SIDEBAR_PRS)});
 if(path==='/api/issues'){const issues=await (await real(input,init)).json();return Response.json(issues.map(i=>i.key==='TEST-2'?{...i,prCount:${SIDEBAR_PRS.length},prStatus:'open'}:i));}
 return real(input,init);};})()`;

test("BJ-253: the issue sidebar opens with Linear's Diffs section: its pull requests, their reviews, card and menu", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=page", { setup: sidebarPrSetup });
  const section = `[...document.querySelectorAll('.issue-detail-properties section')].find(s=>s.querySelector('h3')?.textContent==='Diffs')`;
  const rows = `[...${section}.querySelectorAll('[data-pull-request-row]')].map(r=>r.dataset.pullRequestRow)`;
  await page.waitFor(`!!${section}`);

  await test.step("Diffs comes first, above Properties; three rows show, open first (newest first), the rest under Show N more", async () => {
    expect(await page.eval(`[...document.querySelectorAll('.issue-detail-properties h3')].map(h=>h.textContent).slice(0,2)`)).toEqual([
      "Diffs",
      "Properties",
    ]);
    expect(await page.eval(rows)).toEqual(["#41", "#42", "#43"]);
    // Two more open/merged rows and two closed ones can all fold, so they fold together (Linear's `yg`).
    expect(await page.eval(`${section}.querySelector('[data-show-more]').textContent`)).toBe("Show 4 more");
    await page.click(".issue-detail-properties [data-show-more]");
    await page.waitFor(`${rows}.length===7`);
    expect(await page.eval(rows)).toEqual(["#41", "#42", "#43", "#44", "#45", "#46", "#47"]);
    expect(await page.eval(`${section}.querySelector('[data-show-more]').textContent`)).toBe("Show less");
  });

  await test.step("an open row with a review carries its mark; the row is a 28px link that opens the pull request in a new tab", async () => {
    const row = (n: string) => `${section}.querySelector('[data-pull-request-row="${n}"] a')`;
    expect(
      await page.eval(
        `[${row("#41")}.getAttribute('aria-label'),${row("#41")}.querySelector('[data-review-status]')?.dataset.reviewStatus,${row("#42")}.querySelector('[data-review-status]')?.dataset.reviewStatus,!!${row("#44")}.querySelector('[data-review-status]'),${row("#41")}.target,${row("#41")}.getBoundingClientRect().height]`,
      ),
    ).toEqual(["Queue the save, Changes requested", "blocked", "approved", false, "_blank", 28]);
    // Linear's trailing chevron shows only while the row is hovered.
    const go = `${row("#44")}.querySelector('.issue-pull-request-go')`;
    expect(await page.eval(`getComputedStyle(${go}).opacity`)).toBe("0");
    await page.hover('[data-pull-request-row="#44"] a');
    await page.waitFor(`getComputedStyle(${go}).opacity==="1"`);
  });

  await test.step("resting on a row for 150ms shows Linear's pull request card on its left", async () => {
    const r = await page.rect('[data-pull-request-row="#41"] a');
    await page.page.mouse.move(1, 1);
    await page.page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    const card = `document.querySelector('[data-hover-card="Pull request"]')`;
    await page.waitFor(`${card}?.textContent.includes("Queue the save")`, 450);
    const box = await page.eval<DOMRect>(`${card}.getBoundingClientRect().toJSON()`);
    expect(box.right).toBeLessThanOrEqual(r.x);
    expect(await page.eval(`${card}.textContent`)).toContain("app#41");
  });

  await test.step("moving to the next row swaps the card: only the hovered row's card is ever open (the tooltip core's one-open rule)", async () => {
    const cards = `[...document.querySelectorAll('[data-hover-card="Pull request"]')].map(c=>c.textContent.includes("app#42")?"#42":"#41")`;
    const next = await page.rect('[data-pull-request-row="#42"] a');
    // Straight down from #41's card to #42, the path that left both cards stacked (DRFT-929).
    await page.page.mouse.move(next.x + next.width / 2, next.y + next.height / 2, { steps: 6 });
    await page.waitFor(`${cards}.join()==="#42"`, 450);
    for (let i = 0; i < 5; i++) {
      expect(await page.eval<string[]>(cards)).toEqual(["#42"]);
      await page.page.waitForTimeout(60);
    }
    // A title's tooltip takes over from the card, never beside it.
    await page.hover('[title="Copy git branch name (⇧ ⌘ .)"]');
    await page.waitFor(`!!document.querySelector('.app-tooltip')`, 2000);
    expect(await page.eval(`document.querySelectorAll('[data-hover-card],.app-tooltip').length`)).toBe(1);
    await page.page.mouse.move(1, 1);
  });

  await test.step("right-click opens Linear's pull request menu; Open in GitHub opens it", async () => {
    const r = await page.rect('[data-pull-request-row="#42"] a');
    await page.page.mouse.click(r.x + 10, r.y + r.height / 2, { button: "right" });
    const menu = page.page.locator('[role="dialog"][aria-label="Pull request options"]');
    await expect(menu).toBeVisible();
    expect(await menu.locator("[cmdk-item]").allTextContents()).toEqual(["Open in GitHub", "Copy"]);
    await menu.locator('[cmdk-item][data-value="Open in GitHub"]').click();
    await expect.poll(() => page.eval<string[]>("window.__opened")).toEqual(["https://github.com/example/app/pull/42"]);
  });
});

test("BJ-253: the side panel shows the issue's pull requests too, and an issue with none shows no Diffs section", async ({ open }) => {
  const page = await open("?issue=TEST-2&view=side", { setup: sidebarPrSetup });
  await page.waitFor(`!!document.querySelector('[data-pull-request-row="#41"]')`);
  await page.key("j");
  await page.waitFor(`!document.querySelector('[data-pull-request-row]')`);
  expect(await page.eval(`[...document.querySelectorAll('h3')].some(h=>h.textContent==='Diffs')`)).toBe(false);
});
