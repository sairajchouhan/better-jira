import { afterAll, expect, test } from "bun:test";
import { APP, open, stop } from "./harness";
afterAll(stop);

test("properties become pills within a narrow issue without duplicate controls or losing their anchors", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('prop-status')`);
    expect(
      await page.eval(
        `getComputedStyle(document.querySelector('.issue-detail-properties')).borderLeftWidth`,
      ),
    ).toBe("0px");
    expect(
      await page.eval(
        `document.querySelector('.issue-detail-properties').getBoundingClientRect().x>document.getElementById('summary').getBoundingClientRect().right`,
      ),
    ).toBe(true);
    await page.cmd("Emulation.setDeviceMetricsOverride", {
      width: 900,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.waitFor(
      `getComputedStyle(document.querySelector('[data-properties]')).display==='flex'`,
    );
    expect(await page.eval(`document.querySelectorAll('#prop-status').length`)).toBe(1);
    expect(
      await page.eval(
        `document.getElementById('prop-status').getBoundingClientRect().bottom<document.getElementById('description').getBoundingClientRect().top`,
      ),
    ).toBe(true);
    await page.click("#prop-status");
    await page.waitFor(`!!document.querySelector('[role=dialog]')`);
    expect(
      await page.eval(
        `(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`,
      ),
    ).toBe(true);
    await page.key("Escape");
    await page.click('[title="Open in side panel"]');
    await page.waitFor(`document.querySelector('.issue-detail').dataset.mode==='side'`);
    expect(
      await page.eval(`getComputedStyle(document.querySelector('[data-properties]')).display`),
    ).toBe("flex");
  } finally {
    await page.close();
  }
});

test("copy toolbar writes the same ID, URL and branch as issue shortcuts to the real clipboard", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.cmd("Browser.grantPermissions", {
      origin: new URL(APP).origin,
      browserContextId: page.browserContextId,
      permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
    });
    await page.eval(
      `(async()=>{window.previousClipboard=await navigator.clipboard.read();window.clipboardCaptured=true})()`,
    );
    await page.click('[aria-label="Copy issue ID"]');
    expect(await page.eval(`navigator.clipboard.readText()`)).toBe("TEST-2");
    await page.click('[aria-label="Copy issue URL"]');
    expect(await page.eval(`navigator.clipboard.readText()`)).toBe(
      "https://example.atlassian.net/browse/TEST-2",
    );
    await page.click('[aria-label="Copy git branch name"]');
    expect(await page.eval(`navigator.clipboard.readText()`)).toMatch(
      /\/test-2-browser-fixture-2$/,
    );
  } finally {
    await page
      .eval(
        `(async()=>{if(window.clipboardCaptured){if(window.previousClipboard?.length)await navigator.clipboard.write(window.previousClipboard);else await navigator.clipboard.writeText('')}})()`,
      )
      .catch(() => {});
    await page.close();
  }
});

test("compact comment drafts survive Escape, issue navigation and reload, then clear after sending", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('comment')`);
    expect((await page.rect(".rich-editor:has(#comment)")).height).toBeLessThanOrEqual(100);
    expect(
      await page.eval(
        `document.querySelector('.rich-editor:has(#comment) .rich-editor-submit').disabled`,
      ),
    ).toBe(true);
    await page.click("#comment");
    await page.type("Keep this personal draft");
    await page.key("Escape");
    expect(await page.eval(`!!document.getElementById('summary')`)).toBe(true);
    await page.click('[title="Next (J / ↓)"]');
    await page.click('[title="Previous (K / ↑)"]');
    await page.waitFor(
      `document.getElementById('comment')?.textContent==='Keep this personal draft'`,
    );
    await page.reload();
    await page.waitFor(
      `document.getElementById('comment')?.textContent==='Keep this personal draft'`,
    );
    await page.click("#comment");
    await page.key("Enter", "meta");
    await page.waitFor(
      `document.querySelector('[data-comment^="local-"]')?.textContent.includes('Keep this personal draft')`,
    );
    expect(await page.eval(`document.getElementById('comment').textContent`)).toBe("");
    await page.reload();
    await page.waitFor(`!!document.getElementById('comment')`);
    expect(await page.eval(`document.getElementById('comment').textContent`)).toBe("");
  } finally {
    await page.close();
  }
});

test("subscribers can be changed by the observed shortcut and persist across reloads", async () => {
  const page = await open("?issue=TEST-2&view=page");
  try {
    await page.waitFor(`!!document.getElementById('issue-subscribers')`);
    await page.key("s", "meta", "shift");
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')==='Change subscribers'`);
    await page.type("Audit Me");
    await page.key("Enter");
    await page.key("Escape");
    await page.waitFor(`!!document.querySelector('[aria-label="Unsubscribe from issue"]')`);
    expect(await page.active()).toBe("Change subscribers");
    await page.reload();
    await page.waitFor(`!!document.querySelector('[aria-label="Unsubscribe from issue"]')`);
    await page.click('[aria-label="Unsubscribe from issue"]');
    await page.waitFor(`!!document.querySelector('[aria-label="Subscribe to issue"]')`);
  } finally {
    await page.close();
  }
});
