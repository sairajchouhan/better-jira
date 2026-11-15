import { expect, test } from "bun:test";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryHistory } from "@tanstack/react-router";
import { appPainted, firstPaintPending, handOverBootShell, HANDOVER_MS } from "./boot-shell";
import { SIDEBAR_STATE_KEY } from "./state/browser-preferences";
import { AppLoading } from "./components/empty-state";
import { createAppRouter, type RouteContext } from "./routes/tree";
import { App } from "./App";

// The boot shell: Linear's index.html #loading (sidebar column, framed panel, grey logo fading in after 1s) painted
// before any script, then faded out by its loading-done observer (Root.DgAGfQ2G.js `E`). Fails if the shell, its
// line-up with the real app shell, or its handover drift.
const dir = new URL("./", import.meta.url);
const html = await Bun.file(new URL("index.html", dir)).text();
const css = await Bun.file(new URL("index.css", dir)).text();
const app = await Bun.file(new URL("App.tsx", dir)).text();
const chrome = await Bun.file(new URL("features/navigation/app-chrome.tsx", dir)).text();
const favicon = await Bun.file(new URL("assets/notch/favicon.svg", dir)).text();
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.#]/g, "\\$&")} \\{([^}]*)\\}`))?.[1] ?? "";

test("index.html paints the shell before any script: #loading after an empty #root, with the panel and the logo", () => {
  const body = html.slice(html.indexOf("<body>"));
  expect(body).toMatch(/<div id="root"><\/div>\s*(<!--[\s\S]*?-->\s*)?<div id="loading" aria-hidden="true">/);
  expect(body).toContain('<div id="loading-panel"></div>');
  expect(body).toContain('<div id="loading-text">Loading…</div>');
  // Nothing else in the body before the app's module script: the first frame is the shell.
  expect(body).not.toMatch(/<script(?![^>]*type="module")/);
});

