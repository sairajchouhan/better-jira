import { expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppError, ErrorBoundary, SurfaceError } from "./error-boundary";
import { Avatar } from "./avatar";

// Ship bar blocker 3: one bad record (`user.name[0]` on a nameless assignee) emptied #root, and after a reload the boot
// splash stayed on "Loading…". The server renderer skips error boundaries, so the boundary is driven through its own
// lifecycle: the state React derives from the throw, then what it renders in the children's place.
function renderFailed(fallback: ReactElement | false, error: unknown) {
  const boundary = new ErrorBoundary({ fallback, children: createElement("p", null, "board") });
  boundary.state = ErrorBoundary.getDerivedStateFromError(error);
  return renderToStaticMarkup(boundary.render() as ReactElement);
}

test("a nameless assignee renders an initial, not a throw that blanks the app", () => {
  const poisoned = { id: "acc-9" } as unknown as { id: string; name: string };
  expect(renderToStaticMarkup(createElement(Avatar, { user: poisoned }))).toContain(">?</span>");
});

test("a render error anywhere shows what failed with Reload and Download backup, never an empty root or the splash", () => {
  const html = renderFailed(<AppError />, new TypeError("Cannot read properties of undefined (reading '0')"));
  expect(html).toContain('role="alert"');
  expect(html).toContain("Something went wrong");
  expect(html).toContain("Cannot read properties of undefined (reading &#x27;0&#x27;)");
  expect(html).toContain(">Reload</button>");
  expect(html).toContain(">Download backup</button>");
  // boot-shell.ts hands the splash over once #root holds something not marked as loading.
  expect(html).not.toContain("data-app-loading");
});

test("a board that fails shows its error in its place with Try again; hidden, it shows nothing", () => {
  const board = (shown: boolean) => shown && <SurfaceError title="Couldn't show Payments" />;
  const html = renderFailed(board(true), new Error("bad column"));
  expect(html).toContain("Couldn&#x27;t show Payments");
  expect(html).toContain("bad column");
  expect(html).toContain(">Try again</button>");
  expect(renderFailed(board(false), new Error("bad column"))).toBe("");
  // Without a failure, the children render as they are.
  expect(renderToStaticMarkup(createElement(ErrorBoundary, { fallback: null }, "board"))).toBe("board");
});

test("the app and every board are wrapped: main.tsx around App, the shell around each BoardView", async () => {
  const main = await Bun.file(new URL("../main.tsx", import.meta.url)).text();
  const app = await Bun.file(new URL("../App.tsx", import.meta.url)).text();
  expect(main).toMatch(/<ErrorBoundary fallback=\{<AppError \/>\}>[\s\S]*<App \/>[\s\S]*<\/ErrorBoundary>/);
  expect(app).toMatch(/<ErrorBoundary\s+key=\{b\.id\}[\s\S]*?<BoardView[\s\S]*?<\/ErrorBoundary>/);
  // A failed first route load is rethrown into the boundary, not left on the splash.
  expect(app).toMatch(/router\.load\(\)\.then\([\s\S]*?throw error;/);
});
