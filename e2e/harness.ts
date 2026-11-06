/** Browser tests against scripts/fixture-server.ts in headless Microsoft Edge (Chrome headless exits early on managed Macs). */
import { setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = process.env.E2E_BROWSER ?? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)!;
const PORT = Number(process.env.E2E_PORT ?? 3011);
export const APP = `http://127.0.0.1:${PORT}/`;
setDefaultTimeout(60_000);

let server: ReturnType<typeof Bun.spawn>, browser: ReturnType<typeof Bun.spawn>, profile: string, ws: WebSocket;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const events: ((m: any) => void)[] = [];
function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Started on first use; each test file calls afterAll(stop) (hooks in a shared module attach only to the first file). */
let started: Promise<void> | undefined;
async function start() {
  server = Bun.spawn(["bun", "scripts/fixture-server.ts"], { env: { ...process.env, FIXTURE_PORT: String(PORT) }, stdout: "ignore", stderr: "inherit" });
  profile = mkdtempSync(join(tmpdir(), "better-jira-e2e-"));
  browser = Bun.spawn([BROWSER, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  let url = "";
  for (let i = 0; i < 100 && !url; i++) {
    await Bun.sleep(100);
    try { const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n"); if (port && path) url = `ws://127.0.0.1:${port}${path}`; } catch {}
  }
  if (!url) throw new Error("Browser did not start");
  ws = new WebSocket(url);
  ws.onmessage = e => { const m = JSON.parse(String(e.data)); if (m.id && pending.has(m.id)) { const p = pending.get(m.id)!; pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else events.forEach(f => f(m)); };
  await new Promise(r => (ws.onopen = r));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${APP}api/boards`)).ok) break; } catch {} await Bun.sleep(100); }
  await fetch(APP); // warm the HTML bundle
}
export function stop() { started = undefined; ws?.close(); browser?.kill(); server?.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }

const KEYS: Record<string, [string, number, string?]> = { Enter: ["Enter", 13, "\r"], Escape: ["Escape", 27], Tab: ["Tab", 9], Backspace: ["Backspace", 8], ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], End: ["End", 35], Home: ["Home", 36], " ": ["Space", 32, " "] };
const MODS: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export type Page = Awaited<ReturnType<typeof open>>;
/** A fresh browser context per page, so local data never leaks between tests. */
export async function open(path = "", { width = 1440, height = 900, setup = "" } = {}) {
  await (started ??= start());
  const { browserContextId } = await send("Target.createBrowserContext");
  const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cmd = (method: string, params: object = {}) => send(method, params, sessionId);
  await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cmd("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await cmd("Page.enable");
  if (setup) await cmd("Page.addScriptToEvaluateOnNewDocument", { source: setup });
  const evaluate = async <T = any>(expression: string): Promise<T> => {
    const r = await cmd("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`${expression}\n${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async <T = any>(expression: string, timeout = 5000): Promise<T> => {
    const end = Date.now() + timeout;let last: unknown;
    while (Date.now() < end) { try { last = await evaluate(expression); if (last) return last as T; } catch (e) { last = e; } await Bun.sleep(40); }
    throw new Error(`Timed out waiting for: ${expression} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
  };
  const center = async (selector: string) => {
    const r = await waitFor<{ x: number; y: number }>(`(()=>{const n=${q(selector)};if(!n)return null;n.scrollIntoView({block:"nearest",inline:"nearest"});const r=n.getBoundingClientRect();return r.width?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
    return r;
  };
  const mouse = (type: string, x: number, y: number, extra: object = {}) => cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const page = {
    eval: evaluate, waitFor, cmd,
    async goto(p = path) {
      await cmd("Page.navigate", { url: APP + p.replace(/^\//, "") });
      await waitFor(`document.readyState==="complete"&&!!document.querySelector("[data-key], [role=alert]")`, 15000);
    },
    async reload() { await cmd("Page.reload"); await Bun.sleep(200); await waitFor(`document.readyState==="complete"&&!!document.querySelector("[data-key]")`, 15000); },
    async key(key: string, ...mods: string[]) {
      const modifiers = mods.reduce((m, k) => m | (MODS[k] ?? 0), 0);
      const [code, vk, named] = KEYS[key] ?? [/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)];
      const text = modifiers & (MODS.meta! | MODS.ctrl!) ? undefined : named ?? (key.length === 1 ? (modifiers & MODS.shift! ? key.toUpperCase() : key) : undefined);
      await cmd("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers, text, unmodifiedText: text });
      await cmd("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
      await Bun.sleep(60);
    },
    async keys(sequence: string) { for (const k of sequence) await page.key(k); },
    async type(text: string) { for (const char of text) await cmd("Input.insertText", { text: char }); await Bun.sleep(60); },
    async clickAt(x: number, y: number) {
      await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await Bun.sleep(80);
    },
    async click(selector: string) { const { x, y } = await center(selector); await page.clickAt(x, y); },
    async hover(selector: string) { const { x, y } = await center(selector); await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await Bun.sleep(60); },
    async drag(selector: string, x: number, y: number) {
      const from = await center(selector);
      await cmd("Input.setInterceptDrags", { enabled: true });
      let data: any;
      const listen = (m: any) => { if (m.method === "Input.dragIntercepted" && m.sessionId === sessionId) data = m.params.data; };
      events.push(listen);
      await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await mouse("mousePressed", from.x, from.y);
      for (let i = 1; i <= 8; i++) { await mouse("mouseMoved", from.x + ((x - from.x) * i) / 8, from.y + ((y - from.y) * i) / 8); await Bun.sleep(15); }
      events.splice(events.indexOf(listen), 1);
      if (!data) throw new Error("drag was not intercepted");
      for (const type of ["dragEnter", "dragOver", "drop"]) await cmd("Input.dispatchDragEvent", { type, x, y, data });
      await mouse("mouseReleased", x, y);
      await cmd("Input.setInterceptDrags", { enabled: false });
      await Bun.sleep(100);
    },
    rect: (selector: string) => waitFor<DOMRect>(`(()=>{const n=${q(selector)};return n&&n.getBoundingClientRect().toJSON()})()`),
    active: () => evaluate<string>(`(()=>{const a=document.activeElement;return a?(a.getAttribute("aria-label")??a.getAttribute("placeholder")??(a.id||a.tagName)):""})()`),
    close: () => send("Target.disposeBrowserContext", { browserContextId }),
  };
  await page.goto(path);
  return page;
}

/** A DOM lookup expression: CSS selector, or `text=Label` for the first button or link with that accessible text. */
export function q(selector: string) {
  if (selector.startsWith("text=")) return `[...document.querySelectorAll("button,a,[role=button],[cmdk-item],[role=option]")].find(n=>(n.getAttribute("aria-label")??n.textContent??"").trim()===${JSON.stringify(selector.slice(5))})`;
  return `document.querySelector(${JSON.stringify(selector)})`;
}

/** The localStorage key the app uses for the fixture account's view preferences. */
export const PREFS_KEY = "better-jira:views:v1:https://example.atlassian.net/audit-me";
