import { expect, test, sleep, fixture, fileHash, type App as Page, savedAs } from "./app";

const media = (patch: object = {}) =>
  fixture.reset({ includeMedia: true, mediaInComment: true, ...patch });
const root = "#description [data-video-player]";
const video = `document.querySelector('#description video')`;
const controlsOpacity = `getComputedStyle(document.querySelector('${root} .video-controls')).opacity`;
const issueParam = `new URLSearchParams(location.search).get('issue')`;
const recovered = `${video}?.readyState>=1&&!document.querySelector('${root} [role=alert]')`;

/** Opens TEST-2, whose description holds the video, and points at the video so its controls show. */
async function player(open: () => Promise<Page>) {
  const page = await open();
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`${video}?.readyState>=1`, 15000);
  await page.hover("#description video");
  return page;
}

test("inline video player: Linear keys, volume, tooltips, revealed controls, download and selection", async ({
  open,
}) => {
  await media();
  const page = await player(open);
  await test.step("custom controls play, seek, mute, change volume and rate using Linear keys", async () => {
    await page.waitFor(
      `!!document.querySelector('${root} [aria-label="Play (keyboard shortcut k)"]')`,
    );
    expect(await page.eval(`${video}.controls`)).toBe(false);
    await page.click(`${root} [aria-label="Play (keyboard shortcut k)"]`);
    await page.waitFor(`!${video}.paused`);
    await page.key("k");
    await page.waitFor(`${video}.paused`);
    await page.key("m");
    expect(await page.eval(`${video}.muted`)).toBe(true);
    await page.key("m");
    expect(await page.eval(`${video}.muted`)).toBe(false);
    await page.hover(`${root} [aria-label="Mute (keyboard shortcut m)"]`);
    await page.click(`${root} [aria-label="Volume"]`);
    await page.key("ArrowDown");
    expect(await page.eval(`${video}.volume`)).toBeCloseTo(0.45, 2);
    await page.click(`${root} [aria-label="Seek slider"]`);
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(2, 0);
    await page.key("ArrowRight");
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(4, 0);
    await page.key("ArrowLeft");
    expect(await page.eval(`${video}.currentTime`)).toBe(0);
    await page.eval(`document.querySelector('${root} [aria-label="Seek slider"] input').focus()`);
    await page.key(">", "shift");
    expect(await page.eval(`${video}.playbackRate`)).toBe(1.25);
    expect(
      await page.eval(
        `document.querySelector('${root} [aria-label="Download"]').getAttribute('href')`,
      ),
    ).toBe("/api/issues/TEST-2/attachments/101?download=1");
    expect(await page.eval(issueParam)).toBe("TEST-2");
  });
  await test.step("volume uses a four pixel track, zero volume unmutes audibly, and rate arrows belong to the select", async () => {
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
    expect(await page.eval(`${video}.volume`)).toBe(0);
    await page.key("m");
    expect(await page.eval(`${video}.volume`)).toBeGreaterThan(0);
    expect(await page.eval(`${video}.muted`)).toBe(false);
    const before = await page.eval(`${video}.volume`);
    await page.eval(
      `window.rateArrowPrevented=null;document.querySelector('${root} select').addEventListener('keydown',e=>{window.rateArrowPrevented=e.defaultPrevented});document.querySelector('${root} select').focus()`,
    );
    await page.key("ArrowUp");
    expect(await page.eval(`${video}.volume`)).toBe(before);
    expect(await page.eval(`window.rateArrowPrevented`)).toBe(false);
  });
  await test.step("video controls show the app's one tooltip (Linear's `$` title and key), not one of their own", async () => {
    const play = `${root} [aria-label="Play (keyboard shortcut k)"]`;
    await page.hover(play);
    await page.waitFor(`document.querySelector('.app-tooltip')?.textContent==='PlaySpace'`, 2000);
    expect(
      await page.eval(
        `(()=>{const b=document.querySelector('${play}'),t=document.querySelector('.app-tooltip').getBoundingClientRect(),r=b.getBoundingClientRect();return [b.hasAttribute('title'),b.dataset.title,b.querySelectorAll('[role=tooltip]').length,document.querySelectorAll('[role=tooltip]').length,Math.round(t.top-r.bottom)]})()`,
      ),
    ).toEqual([false, "Play (Space)", 0, 1, 8]);
    // Linear's speed control is "Playback speed" with < and > (OWe).
    await page.hover(`${root} select`);
    await page.waitFor(`document.querySelector('.app-tooltip')?.textContent==='Playback speed<>'`, 2000);
    expect(await page.eval(`document.querySelectorAll('[role=tooltip]').length`)).toBe(1);
    await page.hover(`${root} [aria-label="Download"]`);
    await page.waitFor(`document.querySelector('.app-tooltip')?.textContent==='Download'`, 2000);
  });
  await test.step("keyboard focus arriving from outside or returning from full window stays visible while idle", async () => {
    await page.hover("#description video");
    await page.eval(`document.querySelector('#description [data-attachment-id="103"] [aria-label="Copy link"]').focus()`);
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    // Longer than the 2.5 s idle hide: the controls must still show.
    await sleep(3100);
    expect(await page.eval(controlsOpacity)).toBe("1");
    await page.key("f");
    await page.key("Escape");
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    await sleep(3100);
    expect(await page.eval(controlsOpacity)).toBe("1");
  });
  await test.step("media controls reveal on hover, hide on exit and keep command search available", async () => {
    await page.eval(`document.activeElement.blur()`); // keyboard focus in the player pins its controls
    await page.hover(root);
    await page.waitFor(`${controlsOpacity}==='1'`);
    await page.hover('[data-comment="jira-media-comment"]');
    await page.waitFor(`${controlsOpacity}==='0'`);
    await page.eval(`${video}.focus()`);
    await page.key("k", "meta");
    await page.waitFor(`!!document.querySelector('.menu-input input')`);
    await page.key("Escape");
    await page.hover("#description video");
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.key("k", "meta");
    await page.waitFor(
      `!!document.querySelector('.menu-input input')&&!document.querySelector('${root}[data-expanded="true"]')`,
    );
    expect(await page.eval(`document.activeElement.matches('.menu-input input')`)).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('.menu-input input')`);
  });
  await test.step("pointer focus does not pin controls, expanded idle hides, and Tab reveals them", async () => {
    await page.hover("#description video");
    await page.click(`${root} [aria-label="Play (keyboard shortcut k)"]`);
    await page.hover('[data-comment="jira-media-comment"]');
    await page.waitFor(`${controlsOpacity}==='0'`);
    await page.hover(root);
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.waitFor(`${controlsOpacity}==='0'`, 5000);
    expect(
      await page.eval(`getComputedStyle(document.querySelector('${root} .video-close')).opacity`),
    ).toBe("0");
    await page.key("Tab");
    await page.waitFor(`${controlsOpacity}==='1'`);
    await page.key("Escape");
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')!=='true'`);
  });
  await test.step("Download saves the actual video with its attachment filename and bytes", async () => {
    await page.hover("#description video");
    const download = page.page.waitForEvent("download");
    await page.click(`${root} [aria-label="Download"]`);
    const path = await savedAs(download, "media-video.mp4");
    expect(fileHash(path)).toBe(fileHash("e2e/fixtures/media-video.mp4"));
    expect(await page.eval(issueParam)).toBe("TEST-2");
  });
  await test.step("video selection handle selects the ADF atom so Backspace and undo work", async () => {
    await page.hover("#description video");
    await page.eval(`document.getElementById('description').focus()`);
    await page.click(`${root} [aria-label="Select video"]`);
    await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode')`);
    await page.key("Backspace");
    await page.waitFor(`!${video}`);
    await page.key("z", "meta");
    await page.waitFor(`${video}?.readyState>=1`, 15000);
  });
});