test("the logo is our app icon (favicon.svg's shapes) at Linear's 32px, in one colour", () => {
  const svg = html.match(/<svg id="loading-logo"[\s\S]*?<\/svg>/)?.[0] ?? "";
  expect(svg).toContain('width="32" height="32" viewBox="0 0 16 16"');
  const shapes = (s: string) => [...s.matchAll(/<(path|rect)\b([^>]*?)\s*\/?>/g)].map((m) => m[2]!.replace(/\s*class="[^"]*"/, "").trim());
  expect(shapes(svg)).toEqual(shapes(favicon));
  expect(svg).not.toContain("fill=");
  expect(rule("#loading-logo")).toContain("fill: currentColor");
  // Linear's --content-color: #b0b5c0 light, #6b6f76 dark.
  expect(css).toMatch(/--boot-logo: #b0b5c0;[\s\S]*prefers-color-scheme: dark\)[\s\S]*--boot-logo: #6b6f76;/);
});

test("the logo fades in like Linear's (fadeIn .4s ease-out 1s both), the text after ~8.8s, the shell out over .1s", () => {
  expect(css).toMatch(/@keyframes boot-fade-in \{\s*from \{\s*opacity: 0;\s*\}\s*to \{\s*opacity: 1;\s*\}\s*\}/);
  expect(rule("#loading-content")).toContain("animation: boot-fade-in 0.4s ease-out 1s both");
  expect(rule("#loading-text")).toContain("animation: boot-fade-in 0.8s ease-out 8.8s both");
  expect(rule("#loading")).toContain("transition: opacity 0.1s");
  expect(rule("body.loaded #loading")).toContain("opacity: 0");
  expect(HANDOVER_MS).toBe(100);
});

test("the shell lines up with the app's: sidebar colour, 244px column, <main>'s margins, frame, radius and panel", () => {
  expect(rule("#loading")).toContain("background-color: var(--app)");
  expect(app).toMatch(/<div className="flex h-screen flex-col overflow-hidden">/);
  expect(css).toMatch(/:root \{\s*--boot-sidebar: 244px;/);
  expect(chrome).toContain("flex w-[244px] shrink-0 flex-col");
  const panel = rule("#loading-panel");
  // <main className="… my-2 mr-2 … rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)"> above the h-7 status bar.
  const main = app.match(/<main[\s\S]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/)?.slice(1).join("") ?? "";
  for (const token of ["my-2", "mr-2", "rounded-xl", "border-[0.5px]", "border-frame", "bg-panel", "shadow-(--frame-shadow)"])
    expect(main.split(" ")).toContain(token);
  expect(chrome).toContain('<footer className="flex h-7 shrink-0');
  expect(panel).toContain("margin: 0.5rem 0.5rem calc(0.5rem + 1.75rem) var(--boot-sidebar)");
  expect(panel).toContain("border: 0.5px solid var(--frame)");
  expect(panel).toContain("border-radius: var(--radius-xl)");
  expect(panel).toContain("background-color: var(--panel)");
  expect(panel).toContain("box-shadow: var(--frame-shadow)");
  // Linear centres the logo in the panel: half the sidebar to the right of the window's centre.
  expect(rule("#loading-content")).toContain("margin-left: calc(var(--boot-sidebar) / 2)");
});

test("a hidden sidebar, read before first paint, leaves no column; so does a window under 768px", () => {
  const script = html.match(/<head>[\s\S]*<script>([\s\S]*?)<\/script>[\s\S]*<\/head>/)?.[1] ?? "";
  const run = (stored: string | null) => {
    const classes = new Set<string>();
    const localStorage = { getItem: (key: string) => (key === SIDEBAR_STATE_KEY ? stored : null) };
    const document = { documentElement: { classList: { add: (c: string) => classes.add(c) } } };
    new Function("localStorage", "document", script)(localStorage, document);
    return classes.has("sidebar-hidden");
  };
  expect(run("hidden")).toBe(true);
  expect(run("shown")).toBe(false);
  expect(run(null)).toBe(false);
  // Storage that throws (blocked site data) paints the default column.
  expect(() => new Function("localStorage", "document", script)({ getItem: () => { throw new Error("blocked"); } }, {})).not.toThrow();
  // Hidden, <main> keeps Linear's 8px mainPageMargin on its left too (BJ-276: `ml-2` when sidebarHidden).
  expect(css).toMatch(/html\.sidebar-hidden \{\s*--boot-sidebar: 0\.5rem;\s*\}/);
  expect(app).toContain('${sidebarHidden ? "ml-2" : ""}');
  expect(css).toMatch(/@media \(max-width: 767px\) \{\s*:root \{\s*--boot-sidebar: 0px;/);
});

/** A DOM just big enough for the handover: #root's children, the shell, body's classes, an observer and timers. */
function harness({ reload = false, painted = false } = {}) {
  const children: { appLoading: boolean }[] = [];
  const root = {
    get childElementCount() {
      return children.length;
    },
    querySelector: (selector: string) => (selector === "[data-app-loading]" ? (children.find((c) => c.appLoading) ?? null) : null),
  };
  const shell = { style: { transitionDuration: "" }, removed: false, remove: () => (shell.removed = true) };
  const body = new Set<string>();
  const timers: { fn: () => void; ms: number }[] = [];
  let notify = () => {};
  let options: MutationObserverInit | undefined;
  let connected = false;
  class Observer {
    constructor(callback: () => void) {
      notify = () => connected && callback();
    }
    observe(_: unknown, init: MutationObserverInit) {
      options = init;
      connected = true;
    }
    disconnect() {
      connected = false;
    }
  }
  const performance = {
    getEntriesByType: (type: string) =>
      type === "navigation" ? [{ type: reload ? "reload" : "navigate" }] : type === "paint" && painted ? [{}] : [],
  };
  const stop = handOverBootShell(root as never, {
    document: { getElementById: (id: string) => (id === "loading" ? shell : null), body: { classList: { add: (c: string) => body.add(c) } } } as never,
    performance: performance as never,
    MutationObserver: Observer as never,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  });
  const mutate = (child: { appLoading: boolean }) => (children.push(child), notify());
  return { children, shell, body, timers, mutate, notify, stop, options: () => options, root };
}

test("the shell stays while #root is empty or anything in it is still data-app-loading, then fades out over 100ms", () => {
  const h = harness();
  expect(h.options()).toEqual({ childList: true, subtree: true, attributes: true, attributeFilter: ["data-app-loading"] });
  h.notify();
  expect(h.body.has("loaded")).toBe(false);
  h.mutate({ appLoading: true });
  expect(h.body.has("loaded")).toBe(false);
  expect(h.shell.removed).toBe(false);
  // The boot fallback's attribute goes (the app rendered its first screen).
  h.children[0]!.appLoading = false;
  h.notify();
  expect(h.body.has("loaded")).toBe(true);
  expect(h.shell.style.transitionDuration).toBe("100ms");
  expect(h.shell.removed).toBe(false);
  expect(h.timers).toHaveLength(1);
  expect(h.timers[0]!.ms).toBe(100);
  h.timers[0]!.fn();
  expect(h.shell.removed).toBe(true);
  // Once handed over, later mutations do nothing.
  h.mutate({ appLoading: false });
  expect(h.timers).toHaveLength(1);
});

test("a reload that has not painted swaps at once, as Linear's `D`; one that painted still fades", () => {
  const instant = harness({ reload: true });
  instant.mutate({ appLoading: false });
  expect(instant.shell.style.transitionDuration).toBe("0ms");
  expect(instant.shell.removed).toBe(true);
  expect(instant.timers).toHaveLength(0);
  const faded = harness({ reload: true, painted: true });
  faded.mutate({ appLoading: false });
  expect(faded.shell.style.transitionDuration).toBe("100ms");
  expect(firstPaintPending({ getEntriesByType: () => [] })).toBe(false);
});

test("appPainted needs a child and no data-app-loading inside", () => {
  expect(appPainted({ childElementCount: 0, querySelector: () => null })).toBe(false);
  expect(appPainted({ childElementCount: 1, querySelector: () => ({}) as Element })).toBe(false);
  expect(appPainted({ childElementCount: 1, querySelector: () => null })).toBe(true);
});

test("the app's boot states hold the shell instead of printing Loading: App before its first screen, a pending route", () => {
  expect(renderToStaticMarkup(<AppLoading />)).toMatch(/^<div data-app-loading="true" aria-busy="true"/);
  const boot = renderToStaticMarkup(<App />);
  expect(boot).toContain("data-app-loading");
  expect(boot).not.toContain("Loading");
  const router = createAppRouter(createMemoryHistory(), {} as RouteContext);
  const pending = renderToStaticMarkup(createElement(router.options.defaultPendingComponent as ComponentType));
  expect(pending).toMatch(/^<div data-app-loading="true"/);
});
