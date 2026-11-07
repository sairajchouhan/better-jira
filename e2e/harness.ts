/** Browser tests against scripts/fixture-server.ts in headless Microsoft Edge (Chrome headless exits early on managed Macs). */
import { setDefaultTimeout } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BROWSER = process.env.E2E_BROWSER ?? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync)!;
const PORT = Number(process.env.E2E_PORT ?? 3011);
export const APP = `http://127.0.0.1:${PORT}/`;
setDefaultTimeout(60_000);

let server: ReturnType<typeof Bun.spawn>, browser: ReturnType<typeof Bun.spawn>, watchdog: ReturnType<typeof Bun.spawn>, profile: string, ws: WebSocket;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
const events: ((m: any) => void)[] = [];
function send(method: string, params: object = {}, sessionId?: string): Promise<any> {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

/** Started on first use and shared by every test file in the run; each file calls afterAll(stop) (hooks in a shared module attach only to the first file). */
let started: Promise<void> | undefined;
async function start() {
  if(server)await server.exited;
  // Never accept another run's fixture: it may serve a stale bundle and give a false result.
  try {
    const reservation=Bun.serve({hostname:"127.0.0.1",port:PORT,fetch:()=>new Response(null,{status:503})});
    await reservation.stop(true);
  }catch(error){throw new Error(`E2E fixture port ${PORT} is already in use`,{cause:error});}
  server = Bun.spawn(["bun", "scripts/fixture-server.ts"], { env: { ...process.env, FIXTURE_PORT: String(PORT) }, stdout: "ignore", stderr: "inherit" });
  profile = mkdtempSync(join(tmpdir(), "better-jira-e2e-"));
  browser = Bun.spawn([BROWSER, "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  // bun test can exit, or be killed by a timeout, without an exit event: this stops the server and browser once this process is gone.
  // It watches for being reparented, because an exited but unreaped test process still passes `kill -0`.
  watchdog = Bun.spawn(["sh", "-c", `while [ "$(ps -o ppid= -p $$ | tr -d ' ')" = "${process.pid}" ]; do sleep 1; done; kill ${server.pid} ${browser.pid} 2>/dev/null; rm -rf '${profile}'`], { stdout: "ignore", stderr: "ignore" });
  watchdog.unref();
  let url = "";
  for (let i = 0; i < 100 && !url; i++) {
    if(server.exitCode!==null)throw new Error(`E2E fixture exited before startup: ${server.exitCode}`);
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
function shutdown() { clearTimeout(idle); started = undefined; ws?.close(); watchdog?.kill(); browser?.kill(); server?.kill(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
process.on("exit", shutdown);
let idle: ReturnType<typeof setTimeout> | undefined;
/** Each file's afterAll: reset the fixture but keep the server and browser for the next file in this run (every page already gets a fresh
 *  browser context), instead of rebundling and relaunching per file. They stop after 5s unused, or when the process exits. */
export async function stop() { if (!started) return; clearTimeout(idle); await fetch(`${APP}__fixture`, { method: "POST", body: "{}" }).catch(() => {}); idle = setTimeout(shutdown, 5000); }

const KEYS: Record<string, [string, number, string?]> = { Enter: ["Enter", 13, "\r"], Escape: ["Escape", 27], Tab: ["Tab", 9], Backspace: ["Backspace", 8], Delete: ["Delete", 46], ArrowUp: ["ArrowUp", 38], ArrowDown: ["ArrowDown", 40], ArrowLeft: ["ArrowLeft", 37], ArrowRight: ["ArrowRight", 39], End: ["End", 35], Home: ["Home", 36], " ": ["Space", 32, " "] };
const MODS: Record<string, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export type Page = Awaited<ReturnType<typeof open>>;
/** A fresh browser context per page, so local data never leaks between tests. */
export async function open(path = "", { width = 1440, height = 900, setup = "" } = {}) {
  clearTimeout(idle);
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
    const r = await waitFor<{ x: number; y: number }>(`(()=>{const n=${q(selector)};if(!n)return null;n.scrollIntoView({block:"center",inline:"nearest"});const r=n.getBoundingClientRect();return r.width?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
    return r;
  };
  const mouse = (type: string, x: number, y: number, extra: object = {}) => cmd("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
  const ownedEvents:((message:any)=>void)[]=[];
  const page = {
    onEvent(method:string,listener:(params:any)=>void){const listen=(message:any)=>{if(message.sessionId===sessionId&&message.method===method)listener(message.params);};events.push(listen);ownedEvents.push(listen);return()=>{const i=events.indexOf(listen);if(i>=0)events.splice(i,1);};},
    browserContextId, eval: evaluate, waitFor, cmd,
    async goto(p = path) {
      await cmd("Page.navigate", { url: APP + p.replace(/^\//, "") });
      await waitFor(`document.readyState==="complete"&&!!document.querySelector("[data-key], [role=alert]")`, 15000);
    },
    async reload() { await cmd("Page.reload"); await Bun.sleep(200); await waitFor(`document.readyState==="complete"&&!!document.querySelector("[data-key]")`, 15000); },
    async key(key: string, ...mods: string[]) {
      const modifiers = mods.reduce((m, k) => m | (MODS[k] ?? 0), 0);
      const [code, vk, named] = KEYS[key] ?? [/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)];
      const text = modifiers & (MODS.meta! | MODS.ctrl!) ? undefined : named ?? (key.length === 1 ? (modifiers & MODS.shift! ? key.toUpperCase() : key) : undefined);
      await cmd("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers, text, unmodifiedText: text, ...(modifiers & MODS.meta! && key.toLowerCase()==="a" ? {commands:["selectAll"]} : {}) });
      await cmd("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
      await Bun.sleep(60);
    },
    async keys(sequence: string) { for (const k of sequence) await page.key(k); },
    async type(text: string) { for (const char of text) await cmd("Input.insertText", { text: char }); await Bun.sleep(60); },
    async clickAt(x: number, y: number) {
      await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await mouse("mousePressed", x, y); await mouse("mouseReleased", x, y); await Bun.sleep(80);
    },
    async click(selector: string) {
      const first=await center(selector);await cmd("Input.dispatchMouseEvent",{type:"mouseMoved",...first});
      const {x,y}=await waitFor<{x:number;y:number}>(`(async()=>{const n=${q(selector)};if(!n)return null;n.scrollIntoView({block:"center",inline:"nearest"});const a=n.getBoundingClientRect();await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const b=n.getBoundingClientRect(),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);return b.width&&Math.abs(a.x-b.x)<.5&&Math.abs(a.y-b.y)<.5&&n.contains(hit)?{x,y}:null})()`);
      await page.clickAt(x,y);
    },
    /** A left-button pointer drag from one point to another, for pan and slider gestures (not HTML drag and drop). */
    async pointerDrag(x: number, y: number, toX: number, toY: number) { await cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await mouse("mousePressed", x, y); for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", x + ((toX - x) * i) / 6, y + ((toY - y) * i) / 6); await Bun.sleep(16); } await mouse("mouseReleased", toX, toY); await Bun.sleep(60); },
    async wheel(x: number, y: number, deltaX: number, deltaY: number) { await cmd("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY }); await Bun.sleep(80); },
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
    close: () => {for(const listen of ownedEvents){const i=events.indexOf(listen);if(i>=0)events.splice(i,1);}return send("Target.disposeBrowserContext", { browserContextId });},
  };
  await page.goto(path);
  return page;
}

/** A DOM lookup expression: CSS selector, or `text=Label` for the first button or link with that accessible text. */
export function q(selector: string) {
  if (selector.startsWith("text=")) return `[...document.querySelectorAll("button,a,[role=button],[cmdk-item],[role=option]")].find(n=>(n.getAttribute("aria-label")??n.textContent??"").trim()===${JSON.stringify(selector.slice(5))})`;
  // A hovered control's title is parked in data-title while the app tooltip shows it.
  return `(document.querySelector(${JSON.stringify(selector)})??document.querySelector(${JSON.stringify(selector.replaceAll("[title=", "[data-title="))}))`;
}

/** The localStorage key the app uses for the fixture account's view preferences. */
export const PREFS_KEY = "better-jira:views:v1:https://example.atlassian.net/audit-me";
