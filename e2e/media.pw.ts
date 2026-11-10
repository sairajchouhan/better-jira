import { readFileSync } from "node:fs";
import { expect, test, sleep, fixture, type App as Page } from "./app";

const media = (patch: object = {}) => fixture.reset({ includeMedia: true, ...patch });
const video = `document.querySelector('#description video')`;
const image = `document.querySelector('#description img')`;
async function mediaIssue(page: Page, key = "TEST-1") {
  await page.click(`[data-key="${key}"]`);
  await page.waitFor(`${video}?.readyState>=1`, 15000);
}

test("Jira media: nothing fetched for the board, exact attachments and byte ranges in the issue, isolated comment media", async ({
  open,
}) => {
  await media({ mediaInComment: true });
  const page = await open();
  await test.step("board loading with real media available does not resolve or fetch attachments", async () => {
    await page.hover('[data-key="TEST-2"]');
    // No media request may start within this window.
    await sleep(400);
    const log = await fixture.log();
    expect(log.requests.some((r) => r.path === "/api/issues")).toBe(true);
    expect(log.requests.some((r) => /\/media\/|\/attachments\/|\/upstream\//.test(r.path))).toBe(
      false,
    );
  });
  await test.step("Jira media uses exact UUID mapping and local byte ranges, inside the description", async () => {
    await mediaIssue(page);
    expect(await page.eval(`${video}.getAttribute('src')`)).toBe(
      "/api/issues/TEST-1/attachments/101",
    );
    expect(await page.eval(`${video}.duration`)).toBeCloseTo(4, 0);
    expect(await page.eval(`${video}.videoWidth/${video}.videoHeight`)).toBe(3);
    await page.waitFor(`${image}?.naturalWidth===320`);
    expect(await page.eval(`${image}.naturalHeight`)).toBe(480);
    expect(await page.eval(`${image}.getAttribute('src')`)).toBe(
      "/api/issues/TEST-1/attachments/102",
    );
    expect(
      await page.eval(
        `document.querySelector('#description [data-attachment-id="103"]').textContent`,
      ),
    ).toContain("media-file.txt");
    expect(
      await page.eval(
        `document.getElementById('description').textContent.includes('[mediaSingle]')`,
      ),
    ).toBe(false);
    await page.eval(`(()=>{const video=${video};video.currentTime=3;return video.play()})()`);
    await page.waitFor(`${video}.currentTime>=3`);
    const log = await fixture.log();
    expect(
      log.requests.some((r) => r.path === "/api/issues/TEST-1/attachments/101" && r.status === 206),
    ).toBe(true);
    expect(
      log.requests.some((r) => r.path.startsWith("/upstream/attachment/101?range=bytes=")),
    ).toBe(true);
    expect(log.requests.some((r) => r.method !== "GET")).toBe(false);
  });
  await test.step("clicking an image selects its ADF atom, Backspace deletes it and undo restores it", async () => {
    await page.click("#description img");
    await page.waitFor(
      `!!document.querySelector('#description .ProseMirror-selectednode')&&document.activeElement===document.getElementById('description')`,
    );
    await page.key("Backspace");
    await page.waitFor(`!${image}`);
    await page.key("z", "meta");
    await page.waitFor(`${image}?.naturalWidth===320`);
    expect(await page.eval(`document.querySelectorAll('#description img').length`)).toBe(1);
  });
  await test.step("comment media on a middle issue isolates navigation and commands, while Space actually plays", async () => {
    await mediaIssue(page, "TEST-2");
    const commentVideo = `document.querySelector('[data-comment="jira-media-comment"] video')`;
    await page.waitFor(`${commentVideo}?.readyState>=1`, 15000);
    for (const key of ["j", "k", "p", "f", "m", "Escape"]) {
      await page.eval(`${commentVideo}.focus()`);
      await page.key(key);
      expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
      expect(
        await page.eval(
          `!!document.querySelector('[aria-label="Add Filter…"],[cmdk-input],[role=dialog]:not([data-video-player])')`,
        ),
      ).toBe(false);
    }
    await page.eval(
      `${commentVideo}.pause();${commentVideo}.currentTime=1;${commentVideo}.focus()`,
    );
    expect(await page.eval(`${commentVideo}.paused`)).toBe(true);
    await page.key(" ");
    await page.waitFor(`!${commentVideo}.paused&&${commentVideo}.currentTime>1`);
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  });
});

test("media failures: unresolved media, failed bytes and unmapped media show their state and recover", async ({
  open,
}) => {
  await test.step("media resolution errors are visible and retry recovers without an issue reload", async () => {
    await media({ mediaFailure: 503 });
    const page = await open();
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(
      `document.querySelector('#description [role=alert]')?.textContent.includes('Could not load attachment')`,
    );
    expect(await page.eval(`!!${video}`)).toBe(false);
    await media();
    await page.click("text=Retry attachment");
    await page.waitFor(`${video}?.readyState>=1`, 15000);
  });
  await test.step("failed file bytes show a retry action and can recover", async () => {
    await media({ contentFailure: 503 });
    const page = await open();
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(`!!document.querySelector('#description [data-video-player] [role=alert]')`);
    await media();
    await page.click('#description [aria-label="Retry video"]');
    await page.waitFor(
      `${video}?.readyState>=1&&!document.querySelector('#description [data-video-player] [role=alert]')`,
      15000,
    );
  });
  await test.step("unmapped media shows an unavailable card rather than guessing another attachment", async () => {
    await media({ unmappedMedia: true });
    const page = await open();
    await mediaIssue(page);
    await page.waitFor(
      `document.querySelector('#description [role=alert]')?.textContent.includes('could not be found')`,
    );
    expect(await page.eval(`document.querySelectorAll('#description video').length`)).toBe(1);
    expect(await page.eval(`document.querySelectorAll('#description img').length`)).toBe(1);
  });
});

test("media layout: reserved space, native sizes, ADF widths and wraps, inline chips and external images", async ({
  open,
}) => {
  await test.step("ADF dimensions reserve media space before metadata and bytes arrive", async () => {
    await media({ mediaDelay: 1800 });
    const page = await open();
    await page.click('[data-key="TEST-1"]');
    await page.waitFor(
      `document.querySelectorAll('#description [data-media-interactive] [role=status]').length===3`,
    );
    const before = await page.eval<number>(
      `document.getElementById('description').getBoundingClientRect().height`,
    );
    await page.waitFor(`${video}?.readyState>=1&&${image}?.naturalWidth===320`, 15000);
    const after = await page.eval<number>(
      `document.getElementById('description').getBoundingClientRect().height`,
    );
    expect(Math.abs(after - before)).toBeLessThan(6);
  });
  await test.step("media without a saved width stays at native size and wrap leaves space for text", async () => {
    await media({ mediaVariant: "natural" });
    const page = await open("?issue=TEST-1&view=page");
    await page.waitFor(`${video}?.readyState>=1&&${image}?.naturalWidth===320`, 15000);
    const sizes = await page.eval<any>(
      `(()=>{const root=document.getElementById('description'),wrap=root.querySelector('[data-media-layout="wrap-left"]'),p=wrap.parentElement.nextElementSibling,range=document.createRange();range.setStart(p.firstChild,0);range.setEnd(p.firstChild,1);return {column:root.clientWidth,image:root.querySelector('img').getBoundingClientRect().width,video:root.querySelector('video').getBoundingClientRect().width,wrap:wrap.getBoundingClientRect().width,right:wrap.getBoundingClientRect().right,text:range.getBoundingClientRect().left}})()`,
    );
    expect(sizes.column).toBeGreaterThan(480);
    expect(sizes.image).toBeLessThanOrEqual(320);
    expect(sizes.video).toBeLessThanOrEqual(480);
    expect(sizes.wrap).toBe(320);
    expect(sizes.text).toBeGreaterThan(sizes.right);
  });
  await test.step("ADF width, wrap, filmstrip, inline chips and external images without CORS render correctly", async () => {
    await media({ mediaVariant: "layouts", mediaInComment: true });
    const page = await open();
    const failures: string[] = [],
      externalRequests: any[] = [];
    const bytes = Buffer.from(readFileSync("e2e/fixtures/media-image.png")).toString("base64");
    page.onEvent("Fetch.requestPaused", (params) => {
      externalRequests.push(params.request);
      void page
        .cmd("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "image/png" }],
          body: bytes,
        })
        .catch((error) => failures.push(String(error)));
    });
    await page.cmd("Fetch.enable", {
      patterns: [{ urlPattern: "https://images.example.test/*", requestStage: "Request" }],
    });
    await mediaIssue(page);
    await page.waitFor(`!!document.querySelector('#description [data-media-layout="wrap-left"]')`);
    const dimensions = await page.eval<any>(
      `(()=>{const root=document.getElementById('description'),wrap=root.querySelector('[data-media-layout="wrap-left"]'),pixel=root.querySelector('[data-media-layout="align-end"]'),wide=root.querySelector('[data-media-layout="wide"]'),full=root.querySelector('[data-media-layout="full-width"]');return {root:root.clientWidth,wrap:wrap.getBoundingClientRect().width,float:getComputedStyle(wrap.parentElement).float,pixel:pixel.getBoundingClientRect().width,wide:wide.getBoundingClientRect().width,full:full.getBoundingClientRect().width}})()`,
    );
    expect(dimensions.wrap / dimensions.root).toBeCloseTo(0.5, 1);
    expect(dimensions.float).toBe("left");
    expect(dimensions.pixel).toBe(160);
    expect(dimensions.wide).toBeGreaterThan(dimensions.root);
    expect(dimensions.full).toBeGreaterThan(dimensions.wide);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('#description .media-filmstrip')).display`,
      ),
    ).toBe("flex");
    const inline = `document.querySelector('[data-comment="jira-media-comment"] .media-inline')`;
    await page.waitFor(`${inline}?.textContent.includes('media-file.txt')`);
    expect(await page.eval(`${inline}.tagName`)).toBe("SPAN");
    expect(await page.eval(`!!${inline}.closest('p')?.querySelector('div')`)).toBe(false);
    const external = `document.querySelector('#description img[alt="External portrait"]')`;
    await page.waitFor(`!!${external}`);
    await page.eval(`${external}.scrollIntoView({block:'center'})`);
    await page.waitFor(`${external}.naturalWidth===320`, 15000);
    expect(await page.eval(`${external}.crossOrigin`)).toBe(null);
    expect(await page.eval(`${external}.referrerPolicy`)).toBe("no-referrer");
    expect(externalRequests.length).toBeGreaterThan(0);
    expect(
      externalRequests.every(
        (r) => !Object.keys(r.headers).some((k) => /^(authorization|referer)$/i.test(k)),
      ),
    ).toBe(true);
    expect(failures).toEqual([]);
  });
});

test("media editor hosts: a pending renderer chunk reserves height, node views update without remounting", async ({
  open,
}) => {
  await media();
  const page = await open();
  await test.step("the pending media renderer chunk reserves the same height as the loaded editor", async () => {
    let held: string | undefined;
    const failures: string[] = [];
    const { mediaChunk } = await (
      await fetch(`${fixture.url}__split-media-assets/manifest.json`)
    ).json();
    expect(mediaChunk).toBeDefined();
    page.onEvent("Fetch.requestPaused", (params) => {
      if (new URL(params.request.url).pathname.endsWith("/" + mediaChunk)) held = params.requestId;
      else
        void page
          .cmd("Fetch.continueRequest", { requestId: params.requestId })
          .catch((error) => failures.push(String(error)));
    });
    await page.cmd("Fetch.enable", {
      patterns: [{ urlPattern: "*", resourceType: "Script", requestStage: "Request" }],
    });
    await page.goto("/__split-media-assets/index.html");
    await page.waitFor(`!!document.querySelector('#context-editor [data-media-loading]')`);
    // The paused-request event can arrive after the placeholder renders when the machine is busy.
    await expect.poll(() => held, { timeout: 2000 }).toBeDefined();
    const before = await page.eval<number>(
      `document.getElementById('context-editor').getBoundingClientRect().height`,
    );
    expect(
      await page.eval(`!!document.querySelector('#context-editor [data-media-interactive]')`),
    ).toBe(false);
    await page.cmd("Fetch.continueRequest", { requestId: held });
    await page.cmd("Fetch.disable");
    await page.waitFor(`document.querySelector('#context-editor video')?.readyState>=1`, 15000);
    const after = await page.eval<number>(
      `document.getElementById('context-editor').getBoundingClientRect().height`,
    );
    expect(Math.abs(before - after)).toBeLessThan(2);
    expect(failures).toEqual([]);
  });
  await test.step("media node views receive attachment and issue-context updates without remounting the editor", async () => {
    await page.goto("/__editor-media-fixture");
    await page.waitFor(`document.querySelector('#context-editor video')?.readyState>=1`, 15000);
    await page.eval(`window.originalEditor=document.getElementById('context-editor');true`);
    await page.click("text=Load local attachment");
    await page.waitFor(`document.querySelector('#context-editor img')?.naturalWidth===320`);
    await page.click("text=Switch issue context");
    await page.waitFor(
      `document.querySelector('#context-editor video')?.getAttribute('src')==='/api/issues/TEST-2/attachments/101'`,
    );
    expect(
      await page.eval(`document.getElementById('context-editor')===window.originalEditor`),
    ).toBe(true);
    expect(await page.eval(`document.querySelector('#context-editor img').alt`)).toBe(
      "Updated local image",
    );
  });
});
