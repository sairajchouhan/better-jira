import { afterEach, expect, spyOn, test } from "bun:test";
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary } from "./error-boundary";
import { OverlayBoundary } from "./overlay-boundary";
import { toasts } from "./toast-queue";

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
afterEach(() => toasts.dismissAll());

// Ship bar blocker 3, overlays: the server renderer skips error boundaries, so the boundary is driven through its own lifecycle
// (error-boundary.test.tsx does the same): the state React derives from the throw, what renders in place, then componentDidCatch.
test("a picker that throws closes, with a toast naming it and the error; it renders nothing in the meantime", () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  let closed = 0;
  const element = OverlayBoundary({ label: "Change status", close: () => closed++, children: "rows" }) as ReactElement<
    ConstructorParameters<typeof ErrorBoundary>[0]
  >;
  const boundary = new ErrorBoundary(element.props);
  const error = new TypeError("Cannot read properties of undefined (reading 'name')");
  boundary.state = ErrorBoundary.getDerivedStateFromError(error);
  expect(renderToStaticMarkup(boundary.render() as ReactElement)).toBe("");
  boundary.componentDidCatch(error, { componentStack: "" });
  quiet.mockRestore();
  expect(closed).toBe(1);
  const [toast] = toasts.all();
  const html = renderToStaticMarkup(toast!.content as ReactElement);
  expect(html).toContain('role="alert"');
  expect(html).toContain("Something went wrong");
  expect(html).toContain("Change status");
  expect(html).toContain("Cannot read properties of undefined (reading &#x27;name&#x27;)");
});

test("every overlay primitive contains its content: menus, popovers, hover cards, toasts, dialogs, and Shell's overlay slot", async () => {
  const surface = await source("./menu-surface.tsx");
  // MenuSurface (every menu, picker, command menu and the ⌘K palette) and the toolbar Popover close on a throw.
  expect(surface.match(/<OverlayBoundary label=\{label\} close=\{close\}>\s*<ElevationScope level=\{elevation\.level\}>\{children\}/g)).toHaveLength(2);
  expect(await source("./hover-card.tsx")).toMatch(/<OverlayBoundary label=\{label \?\? "Card"\} close=\{actions\.close\}>\s*\{children\}/);
  // A toast that throws dismisses itself and raises no toast of its own.
  expect(await source("./toast.tsx")).toMatch(/<ErrorBoundary fallback=\{null\} onError=\{context\.dismiss\}>\s*\{content\}/);
  // A dialog keeps its box and shows the failure inside it, under its Close (DialogScope: both render branches).
  const dialog = await source("./dialog.tsx");
  expect(dialog).toMatch(/<ErrorBoundary fallback=\{<DialogError label=\{label\} \/>\}>\{children\}<\/ErrorBoundary>/);
  expect(dialog.match(/<DialogScope label=\{label\}/g)).toHaveLength(2);
  // Shell's overlay slot catches a throw above the surface (the palette's own body), keyed so the next overlay starts clean; the
  // boards are outside it.
  const app = await source("../App.tsx");
  const slot = app.match(/<OverlayBoundary key=\{overlay\}[\s\S]*?<\/OverlayBoundary>/)?.[0] ?? "";
  expect(slot).toContain('{overlay === "palette" && <CommandPalette />}');
  expect(slot).toContain("<PropertyPicker");
  expect(slot).toContain("<CreateIssue />");
  expect(slot).not.toContain("<BoardView");
});