test("full window video: same element, contained focus, inert backdrop, picture-in-picture and Replay", async ({
  open,
}) => {
  await media();
  const page = await player(open);
  await test.step("expanded video keeps its element, position and rate and Escape returns focus without closing issue", async () => {
    await page.waitFor(`!!document.querySelector('${root}')`);
    await page.eval(
      `window.playerVideo=${video};window.playerVideo.currentTime=2;window.playerVideo.playbackRate=1.5;true`,
    );
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')==='true'`);
    expect(await page.eval(`${video}===window.playerVideo`)).toBe(true);
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(2, 0);
    await page.key("Escape");
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')!=='true'`);
    expect(await page.eval(`${video}.playbackRate`)).toBe(1.5);
    expect(await page.active()).toBe("Full window (keyboard shortcut f)");
    expect(await page.eval(issueParam)).toBe("TEST-2");
  });
  await test.step("expanded Tab and Shift Tab wrap at the first and last controls", async () => {
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.eval(
      `document.querySelector('${root} [aria-label="Exit full window (keyboard shortcut f)"]').focus()`,
    );
    await page.key("Tab");
    expect(await page.active()).toBe("Exit full window");
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Exit full window (keyboard shortcut f)");
    await page.key("Escape");
    await page.waitFor(`document.querySelector('${root}').getAttribute('data-expanded')!=='true'`);
  });
  await test.step("expanded backdrop clicks keep focus out of the description and typing never replaces the video", async () => {
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    for (const [x, y] of [
      [100, 100],
      [1300, 850],
    ]) {
      await page.clickAt(x!, y!);
      expect(
        await page.eval(`document.querySelector('${root}').contains(document.activeElement)`),
      ).toBe(true);
      expect(
        await page.eval(`!!document.querySelector('#description .ProseMirror-selectednode')`),
      ).toBe(false);
      const paused = await page.eval(`${video}.paused`);
      await page.key("k");
      await page.waitFor(`${video}.paused!==${paused}`);
      expect(await page.eval(`!!${video}`)).toBe(true);
      await page.key("x");
      expect(await page.eval(`!!${video}`)).toBe(true);
    }
    await page.key("Escape");
    expect(await page.eval(issueParam)).toBe("TEST-2");
  });
  await test.step("Shift Tab from the expanded background focuses the last control, and ended videos offer Replay", async () => {
    await page.hover("#description video");
    await page.click(`${root} [aria-label="Full window (keyboard shortcut f)"]`);
    await page.clickAt(100, 100);
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Exit full window (keyboard shortcut f)");
    await page.key("Escape");
    await page.eval(`(()=>{const v=${video};v.currentTime=3.9;return v.play()})()`);
    await page.waitFor(
      `!!document.querySelector('${root} [aria-label="Replay (keyboard shortcut k)"]')`,
    );
    await page.hover(root);
    await page.click(`${root} [aria-label="Replay (keyboard shortcut k)"]`);
    await page.waitFor(`!${video}.paused&&${video}.currentTime<1`);
  });
  await test.step("picture-in-picture returns the same video to its inline player", async () => {
    expect(await page.eval(`document.pictureInPictureEnabled`)).toBe(true);
    await page.eval(`window.inlineVideo=${video};true`);
    await page.hover("#description video");
    await page.click(`${root} [aria-label="Picture-in-Picture (keyboard shortcut p)"]`);
    await page.waitFor(`document.pictureInPictureElement===window.inlineVideo`, 10000);
    await page.click(`${root} .video-pip button`);
    await page.waitFor(`document.pictureInPictureElement===null`);
    expect(await page.eval(`${video}===window.inlineVideo`)).toBe(true);
  });
});

