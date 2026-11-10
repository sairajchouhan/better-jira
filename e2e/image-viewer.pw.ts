import { readFileSync } from "node:fs";
import { expect, test, sleep, fixture, type App as Page, savedAs } from "./app";

const media = (patch: object = {}) => fixture.reset({ includeMedia: true, ...patch });
const image = `document.querySelector('#description img')`;
const preview = `document.querySelector('[aria-label="Preview"] img')`;
const thread = `document.querySelector('[aria-label="Comment thread on image"]')`;
const saved = `document.querySelector('[aria-label="Local save status"]')?.textContent.includes('Saved')`;
const imageBytes = Buffer.from(readFileSync("e2e/fixtures/media-image.png")).toString("base64");

/** Opens TEST-2 from the board and waits for its description image. */
async function issueImage(page: Page) {
  await page.click('[data-key="TEST-2"]');
  await page.waitFor(`${image}?.naturalWidth===320`, 15000);
}

test("image preview: layered Escape, zoom, pan within edges, and copying link and PNG bytes", async ({
  open,
}) => {
  await media();
  const page = await open();
  await issueImage(page);
  await test.step("image preview opens without losing the issue, zooms, and Escape returns focus in layers", async () => {
    await page.click("#description img");
    await page.click('#description [aria-label="Full screen"]');
    await page.waitFor(`!!${preview}`);
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
    await page.key("Tab", "shift");
    expect(await page.active()).toBe("Close");
    await page.key("Tab");
    expect(await page.active()).toBe("Toggle image zoom");
    const before = await page.eval<number>(`${preview}.getBoundingClientRect().width`);
    await page.click('[aria-label="Toggle image zoom"]');
    expect(await page.eval<number>(`${preview}.getBoundingClientRect().width`)).toBeCloseTo(
      before * 2,
      0,
    );
    await page.key("Escape");
    expect(await page.eval(`!!document.querySelector('[aria-label="Preview"]')`)).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Preview"]')`);
    expect(await page.active()).toBe("Full screen");
  });
  await test.step("a zoomed image pans by dragging and by the wheel, stays within its edges, and Escape un-zooms it to the centre", async () => {
    await page.click("#description img");
    await page.click('#description [aria-label="Full screen"]');
    await page.waitFor(`${preview}?.naturalWidth===320`);
    const pan = `${preview}.style.transform`;
    expect(await page.eval(pan)).toBe("translate(0px, 0px)");
    // Not zoomed: dragging does nothing.
    const [x, y] = await page.eval<[number, number]>(
      `(()=>{const b=document.querySelector('.image-preview-stage img').getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]})()`,
    );
    await page.pointerDrag(x, y, x + 60, y + 40);
    expect(await page.eval(pan)).toBe("translate(0px, 0px)");
    const fit = await page.eval<string>(
      `document.querySelector('[aria-label="Toggle image zoom"]').textContent`,
    );
    await page.click('[aria-label="Toggle image zoom"]');
    await page.waitFor(
      `document.querySelector('[aria-label="Toggle image zoom"]').textContent!==${JSON.stringify(fit)}`,
    );
    await page.pointerDrag(x, y, x + 20, y + 12);
    expect(await page.eval(pan)).toBe("translate(20px, 12px)");
    await page.wheel(x, y, 10, -6);
    await page.waitFor(`${pan}==='translate(10px, 18px)'`);
    // A long drag stops at the edge allowance instead of throwing the image off screen.
    await page.pointerDrag(x, y, x + 900, y);
    const [px] = await page.eval<[number]>(`[parseFloat(${pan}.slice(10))]`);
    expect(px).toBeLessThan(900);
    expect(px).toBeGreaterThan(20);
    await page.key("Escape");
    await page.waitFor(
      `${pan}==='translate(0px, 0px)'&&!!document.querySelector('[aria-label="Preview"]')`,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Preview"]')`);
  });
  await test.step("image copy produces PNG bytes and copy-link contains the local proxy URL", async () => {
    await page.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.click("#description img");
    await page.click('#description [aria-label="Full screen"]');
    await page.click('[aria-label="Preview"] [aria-label="Copy link"]');
    await page.waitFor(
      `document.querySelector('.image-preview-notice')?.textContent==='Link copied'`,
    );
    expect(await page.eval(`navigator.clipboard.readText()`)).toBe(
      `${fixture.url}api/issues/TEST-2/attachments/102`,
    );
    await page.click('[aria-label="Preview"] [aria-label="Copy image"]');
    await page.waitFor(
      `document.querySelector('.image-preview-notice')?.textContent==='Image copied'`,
    );
    expect(
      await page.eval(
        `(async()=>{const items=await navigator.clipboard.read();const bitmap=await createImageBitmap(await items[0].getType('image/png'));const size=[bitmap.width,bitmap.height];bitmap.close();return size})()`,
      ),
    ).toEqual([320, 480]);
    await page.click('[aria-label="Preview"] [aria-label="Crop image"]');
    await page.click('[aria-label="Resize from top left"]');
    await page.key("ArrowRight");
    await page.click("text=Save");
    await page.waitFor(`${preview}?.naturalWidth===319`);
    await page.click('[aria-label="Preview"] [aria-label="Copy link"]');
    await page.waitFor(
      `document.querySelector('.image-preview-notice')?.textContent==='Link copied'`,
    );
    expect(await page.eval(`navigator.clipboard.readText()`)).toBe(
      `${fixture.url}api/issues/TEST-2/attachments/102`,
    );
    await page.click('[aria-label="Preview"] [aria-label="Copy image"]');
    await page.waitFor(
      `document.querySelector('.image-preview-notice')?.textContent==='Image copied'`,
    );
    expect(
      await page.eval(
        `(async()=>{const items=await navigator.clipboard.read();const bitmap=await createImageBitmap(await items[0].getType('image/png'));const width=bitmap.width;bitmap.close();return width})()`,
      ),
    ).toBe(319);
  });
});

test("image cropping: keyboard and pointer geometry, unreadable sources, local persistence and PNG downloads", async ({
  open,
}) => {
  await media();
  const page = await open();
  await issueImage(page);
  await test.step("keyboard and pointer cropping keep their geometry, and unreadable sources never save", async () => {
    await page.hover("#description img");
    await page.click('#description [aria-label="Crop image"]');
    await page.click('[aria-label="Resize from bottom right"]');
    await page.key("ArrowLeft", "shift");
    expect(
      await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.width)`),
    ).toBeCloseTo(100 - (10 / 320) * 100, 4);
    await page.key("Escape");
    await page.key("Escape");
    await page.hover("#description img");
    await page.click('#description [aria-label="Crop image"]');
    const handle = await page.rect('[aria-label="Resize from bottom right"]'),
      stage = await page.rect(".image-crop-stage");
    const x = handle.x + handle.width / 2,
      y = handle.y + handle.height / 2;
    await page.cmd("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await page.cmd("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: x - stage.width / 2,
      y: y - stage.height / 2,
      button: "left",
      buttons: 1,
    });
    await page.cmd("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: x - stage.width / 2,
      y: y - stage.height / 2,
      button: "left",
      buttons: 0,
    });
    expect(
      await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.width)`),
    ).toBeCloseTo(50, 1);
    expect(
      await page.eval(`parseFloat(document.querySelector('.image-crop-selection').style.height)`),
    ).toBeCloseTo(50, 1);
    await media({ contentFailure: 403 });
    // Attachment bytes are cached as immutable (R2-D10); an unreadable source means no copy in the cache either.
    await page.cmd("Network.clearBrowserCache");
    await page.click("text=Save");
    await page.waitFor(
      `document.querySelector('[aria-label="Crop image"] [role="alert"]')?.textContent.includes('Could not crop')`,
    );
    await media();
    await page.key("Escape");
    await page.waitFor(`!!document.querySelector('[aria-label="Preview"]')`);
    await page.key("Escape");
    expect(await page.eval(`new URLSearchParams(location.search).get('issue')`)).toBe("TEST-2");
    await page.reload();
    await page.waitFor(`!!${image}`, 15000);
    expect(await page.eval(`${image}.getAttribute('src')`)).toBe(
      "/api/issues/TEST-2/attachments/102",
    );
  });
  await test.step("crop changes and image comments persist locally across reloads", async () => {
    await page.waitFor(`${image}?.naturalWidth===320`, 15000);
    await page.click("#description img");
    await page.click('#description [aria-label="Crop image"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Resize from top left"]')`);
    await page.click('[aria-label="Resize from top left"]');
    await page.key("ArrowRight");
    await page.click("text=Save");
    await page.waitFor(`${image}?.getAttribute('src')?.startsWith('blob:')`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[aria-label="Preview"]')`);
    await page.hover("#description img");
    await page.click('#description [aria-label="Add image comment"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    await page.type("First image review");
    await page.click('[aria-label="Submit image comment"]');
    await page.waitFor(`${thread}.textContent.includes('First image review')`);
    expect(
      await page.eval(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`),
    ).toBe(true);
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(`${image}?.getAttribute('src')?.startsWith('blob:')`, 15000);
    await page.hover("#description img");
    await page.click('#description [aria-label="Add image comment"]');
    expect(await page.eval(`${thread}.textContent`)).toContain("First image review");
    expect(
      await page.eval(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`),
    ).toBe(true);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('.image-comment-thread')`);
    expect(await page.active()).toBe("Add image comment");
    await page.click("text=View image");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    expect(await page.eval(`${thread}.textContent`)).toContain("First image review");
    await page.click('[aria-label="Image comment options"]');
    await page.click("text=Edit image comment");
    await page.key("a", "meta");
    await page.type("Edited image review");
    await page.key("Enter", "meta");
    await page.waitFor(`${thread}.textContent.includes('Edited image review')`);
    expect(await page.eval(`!!document.querySelector('[aria-label="Preview"]')`)).toBe(false);
    await page.click('[aria-label="Image comment options"]');
    await page.click("text=Edit image comment");
    await page.key("a", "meta");
    await page.type("Draft survives deletion");
    await page.click('[aria-label="Image comment options"]');
    await page.click("text=Delete image comment");
    await page.waitFor(`!document.querySelector('[data-image-comment]')`);
    expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe(
      "Draft survives deletion",
    );
    expect(await page.eval(`!!document.querySelector('[aria-label="Submit image comment"]')`)).toBe(
      true,
    );
    await page.key("Escape");
    await page.click('[aria-label="Leave a comment…"]');
    await page.type("Normal comment after deleting image review");
    await page.key("Enter", "meta");
    await page.waitFor(`!!document.querySelector('[data-key="TEST-2"] [aria-label="1 comments"]')`);
    expect((await fixture.log()).requests.some((r) => r.method !== "GET")).toBe(false);
  });
  await test.step("cropped downloads contain PNG bytes and a PNG filename even for a JPEG-named source", async () => {
    await media();
    const page = await open();
    page.onEvent("Fetch.requestPaused", (params) => {
      void page.cmd("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }],
        body: Buffer.from(
          JSON.stringify({
            id: "102",
            mediaId: "22222222-2222-4222-8222-222222222222",
            url: "/api/issues/TEST-2/attachments/102",
            name: "portrait.jpg",
            type: "image/png",
            size: 1000,
          }),
        ).toString("base64"),
      });
    });
    await page.cmd("Fetch.enable", {
      patterns: [{ urlPattern: "*/api/issues/TEST-2/media/22222222*", requestStage: "Request" }],
    });
    await issueImage(page);
    await page.hover("#description img");
    await page.click('#description [aria-label="Full screen"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Download image"]')`);
    expect(
      await page.eval(`document.querySelector('[aria-label="Download image"]').download`),
    ).toBe("portrait.jpg");
    expect(
      await page.eval(
        `document.querySelector('[aria-label="Download image"]').getAttribute('href')`,
      ),
    ).toBe("/api/issues/TEST-2/attachments/102?download=1");
    await page.click('[aria-label="Preview"] [aria-label="Crop image"]');
    await page.click('[aria-label="Resize from top left"]');
    await page.key("ArrowRight", "shift");
    await page.click("text=Save");
    await page.waitFor(`${preview}?.naturalWidth===310`);
    expect(
      await page.eval(`document.querySelector('[aria-label="Download image"]').download`),
    ).toBe("portrait.png");
    const download = page.page.waitForEvent("download");
    await page.click('[aria-label="Download image"]');
    const data = new Uint8Array(readFileSync(await savedAs(download, "portrait.png")));
    expect(data.slice(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(new DataView(data.buffer).getUint32(16)).toBe(310);
  });
});

