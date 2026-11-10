/** Playwright fixtures for the browser suite: one fixture server per worker (its state is global, so workers never share one),
 *  and `open()` for app pages, each in a fresh browser context unless it is a second tab of another page. */
import {
  test as base,
  expect as baseExpect,
  selectors,
  type BrowserContext,
  type CDPSession,
  type Download,
  type Page as PwPage,
} from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const expect = baseExpect.extend({
  toStartWith(received: unknown, prefix: string) {
    const pass = typeof received === "string" && received.startsWith(prefix);
    return {
      pass,
      message: () =>
        `expected ${JSON.stringify(received)} ${pass ? "not " : ""}to start with ${JSON.stringify(prefix)}`,
    };
  },
});

/** The localStorage key the app uses for the fixture account's view preferences. */
export const PREFS_KEY = "better-jira:views:v1:https://example.atlassian.net/audit-me";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A DOM lookup expression: CSS selector, or `text=Label` for the first button or link with that accessible text. */
export function q(selector: string) {
  if (selector.startsWith("text="))
    return `[...document.querySelectorAll("button,a,[role=button],[cmdk-item],[role=option]")].find(n=>(n.getAttribute("aria-label")??n.textContent??"").trim()===${JSON.stringify(selector.slice(5))})`;
  // A hovered control's title is parked in data-title while the app tooltip shows it.
  return `(document.querySelector(${JSON.stringify(selector)})??document.querySelector(${JSON.stringify(selector.replaceAll("[title=", "[data-title="))}))`;
}

/** The same lookup as `q`, as a Playwright selector engine, so clicks and hovers get Playwright's actionability checks. */
const engine = () => {
  const all = (root: Element, encoded: string): Element[] => {
    const selector = decodeURIComponent(encoded);
    if (selector.startsWith("text=")) {
      const label = selector.slice(5);
      return [...root.querySelectorAll("button,a,[role=button],[cmdk-item],[role=option]")].filter(
        (n) => (n.getAttribute("aria-label") ?? n.textContent ?? "").trim() === label,
      );
    }
    const found = [...root.querySelectorAll(selector)];
    return found.length
      ? found
      : [...root.querySelectorAll(selector.replaceAll("[title=", "[data-title="))];
  };
  return {
    query: (root: Element, selector: string) => all(root, selector)[0] ?? null,
    queryAll: all,
  };
};

/** This worker's fixture server. Every test starts with it reset. */
export const fixture = {
  url: "",
  /** Resets the fixture server's state, with these settings (see `__fixture` in scripts/fixture-server.ts). */
  reset: (settings: object = {}) =>
    fetch(`${fixture.url}__fixture`, { method: "POST", body: JSON.stringify(settings) }).then(
      () => {},
    ),
  /** The fixture's request and write log. */
  log: async (): Promise<{
    requests: { method: string; path: string; status: number }[];
    writes: any[];
    rich: any;
  }> => (await fetch(`${fixture.url}__fixture`)).json(),
};

/** Starts scripts/fixture-server.ts on `port` and resolves once that child, not some other process, is listening. */
export function startFixture(port: number, env: Record<string, string> = {}) {
  const child = spawn("bun", ["scripts/fixture-server.ts"], {
    // A production bundle: the dev bundle costs each page load (and so the suite) about a fifth more.
    env: {
      ...process.env,
      NODE_ENV: "production",
      ...env,
      FIXTURE_PORT: String(port),
      FIXTURE_EXIT_ON_EOF: "1",
    },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const ready = new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (d) => {
      out += d;
      if (out.includes("Disposable browser fixture on")) resolve();
    });
    child.on("exit", (code) => reject(new Error(`Fixture server on port ${port} exited: ${code}`)));
  });
  return { child, ready };
}

async function launchServer(port: number): Promise<{ child: ChildProcess; url: string }> {
  // A finished worker's server can hold the port for a moment while a replacement worker starts.
  for (let attempt = 0; ; attempt++) {
    const { child, ready } = startFixture(port);
    try {
      await ready;
      const url = `http://127.0.0.1:${port}/`;
      await fetch(url); // warm the HTML bundle
      return { child, url };
    } catch (error) {
      child.kill();
      if (attempt >= 20) throw error;
      await sleep(250);
    }
  }
}

export type OpenOptions = { width?: number; height?: number; setup?: string; tabOf?: App };

export type App = Awaited<ReturnType<typeof wrap>>;

const SETTLE_CAP = 100;
const MODS: Record<string, string> = { alt: "Alt", ctrl: "Control", meta: "Meta", shift: "Shift" };