test("video failures: Jira denial, playback errors, stale diagnostics and broken re-reads all recover by retry", async ({
  open,
}) => {
  await media({ contentFailure: 401 });
  const page = await open();
  await test.step("expired Jira access has a useful video error and retry recovers", async () => {
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(
      `document.querySelector('${root} [role=alert]')?.textContent.includes('Jira denied access')`,
      15000,
    );
    await media();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(recovered, 15000);
  });
  await test.step("a playback failure retains the frame and retry restores position and preferences", async () => {
    await page.hover("#description video");
    await page.eval(
      `(()=>{const v=${video};v.currentTime=2;v.volume=.35;v.playbackRate=1.5;v.dispatchEvent(new Event('timeupdate'));v.dispatchEvent(new Event('error'));return true})()`,
    );
    await page.waitFor(`!!document.querySelector('${root} [role=alert]')`);
    expect(await page.eval(`!!${video}`)).toBe(true);
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(recovered, 15000);
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(2, 0);
    expect(await page.eval(`${video}.volume`)).toBeCloseTo(0.35, 2);
    expect(await page.eval(`${video}.playbackRate`)).toBe(1.5);
    await page.eval(`(()=>{const v=${video};v.currentTime=1;return v.play()})()`);
    await page.waitFor(`${video}.currentTime>1.1`);
    await page.eval(`${video}.dispatchEvent(new Event('error'))`);
    await page.waitFor(`!!document.querySelector('${root} [role=alert]')`);
    expect(await page.eval(`${video}.paused`)).toBe(true);
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(`!${video}.paused&&${video}.currentTime>1.1`, 15000);
    await page.eval(`${video}.pause()`);
  });
  await test.step("retry cancels a held diagnostic and a stale denied response cannot replace recovered playback", async () => {
    let held: any;
    let cancelled = false;
    await page.cmd("Network.enable");
    const stopFailed = page.onEvent("Network.loadingFailed", (params) => {
      if (params.requestId === held?.networkId && params.canceled) cancelled = true;
    });
    const stopPaused = page.onEvent("Fetch.requestPaused", (params) => {
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
    await page.eval(`${video}.dispatchEvent(new Event('error'))`);
    await expect.poll(() => held?.networkId).toBeDefined();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(recovered, 15000);
    await expect.poll(() => cancelled, { timeout: 1000 }).toBe(true);
    await page
      .cmd("Fetch.fulfillRequest", {
        requestId: held.requestId,
        responseCode: 403,
        body: btoa("denied"),
      })
      .catch(() => {});
    // The stale answer must not raise an error in this window.
    await sleep(300);
    expect(await page.eval(`!!document.querySelector('${root} [role=alert]')`)).toBe(false);
    stopFailed();
    stopPaused();
    await page.cmd("Fetch.disable");
  });
  await test.step("a failed HTTP re-read after playback reports a real MediaError and retry restores position", async () => {
    await page.eval(`(()=>{const v=${video};v.playbackRate=1;v.currentTime=0;return v.play()})()`);
    await page.waitFor(`${video}.currentTime>1`);
    const before = await page.eval<number>(`${video}.currentTime`);
    await media({ contentFailure: 503 });
    const reset = await page.eval<any>(
      `(()=>{const v=${video};v.src=v.getAttribute('src')+'?network-failure=1';v.load();const state={ready:v.readyState,time:v.currentTime};v.dispatchEvent(new Event('timeupdate'));return state})()`,
    );
    expect(reset).toEqual({ ready: 0, time: 0 });
    await page.waitFor(`!!${video}.error&&!!document.querySelector('${root} [role=alert]')`, 15000);
    expect(await page.eval(`${video}.error.code`)).toBeGreaterThan(0);
    await media();
    await page.click(`${root} [aria-label="Retry video"]`);
    await page.waitFor(`!${video}.error&&${recovered}`, 15000);
    expect(await page.eval(`${video}.currentTime`)).toBeGreaterThan(before - 0.3);
  });
  await test.step("error actions are clickable and small filmstrip errors fit inside their frame", async () => {
    await media({ contentFailure: 503 });
    const page = await open();
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`!!document.querySelector('${root} .video-error')`);
    await page.hover(root);
    expect(await page.eval(`!!document.querySelector('${root} .video-controls')`)).toBe(false);
    expect(
      await page.eval(
        `(()=>{const a=document.querySelector('${root} .video-error a');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()`,
      ),
    ).toBe(true);
    await media();
    const download = page.page.waitForEvent("download");
    await page.click(`${root} .video-error a`);
    expect(fileHash(await savedAs(download, "media-video.mp4"))).toBe(
      fileHash("e2e/fixtures/media-video.mp4"),
    );
    await media({ mediaVariant: "layouts", contentFailure: 503 });
    await page.reload();
    const small = "#description .media-filmstrip [data-video-player]";
    await page.waitFor(`!!document.querySelector('${small} .video-error')`);
    expect(
      await page.eval(
        `(()=>{const a=document.querySelector('${small} .video-error a');a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect(),frame=document.querySelector('${small}').getBoundingClientRect();return r.top>=frame.top&&r.bottom<=frame.bottom&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===a})()`,
      ),
    ).toBe(true);
  });
});

test("video in other hosts and lengths: scroll lock in a scrollable host, five second seeks", async ({
  open,
}) => {
  await test.step("expanded player locks a scrollable host and restores scrolling on exit", async () => {
    await media();
    const page = await open("/__editor-media-fixture");
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
    // The wheel must not scroll the locked host in this window.
    await sleep(200);
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
  });
  await test.step("seek arrows move exactly five seconds away from the ends of a longer video", async () => {
    await media({ mediaVariant: "long" });
    const page = await open();
    await page.click('[data-key="TEST-2"]');
    await page.waitFor(`${video}?.duration>=30`, 15000);
    await page.eval(`${video}.currentTime=12;${video}.focus()`);
    await page.key("ArrowRight");
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(17, 1);
    await page.key("ArrowLeft");
    expect(await page.eval(`${video}.currentTime`)).toBeCloseTo(12, 1);
  });
});
