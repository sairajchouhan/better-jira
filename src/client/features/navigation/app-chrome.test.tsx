import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { commit, get } from "@/client/state/store";
import { PeekCloseZone, SIDEBAR_PEEK } from "./app-chrome";
import { SidebarToggle } from "./breadcrumbs";

afterEach(() => commit({ sidebarHidden: false, sidebarPeek: false }));

test("R3-chrome-D3: on a wide window the header's Menu button shows only while the sidebar is hidden, to expand it (Linear r5)", () => {
  commit({ sidebarHidden: false });
  // Shown sidebar: the button is the narrow window's Menu only.
  expect(renderToStaticMarkup(<SidebarToggle />)).toMatch(/class="[^"]*\bmd:hidden\b/);
  commit({ sidebarHidden: true });
  const hidden = renderToStaticMarkup(<SidebarToggle />);
  expect(hidden).not.toContain("md:hidden");
  expect(hidden).toContain('aria-label="Menu"');
  expect(hidden).toMatch(/title="Expand navigation sidebar[^"]*\[/);
});

test("R3-F3: the peeking sidebar floats below the header, so the Menu toggle it came from stays reachable (Linear floating panel top)", () => {
  expect(SIDEBAR_PEEK).toContain("top-[41.5px]");
  expect(SIDEBAR_PEEK).not.toContain("inset-y-0");
  expect(SIDEBAR_PEEK).not.toMatch(/\btop-0\b/);
});

test("R3-F3: the pointer on the page outside the header's leading 128px closes the peek (Linear's floating backdrop)", () => {
  const markup = renderToStaticMarkup(<PeekCloseZone />);
  // The zone starts below the header and 8px in; over the header only its band from 128px on closes.
  expect(markup).toMatch(/class="[^"]*\btop-12\b[^"]*\bleft-2\b/);
  expect(markup).toContain("after:left-[120px]");
  for (const handler of ["onMouseEnter", "onMouseMove", "onMouseDown"] as const) {
    commit({ sidebarHidden: true, sidebarPeek: true });
    const zone = (PeekCloseZone().props as { children: { props: Record<string, () => void> } }).children;
    zone.props[handler]!();
    expect(get().sidebarPeek).toBe(false);
  }
});

