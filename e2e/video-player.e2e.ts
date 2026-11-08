import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
afterAll(stop);
const configure = (patch: object = {}) =>
  fetch(`${APP}__fixture`, {
    method: "POST",
    body: JSON.stringify({ includeMedia: true, mediaInComment: true, ...patch }),
  });
async function player(page: Awaited<ReturnType<typeof open>>) {
  await configure();
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
  await page.hover("#description video");
}
const root = "#description [data-video-player]";

test("custom video controls play, seek, mute, change volume and rate using Linear keys", async () => {
  const page = await open();
  try {
    await player(page);
    await page.waitFor(
      `!!document.querySelector('${root} [aria-label="Play (keyboard shortcut k)"]')`,
    );
    expect(await page.eval(`document.querySelector('#description video').controls`)).toBe(false);
    await page.click(`${root} [aria-label="Play (keyboard shortcut k)"]`);
    await page.waitFor(`!document.querySelector('#description video').paused`);
    await page.key("k");
    await page.waitFor(`document.querySelector('#description video').paused`);
    await page.key("m");
    expect(await page.eval(`document.querySelector('#description video').muted`)).toBe(true);
    await page.key("m");
    expect(await page.eval(`document.querySelector('#description video').muted`)).toBe(false);
    await page.hover(`${root} [aria-label="Mute (keyboard shortcut m)"]`);
    await page.click(`${root} [aria-label="Volume"]`);
    await page.key("ArrowDown");
    expect(await page.eval(`document.querySelector('#description video').volume`)).toBeCloseTo(
      0.45,
      2,
    );
    await page.click(`${root} [aria-label="Seek slider"]`);
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      2,
      0,
    );
    await page.key("ArrowRight");
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      4,
      0,
    );
    await page.key("ArrowLeft");
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBe(0);
    await page.eval(`document.querySelector('${root} [aria-label="Seek slider"]').focus()`);
    await page.key(">", "shift");
    expect(await page.eval(`document.querySelector('#description video').playbackRate`)).toBe(1.25);
    expect(
      await page.eval(
        `document.querySelector('${root} [aria-label="Download"]').getAttribute('href')`,
      ),
    ).toBe("/api/issues/TEST-2/attachments/101?download=1");
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("expanded video keeps its element, position and rate and Escape returns focus without closing issue", async () => {
  const page = await open();
  try {
    await player(page);
    await page.waitFor(`!!document.querySelector('${root}')`);
    await page.eval(
      `window.playerVideo=document.querySelector('#description video');window.playerVideo.currentTime=2;window.playerVideo.playbackRate=1.5;true`,
    );
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')==='true'`);
    expect(
      await page.eval(`document.querySelector('#description video')===window.playerVideo`),
    ).toBe(true);
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      2,
      0,
    );
    await page.key("Escape");
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')!=='true'`);
    expect(await page.eval(`document.querySelector('#description video').playbackRate`)).toBe(1.5);
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("video selection handle selects the ADF atom so Backspace and undo work", async () => {
  const page = await open();
  try {
    await player(page);
    await page.eval(`document.getElementById('description').focus()`);
    await page.click(`${root} [aria-label="Select video"]`);
    await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode')`);
    await page.key("Backspace");
    await page.waitFor(`!document.querySelector('#description video')`);
    await page.key("z", "meta");
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("a playback failure retains the frame and retry restores position and preferences", async () => {
  const page = await open();
  try {
    await player(page);
    await page.waitFor(`!!document.querySelector('${root}')`);
    await page.eval(
      `(()=>{const v=document.querySelector('#description video');v.currentTime=2;v.volume=.35;v.playbackRate=1.5;v.dispatchEvent(new Event('timeupdate'));v.dispatchEvent(new Event('error'));return true})()`,
    );
    await page.waitFor(`!!document.querySelector('${root} [role=alert]')`);
    expect(await page.eval(`!!document.querySelector('#description video')`)).toBe(true);
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(
      `document.querySelector('#description video')?.readyState>=1&&!document.querySelector('${root} [role=alert]')`,
      15000,
    );
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      2,
      0,
    );
    expect(await page.eval(`document.querySelector('#description video').volume`)).toBeCloseTo(
      0.35,
      2,
    );
    expect(await page.eval(`document.querySelector('#description video').playbackRate`)).toBe(1.5);
    await page.eval(
      `(()=>{const v=document.querySelector('#description video');v.currentTime=1;return v.play()})()`,
    );
    await page.waitFor(`document.querySelector('#description video').currentTime>1.1`);
    await page.eval(
      `document.querySelector('#description video').dispatchEvent(new Event('error'))`,
    );
    await page.waitFor(`!!document.querySelector('${root} [role=alert]')`);
    expect(await page.eval(`document.querySelector('#description video').paused`)).toBe(true);
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(
      `!document.querySelector('#description video').paused&&document.querySelector('#description video').currentTime>1.1`,
      15000,
    );
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("media controls reveal on hover, hide on exit and keep command search available", async () => {
  const page = await open();
  try {
    await player(page);
    await page.hover(root);
    await page.waitFor(
      `getComputedStyle(document.querySelector('${root} .video-controls')).opacity==='1'`,
    );
    await page.hover('[data-comment="jira-media-comment"]');
    await Bun.sleep(200);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('${root} .video-controls')).opacity`,
      ),
    ).toBe("0");
    await page.eval(`document.querySelector('#description video').focus()`);
    await page.key("k", "meta");
    await page.waitFor(`!!document.querySelector('[cmdk-input]')`);
    await page.key("Escape");
    await page.hover("#description video");
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.key("k", "meta");
    await page.waitFor(
      `!!document.querySelector('[cmdk-input]')&&!document.querySelector('${root}[data-expanded="true"]')`,
    );
    expect(await page.eval(`document.activeElement.hasAttribute('cmdk-input')`)).toBe(true);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("expired Jira access has a useful video error and retry recovers", async () => {
  const page = await open();
  try {
    await configure({ contentFailure: 401 });
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(
      `document.querySelector('${root} [role=alert]')?.textContent.includes('Jira denied access')`,
      15000,
    );
    await configure();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(
      `document.querySelector('#description video')?.readyState>=1&&!document.querySelector('${root} [role=alert]')`,
      15000,
    );
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("picture-in-picture returns the same video to its inline player", async () => {
  const page = await open();
  try {
    await player(page);
    expect(await page.eval(`document.pictureInPictureEnabled`)).toBe(true);
    await page.eval(`window.inlineVideo=document.querySelector('#description video');true`);
    await page.click(`${root} [aria-label="Picture-in-Picture (keyboard shortcut p)"]`);
    await page.waitFor(`document.pictureInPictureElement===window.inlineVideo`, 10000);
    await page.click(`${root} .video-pip button`);
    await page.waitFor(`document.pictureInPictureElement===null`);
    expect(
      await page.eval(`document.querySelector('#description video')===window.inlineVideo`),
    ).toBe(true);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("Download saves the actual video with its attachment filename and bytes", async () => {
  const page = await open(),
    dir = await mkdtemp(join(tmpdir(), "better-jira-download-"));
  try {
    await player(page);
    await page.cmd("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    await page.click(`${root} [aria-label="Download"]`);
    const path = join(dir, "media-video.mp4");
    for (let attempt = 0; attempt < 100 && !(await Bun.file(path).exists()); attempt++)
      await Bun.sleep(40);
    expect(await Bun.file(path).exists()).toBe(true);
    expect(Bun.hash(await Bun.file(path).arrayBuffer())).toBe(
      Bun.hash(await Bun.file("e2e/fixtures/media-video.mp4").arrayBuffer()),
    );
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
    await rm(dir, { recursive: true });
  }
});

test("expanded backdrop clicks keep focus out of the description and typing never replaces the video", async () => {
  const page = await open();
  try {
    await player(page);
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    for (const point of [
      [100, 100],
      [1300, 850],
    ]) {
      await page.clickAt(point[0]!, point[1]!);
      expect(
        await page.eval(`document.querySelector('${root}').contains(document.activeElement)`),
      ).toBe(true);
      expect(
        await page.eval(`!!document.querySelector('#description .ProseMirror-selectednode')`),
      ).toBe(false);
      const paused = await page.eval(`document.querySelector('#description video').paused`);
      await page.key("k");
      await page.waitFor(`document.querySelector('#description video').paused!==${paused}`);
      expect(await page.eval(`!!document.querySelector('#description video')`)).toBe(true);
      await page.key("x");
      expect(await page.eval(`!!document.querySelector('#description video')`)).toBe(true);
    }
    await page.key("Escape");
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("pointer focus does not pin controls, expanded idle hides, and Tab reveals them", async () => {
  const page = await open();
  try {
    await player(page);
    await page.click(`${root} [aria-label="Play (keyboard shortcut k)"]`);
    await page.hover('[data-comment="jira-media-comment"]');
    await page.waitFor(
      `getComputedStyle(document.querySelector('${root} .video-controls')).opacity==='0'`,
    );
    await page.hover(root);
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.waitFor(
      `getComputedStyle(document.querySelector('${root} .video-controls')).opacity==='0'`,
      5000,
    );
    expect(
      await page.eval(`getComputedStyle(document.querySelector('${root} .video-close')).opacity`),
    ).toBe("0");
    await page.key("Tab");
    await page.waitFor(
      `getComputedStyle(document.querySelector('${root} .video-controls')).opacity==='1'`,
    );
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("error actions are clickable and small filmstrip errors fit inside their frame", async () => {
  const page = await open(),
    dir = await mkdtemp(join(tmpdir(), "better-jira-error-download-"));
  try {
    await configure({ contentFailure: 503 });
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.querySelector('${root} .video-error')`);
    await page.hover(root);
    expect(await page.eval(`!!document.querySelector('${root} .video-controls')`)).toBe(false);
    const hit = () =>
      page.eval<boolean>(
        `(()=>{const a=document.querySelector('${root} .video-error a');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()`,
      );
    expect(await hit()).toBe(true);
    await configure();
    await page.cmd("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    await page.click(`${root} .video-error a`);
    for (let n = 0; n < 100 && !(await Bun.file(join(dir, "media-video.mp4")).exists()); n++)
      await Bun.sleep(40);
    expect(Bun.hash(await Bun.file(join(dir, "media-video.mp4")).arrayBuffer())).toBe(
      Bun.hash(await Bun.file("e2e/fixtures/media-video.mp4").arrayBuffer()),
    );
    await configure({ mediaVariant: "layouts", contentFailure: 503 });
    await page.reload();
    const small = "#description .media-filmstrip [data-video-player]";
    await page.waitFor(`!!document.querySelector('${small} .video-error')`);
    expect(
      await page.eval(
        `(()=>{const a=document.querySelector('${small} .video-error a');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect(),frame=document.querySelector('${small}').getBoundingClientRect();return r.top>=frame.top&&r.bottom<=frame.bottom&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()`,
      ),
    ).toBe(true);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
    await rm(dir, { recursive: true });
  }
});

test("volume uses a four pixel track, zero volume unmutes audibly, and rate arrows belong to the select", async () => {
  const page = await open();
  try {
    await player(page);
    await page.hover(`${root} [aria-label="Mute (keyboard shortcut m)"]`);
    const track = await page.rect(`${root} [aria-label="Volume"]`);
    expect(track.width).toBe(4);
    expect(track.height).toBe(56);
    await page.eval(
      `document.querySelector('${root} [aria-label="Mute (keyboard shortcut m)"]').focus()`,
    );
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('#description').closest('.rich-editor').querySelector('[role=toolbar]')).display`,
      ),
    ).toBe("none");
    await page.click(`${root} [aria-label="Volume"]`);
    await page.key("ArrowDown");
    for (let n = 0; n < 20; n++) await page.key("ArrowDown");
    expect(await page.eval(`document.querySelector('#description video').volume`)).toBe(0);
    await page.key("m");
    expect(await page.eval(`document.querySelector('#description video').volume`)).toBeGreaterThan(
      0,
    );
    expect(await page.eval(`document.querySelector('#description video').muted`)).toBe(false);
    const before = await page.eval(`document.querySelector('#description video').volume`);
    await page.eval(
      `window.rateArrowPrevented=null;document.querySelector('${root} select').addEventListener('keydown',e=>{window.rateArrowPrevented=e.defaultPrevented});document.querySelector('${root} select').focus()`,
    );
    await page.key("ArrowUp");
    expect(await page.eval(`document.querySelector('#description video').volume`)).toBe(before);
    expect(await page.eval(`window.rateArrowPrevented`)).toBe(false);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("expanded Tab and Shift Tab wrap at the first and last controls", async () => {
  const page = await open();
  try {
    await player(page);
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.eval(
      `document.querySelector('${root} [aria-label="Exit full window (keyboard shortcut f)"]').focus()`,
    );
    await page.key("Tab");
    expect(await page.active()).toBe("Exit full window");
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Exit full window (keyboard shortcut f)");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("expanded player locks a scrollable host and restores scrolling on exit", async () => {
  const page = await open();
  try {
    await configure();
    await page.goto("/__editor-media-fixture");
    await page.waitFor(`document.querySelector('#context-editor video')?.readyState>=1`, 15000);
    await page.eval(
      `document.body.style.minHeight='300vh';document.body.style.overflow='auto';window.scrollTo(0,40)`,
    );
    await page.hover("#context-editor video");
    await page.click('#context-editor [aria-label="Full window (keyboard shortcut f)"]');
    const before = await page.eval<number>("window.scrollY");
    await page.cmd("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 100,
      deltaY: 400,
      deltaX: 0,
    });
    await Bun.sleep(200);
    expect(await page.eval<number>("window.scrollY")).toBe(before);
    await page.key("Escape");
    expect(await page.eval(`document.body.style.overflow`)).toBe("auto");
    await page.cmd("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 100,
      y: 800,
      deltaY: 400,
      deltaX: 0,
    });
    await page.waitFor(`window.scrollY>${before}`);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("seek arrows move exactly five seconds away from the ends of a longer video", async () => {
  const page = await open();
  try {
    await configure({ mediaVariant: "long" });
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`document.querySelector('#description video')?.duration>=30`, 15000);
    await page.eval(
      `document.querySelector('#description video').currentTime=12;document.querySelector('#description video').focus()`,
    );
    await page.key("ArrowRight");
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      17,
      1,
    );
    await page.key("ArrowLeft");
    expect(await page.eval(`document.querySelector('#description video').currentTime`)).toBeCloseTo(
      12,
      1,
    );
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("retry cancels a held diagnostic and a stale denied response cannot replace recovered playback", async () => {
  const page = await open();
  let held: any;
  let cancelled = false;
  try {
    await player(page);
    await page.cmd("Network.enable");
    page.onEvent("Network.loadingFailed", (params) => {
      if (params.requestId === held?.networkId && params.canceled) cancelled = true;
    });
    page.onEvent("Fetch.requestPaused", (params) => {
      if (
        Object.entries(params.request.headers).some(
          ([key, value]) => key.toLowerCase() === "range" && value === "bytes=0-0",
        )
      )
        held = params;
      else void page.cmd("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
    });
    await page.cmd("Fetch.enable", {
      patterns: [{ urlPattern: "*/api/issues/*/attachments/101*", requestStage: "Request" }],
    });
    await page.eval(
      `document.querySelector('#description video').dispatchEvent(new Event('error'))`,
    );
    for (let n = 0; n < 100 && !held; n++) await Bun.sleep(40);
    expect(held?.networkId).toBeDefined();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(
      `document.querySelector('#description video')?.readyState>=1&&!document.querySelector('${root} [role=alert]')`,
      15000,
    );
    for (let n = 0; n < 25 && !cancelled; n++) await Bun.sleep(40);
    expect(cancelled).toBe(true);
    await page
      .cmd("Fetch.fulfillRequest", {
        requestId: held.requestId,
        responseCode: 403,
        body: btoa("denied"),
      })
      .catch(() => {});
    held = undefined;
    await Bun.sleep(300);
    expect(await page.eval(`!!document.querySelector('${root} [role=alert]')`)).toBe(false);
  } finally {
    if (held)
      await page
        .cmd("Fetch.failRequest", { requestId: held.requestId, errorReason: "Aborted" })
        .catch(() => {});
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("a failed HTTP re-read after playback reports a real MediaError and retry restores position", async () => {
  const page = await open();
  try {
    await configure();
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`document.querySelector('#description video')?.readyState>=1`, 15000);
    await page.eval(`document.querySelector('#description video').play()`);
    await page.waitFor(`document.querySelector('#description video').currentTime>1`);
    const before = await page.eval<number>(
      `document.querySelector('#description video').currentTime`,
    );
    await configure({ contentFailure: 503 });
    const reset = await page.eval<any>(
      `(()=>{const v=document.querySelector('#description video');v.src=v.getAttribute('src')+'?network-failure=1';v.load();const state={ready:v.readyState,time:v.currentTime};v.dispatchEvent(new Event('timeupdate'));return state})()`,
    );
    expect(reset).toEqual({ ready: 0, time: 0 });
    await page.waitFor(
      `!!document.querySelector('#description video').error&&!!document.querySelector('${root} [role=alert]')`,
      15000,
    );
    expect(
      await page.eval(`document.querySelector('#description video').error.code`),
    ).toBeGreaterThan(0);
    await configure();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(
      `!document.querySelector('#description video').error&&document.querySelector('#description video').readyState>=1&&!document.querySelector('${root} [role=alert]')`,
      15000,
    );
    expect(
      await page.eval(`document.querySelector('#description video').currentTime`),
    ).toBeGreaterThan(before - 0.3);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("video shortcut tooltips are styled and name the observed Space binding", async () => {
  const page = await open();
  try {
    await player(page);
    await page.hover(`${root} [aria-label="Play (keyboard shortcut k)"]`);
    const tooltip = `document.querySelector('${root} [aria-label="Play (keyboard shortcut k)"] [role=tooltip]')`;
    await page.waitFor(
      `getComputedStyle(${tooltip}).visibility==='visible'&&getComputedStyle(${tooltip}).opacity==='1'`,
    );
    expect(await page.eval(`${tooltip}.textContent`)).toBe("PlaySpace");
    expect(
      await page.eval(
        `document.querySelector('${root} [aria-label="Play (keyboard shortcut k)"]').hasAttribute('title')`,
      ),
    ).toBe(false);
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("keyboard focus arriving from outside or returning from full window stays visible while idle", async () => {
  const page = await open();
  try {
    await player(page);
    await page.eval(`document.querySelector('#description [data-attachment-id="103"]').focus()`);
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    await Bun.sleep(3100);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('${root} .video-controls')).opacity`,
      ),
    ).toBe("1");
    await page.key("f");
    await page.key("Escape");
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    await Bun.sleep(3100);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('${root} .video-controls')).opacity`,
      ),
    ).toBe("1");
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});

test("Shift Tab from the expanded background focuses the last control, and ended videos offer Replay", async () => {
  const page = await open();
  try {
    await player(page);
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.clickAt(100, 100);
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Exit full window (keyboard shortcut f)");
    await page.key("Escape");
    await page.eval(
      `(()=>{const v=document.querySelector('#description video');v.currentTime=3.9;return v.play()})()`,
    );
    await page.waitFor(
      `!!document.querySelector('${root} [aria-label="Replay (keyboard shortcut k)"]')`,
    );
    await page.hover(root);
    await page.click(`${root} [aria-label="Replay (keyboard shortcut k)"]`);
    await page.waitFor(
      `!document.querySelector('#description video').paused&&document.querySelector('#description video').currentTime<1`,
    );
  } finally {
    await configure({ includeMedia: false });
    await page.close();
  }
});
