import { expect, test } from "bun:test";
import { focusLost, placed, placedProps, watchPlacement } from "./menu-surface";

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

// Ship round 2: ⌘K pressed right after load (focus on <body>) opened an invisible palette. React Aria's Popover stays hidden
// (useEnterAnimation's opacity 0 and clip) until it has placed itself from its trigger, and the menu had no trigger to give it.
test("a menu with nothing to anchor to still gives React Aria a trigger, so it can place and show itself", async () => {
  const surface = await source("./menu-surface.tsx");
  expect(surface).toContain("const [trigger] = useState(() => ({ current: anchor ?? fallback ?? document.body }));");
  expect(surface).not.toMatch(/current: anchor \?\? fallback \?\? null/);
});

// Once placed, React Aria writes its own top and max-height onto the node (measured against the trigger, the whole page for
// ⌘K: the palette sat below the window with max-height 0). Our edges go through custom properties index.css applies with
// !important, so they hold over React Aria's writes on every menu and toolbar popover.
test("our placement's edges hold over the ones React Aria writes onto the node", async () => {
  expect(placed({ position: "fixed", width: 720, left: 340, top: 110, maxHeight: 774 })).toEqual({
    position: "fixed",
    width: 720,
    "--placed-top": "110px",
    "--placed-left": "340px",
    "--placed-right": "auto",
    "--placed-bottom": "auto",
    "--placed-max-height": "774px",
  } as never);
  expect(placed({ top: "12vh", maxHeight: "80vh" })).toMatchObject({ "--placed-top": "12vh", "--placed-max-height": "80vh" });
  expect(placed(undefined)).toMatchObject({ visibility: "hidden", "--placed-top": "0px", "--placed-left": "0px" });
  const css = await source("../index.css");
  for (const edge of ["top", "left", "right", "bottom", "max-height"])
    expect(css).toContain(`${edge}: var(--placed-${edge}, ${edge === "max-height" ? "none" : "auto"}) !important;`);
  expect(placedProps({ top: 4 }, 60)).toMatchObject({ "data-placed": true, style: { position: "fixed", zIndex: 60, "--placed-top": "4px" } });
  // Every popup we place goes through it: the toolbar Popover and MenuSurface, and a submenu (it sat where React Aria put it,
  // past the window's bottom: a 1044-label Labels submenu ended at 1053 in a 969px window).
  expect((await source("./menu-surface.tsx")).match(/\{\.\.\.placedProps\(/g)).toHaveLength(2);
  expect((await source("./menu.tsx")).match(/\{\.\.\.placedProps\(/g)).toHaveLength(1);
});

// FILTER-21: Dates widened (k3e) as Completed date's submenu opened, and moved left; the submenu stayed where it was, over Dates.
test("a placement re-runs as its followed box resizes, and only the popup's own box otherwise", () => {
  const observed: unknown[] = [];
  const callbacks: (() => void)[] = [];
  const real = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      callbacks.push(callback);
    }
    observe(target: unknown) {
      observed.push(target);
    }
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    const popup = {} as HTMLElement,
      parent = {} as Element;
    let runs = 0;
    const stop = watchPlacement(popup, () => ++runs, () => {}, parent);
    expect(observed).toEqual([popup, parent]);
    callbacks[0]!();
    expect(runs).toBe(2);
    stop();
    observed.length = 0;
    watchPlacement(popup, () => 0, () => {})();
    expect(observed).toEqual([popup]);
  } finally {
    globalThis.ResizeObserver = real;
  }
});

// Comment options › Edit: Edit focused the comment editor while the menu still held the page inert, so the focus was refused, and
// the menu's return focus then put it on the Comment options button. A table command's view.focus() likewise, and the return
// focus's plain focus() on the editor dropped its caret out of the cell.
test("a row's action runs on a live page: what runs inside a popup closes it by first letting go of the page", async () => {
  const surface = await source("./menu-surface.tsx");
  expect(surface).toContain("flushSync(() => setReleased(true));\n    close();");
  // Both popups that give MenuSurfaceContext: their rows get the release, and React Aria's Popover turns non-modal with it.
  expect(surface.match(/<MenuSurfaceContext value=\{\{ close: release \}\}>/g)).toHaveLength(2);
  expect(surface.match(/isNonModal=\{released\}/g)).toHaveLength(2);
  expect(surface).not.toContain("<MenuSurfaceContext value={{ close }}>");
});

test("handing focus back takes only lost focus, never focus the action moved", () => {
  const body = {},
    opener = {},
    editor = {},
    search = {};
  const popup = { contains: (node: never) => node === search };
  expect(focusLost(body, body, popup)).toBe(true);
  expect(focusLost(null, body, popup)).toBe(true);
  expect(focusLost(search, body, popup)).toBe(true);
  expect(focusLost(editor, body, popup)).toBe(false);
  expect(focusLost(opener, body, null)).toBe(false);
});