async function wrap(page: PwPage, base: string, path: string, setup: string, tab: boolean) {
  let cdp: Promise<CDPSession> | undefined;
  const session = () => (cdp ??= page.context().newCDPSession(page));
  const evaluate = <T = any>(expression: string): Promise<T> =>
    page.evaluate(expression) as Promise<T>;
  /** Waits until the expression, which may return a promise, is truthy; a throw counts as not yet. Polls like a user's
   *  glance (every 20 ms), since Playwright's waitForFunction treats a returned promise as already truthy. */
  const waitFor = async <T = any>(expression: string, timeout = 5000): Promise<T> => {
    const end = Date.now() + timeout;
    let last: unknown;
    for (;;) {
      try {
        last = await page.evaluate(expression);
        if (last) return last as T;
      } catch (error) {
        last = error;
        if (page.isClosed()) throw error;
      }
      if (Date.now() > end)
        throw new Error(
          `Timed out after ${timeout} ms waiting for: ${expression}\n(last: ${last instanceof Error ? last.message : JSON.stringify(last)})`,
        );
      await sleep(20);
    }
  };
  // Encoded, so quotes and `>>` in a selector reach the engine untouched.
  const locate = (selector: string) =>
    page.locator(`q=${encodeURIComponent(selector).replaceAll("'", "%27")}`).first();
  /** Lets the app react to an input (React commits, focus moves, effects) before the next step, as a user's pace would:
   *  two animation frames, capped for a background tab whose frames don't run. */
  const settle = () =>
    page
      .evaluate(
        `new Promise(r=>{setTimeout(r,${SETTLE_CAP});requestAnimationFrame(()=>requestAnimationFrame(()=>r()))})`,
      )
      .catch(() => {}); // the input navigated away
  if (setup) await page.addInitScript(setup);
  const app = {
    page,
    context: page.context(),
    eval: evaluate,
    waitFor,
    locate,
    /** Raw CDP for what Playwright has no API for. */
    cmd: async (method: string, params: object = {}) =>
      (await session()).send(method as any, params),
    /** Listens for a CDP event; the returned function stops listening. */
    onEvent(method: string, listener: (params: any) => void) {
      const s = session().then((s) => (s.on(method as any, listener), s));
      return () => void s.then((s) => s.off(method as any, listener));
    },
    async goto(p = path) {
      await page.goto(base + p.replace(/^\//, ""));
      await waitFor(
        `document.readyState==="complete"&&!!document.querySelector("[data-key], [role=alert]")`,
        15000,
      );
    },
    async reload() {
      await page.reload();
      await waitFor(
        `document.readyState==="complete"&&!!document.querySelector("[data-key]")`,
        15000,
      );
    },
    async key(key: string, ...mods: string[]) {
      await page.keyboard.press(
        [...mods.map((m) => MODS[m] ?? m), key === " " ? "Space" : key].join("+"),
      );
      await settle();
    },
    async keys(sequence: string) {
      for (const k of sequence) await app.key(k);
    },
    /** Text input without key events, one character at a time, as an IME or paste would land it. */
    async type(text: string) {
      for (const char of text) await page.keyboard.insertText(char);
      await settle();
    },
    async clickAt(x: number, y: number) {
      await page.mouse.click(x, y);
      await settle();
    },
    async click(selector: string) {
      await locate(selector).click();
      await settle();
    },
    async hover(selector: string) {
      await locate(selector).hover();
      await settle();
    },
    /** A left-button pointer drag from one point to another, for pan and slider gestures. */
    async pointerDrag(x: number, y: number, toX: number, toY: number) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(toX, toY, { steps: 6 });
      await page.mouse.up();
    },
    async wheel(x: number, y: number, deltaX: number, deltaY: number) {
      await page.mouse.move(x, y);
      await page.mouse.wheel(deltaX, deltaY);
    },
    /** HTML drag and drop from an element to a point. */
    async drag(selector: string, x: number, y: number) {
      await locate(selector).hover();
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 8 });
      await page.mouse.up();
    },
    rect: (selector: string) =>
      waitFor<DOMRect>(
        `(()=>{const n=${q(selector)};return n&&n.getBoundingClientRect().toJSON()})()`,
      ),
    active: () =>
      evaluate<string>(
        `(()=>{const a=document.activeElement;return a?(a.getAttribute("aria-label")??a.getAttribute("placeholder")??(a.id||a.tagName)):""})()`,
      ),
    /** Brings the tab to the front. */
    front: () => page.bringToFront(),
    close: () => (tab ? page.close() : page.context().close()),
  };
  await app.goto(path);
  return app;
}

let registered: Promise<void> | undefined;
let current: ((path?: string, options?: OpenOptions) => Promise<App>) | undefined;
/** The running test's `open`, for helpers outside a test body. */
export const open = (path?: string, options?: OpenOptions) => current!(path, options);

/** Waits for a download, checks the file name the app gave it, and returns where Playwright saved it. */
export async function savedAs(download: Promise<Download>, name: string) {
  const d = await download;
  expect(d.suggestedFilename()).toBe(name);
  return (await d.path())!;
}

/** A file's content hash, to compare a saved download with its source. */
export const fileHash = (path: string) =>
  createHash("sha1").update(readFileSync(path)).digest("hex");

export const test = base.extend<
  { open: (path?: string, options?: OpenOptions) => Promise<App>; reset: void },
  { worker: void }
>({
  worker: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this destructuring
    async ({}, use, info) => {
      const { child, url } = await launchServer(
        Number(process.env.E2E_PORT_BASE ?? 3200) + info.parallelIndex,
      );
      fixture.url = url;
      await use();
      child.kill();
    },
    { scope: "worker", auto: true, timeout: 60_000 },
  ],
  // oxlint-disable-next-line no-empty-pattern
  reset: [async ({}, use) => use(await fixture.reset()), { auto: true }],
  open: async ({ browser }, use) => {
    await (registered ??= selectors.register("q", engine));
    const contexts: BrowserContext[] = [];
    await use(
      (current = async (path = "", { width = 1440, height = 900, setup = "", tabOf } = {}) => {
        let context = tabOf?.context;
        if (!context) {
          context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 1,
            colorScheme: "dark",
          });
          contexts.push(context);
        }
        return wrap(await context.newPage(), fixture.url, path, setup, !!tabOf);
      }),
    );
    current = undefined;
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
  },
});