test("image comment threads: drafts, Escape after mouse Submit, and external images", async ({
  open,
}) => {
  await test.step("an unfinished image comment draft survives closing and reopening its thread", async () => {
    await media();
    const page = await open();
    await issueImage(page);
    await page.hover("#description img");
    await page.click('#description [aria-label="Add image comment"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    await page.type("Unfinished image review");
    await page.key("Escape");
    await page.click('#description [aria-label="Add image comment"]');
    expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe(
      "Unfinished image review",
    );
    await page.click('#description [aria-label="Hide image comments"]');
    await page.click('#description [aria-label="Add image comment"]');
    expect(await page.eval(`document.querySelector('[aria-label="Image comment"]').value`)).toBe(
      "Unfinished image review",
    );
  });
  await test.step("Escape after a mouse Submit closes only the image comment thread, not the issue (Sol review 4)", async () => {
    await media();
    const page = await open("?issue=TEST-2&view=page");
    await page.waitFor(`${image}?.naturalWidth===320`, 15000);
    await page.hover("#description img");
    await page.click('#description [aria-label="Add image comment"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    await page.type("Mouse submitted");
    await page.click('[aria-label="Submit image comment"]');
    await page.waitFor(`!!document.querySelector('[data-image-comment-thumbnail]')`);
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('.image-comment-thread')`);
    expect(await page.active()).toBe("Add image comment");
    expect(new URL(await page.eval("location.href")).searchParams.get("issue")).toBe("TEST-2");
    expect(
      await page.eval(`document.querySelector('[id^="image-comment-"]').textContent`),
    ).toContain("Mouse submitted");
  });
  await test.step("external images keep stable comment navigation while unreadable editing controls are disabled", async () => {
    await media({ mediaVariant: "layouts" });
    const page = await open();
    const failures: string[] = [];
    page.onEvent("Fetch.requestPaused", (params) => {
      void page
        .cmd("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "image/png" }],
          body: imageBytes,
        })
        .catch((error) => failures.push(String(error)));
    });
    await page.cmd("Fetch.enable", {
      patterns: [{ urlPattern: "https://images.example.test/*", requestStage: "Request" }],
    });
    await page.click('[data-key="TEST-2"]');
    const external = '#description .media-frame:has(img[alt="External portrait"])';
    await page.hover(`${external} img`);
    await page.waitFor(`document.querySelector('${external} img')?.naturalWidth===320`, 15000);
    await page.waitFor(
      `document.querySelector('${external} [aria-label="Copy image"]')?.title.includes('cannot be read')`,
    );
    expect(
      await page.eval(`document.querySelector('${external} [aria-label="Copy image"]').disabled`),
    ).toBe(true);
    expect(
      await page.eval(`document.querySelector('${external} [aria-label="Crop image"]').disabled`),
    ).toBe(true);
    const id = await page.eval<string>(`document.querySelector('${external}').dataset.mediaId`);
    expect(id).toMatch(/^external-[a-f0-9]{16}$/);
    await page.click(`${external} [aria-label="Add image comment"]`);
    await page.type("External image review");
    await page.key("Enter", "meta");
    await page.waitFor(saved);
    await page.reload();
    await page.hover(`${external} img`);
    await page.waitFor(`document.querySelector('${external} img')?.naturalWidth===320`, 15000);
    expect(await page.eval(`document.querySelector('${external}').dataset.mediaId`)).toBe(id);
    await page.click("text=View image");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    expect(await page.eval(`${thread}.textContent`)).toContain("External image review");
    await page.key("Escape");
    expect(await page.active()).toBe("Add image comment");
    expect(failures).toEqual([]);
  });
});

test("an image comment keeps its image thumbnail in Activity after the image is deleted from the description, like Linear", async ({
  open,
}) => {
  await media();
  const page = await open("?issue=TEST-2&view=page");
  const card = `[id^="image-comment-"]`;
  await test.step("the image comment's thumbnail survives deleting the image and a reload", async () => {
    await page.waitFor(`${image}?.naturalWidth===320`, 15000);
    await page.click("#comment");
    await page.type("Earlier ordinary comment");
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('[data-comment]')?.textContent.includes('Earlier ordinary comment')`,
    );
    await sleep(20); // the image comment must be timestamped after the ordinary one
    await page.hover("#description img");
    await page.click('#description [aria-label="Add image comment"]');
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Image comment'`);
    await page.type("Review before removal");
    await page.click('[aria-label="Submit image comment"]');
    await page.waitFor(
      `document.querySelector('[data-image-comment-thumbnail]')?.naturalWidth===320`,
    );
    await page.click("#description img");
    await page.waitFor(`!!document.querySelector('#description .ProseMirror-selectednode')`);
    await page.key("Backspace");
    await page.waitFor(`!${image}`);
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-image-comment-thumbnail]')?.naturalWidth===320`,
      15000,
    );
    expect(await page.eval(`!!${image}`)).toBe(false);
    expect(
      await page.eval(
        `document.querySelector('[data-image-comment-thumbnail]').closest('li').textContent`,
      ),
    ).toContain("Review before removal");
  });
  await test.step("with the image gone from the description, View image opens it on its own; Escape closes it", async () => {
    await page.click("text=View image");
    await page.waitFor(
      `document.querySelector('[role="dialog"][aria-label="Preview"] img')?.naturalWidth===320`,
      8000,
    );
    await page.key("Escape");
    await page.waitFor(`!document.querySelector('[role="dialog"][aria-label="Preview"]')`);
  });
  await test.step("Activity runs in time order (Sol review 4), and the orphaned comment keeps Edit, Reply and Delete across reloads", async () => {
    expect(
      await page.eval(
        `[...document.querySelectorAll('.issue-activity [data-thread], .issue-activity [id^="image-comment-"]')].map(n=>n.textContent.includes('Earlier ordinary comment')?'ordinary':'image')`,
      ),
    ).toEqual(["ordinary", "image"]);
    await page.click(`${card} [aria-label="Comment options"]`);
    await page.click("text=Edit");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Edit image comment'`);
    await page.key("a", "meta");
    await page.type("Edited after removal");
    await page.click(`${card} form button:not([type])`);
    await page.waitFor(
      `document.querySelector('${card}').textContent.includes('Edited after removal')&&document.activeElement?.getAttribute('aria-label')==='Comment options'`,
    );
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(
      `document.querySelector('${card}')?.textContent.includes('Edited after removal')`,
      15000,
    );
    await page.click('[aria-label="Reply to image thread"]');
    await page.type("Reply after removal");
    await page.key("Enter", "meta");
    await page.waitFor(`document.querySelectorAll('[data-image-thread] ${card}').length===2`);
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-image-thread]')?.textContent.includes('Reply after removal')&&document.querySelectorAll('[data-image-thread]').length===1`,
      15000,
    );
    await page.click(`${card} [aria-label="Comment options"]`);
    await page.click("text=Delete");
    await page.click('[aria-label="Delete this comment?"] button[data-autofocus]');
    await page.waitFor(`document.querySelectorAll('${card}').length===1`);
    await page.waitFor(saved);
    await page.reload();
    await page.waitFor(
      `document.querySelector('[data-comment]')?.textContent.includes('Earlier ordinary comment')`,
      15000,
    );
    expect(
      await page.eval(
        `[...document.querySelectorAll('${card}')].map(n=>n.querySelector('p').textContent)`,
      ),
    ).toEqual(["Reply after removal"]);
  });
});
