import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { commit, get } from "@/client/state/store";
import { PeekCloseZone, SIDEBAR_PEEK, SIDEBAR_TIPS, spaceTip } from "./app-chrome";
import { sidebarTip } from "./sidebar-link";
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


// Linear's sidebar rows (`h$`) draw no shortcut in the row; a row with one shows it in a tooltip to its right (`wZ` position right),
// the action's name then its caps. The Sidebar needs a router and a browser to render, so its source is read for the rows' wiring.
const sidebarSource = async () => {
  const chrome = await Bun.file(new URL("./app-chrome.tsx", import.meta.url)).text();
  return chrome.slice(chrome.indexOf("export function Sidebar("), chrome.indexOf('id="help-menu"'));
};

test("sidebar rule: a row's shortcut is a tooltip to its right, the action's name then its caps (Linear `h$` → `wZ`)", () => {
  expect(sidebarTip("Go to inbox", ["G", "I"])).toEqual({ title: "Go to inbox (G then I)", "data-tip": "right" });
  expect(SIDEBAR_TIPS).toEqual({
    inbox: { title: "Go to inbox (G then I)", "data-tip": "right" },
    myIssues: { title: "Go to my issues (G then M)", "data-tip": "right" },
    search: { title: "Search (/)", "data-tip": "right" },
  });
});

test("sidebar rule: no row draws its shortcut inline; Inbox, My issues and Search carry the tooltip, Inbox keeps its count", async () => {
  const nav = await sidebarSource();
  expect(nav).not.toContain("<Shortcut");
  const inbox = nav.slice(nav.indexOf('place: { to: "inbox" }'), nav.indexOf("</SidebarLink>"));
  expect(inbox).toContain("{...SIDEBAR_TIPS.inbox}");
  expect(inbox).toContain("data-inbox-badge");
  expect(nav).toMatch(/place: \{ to: "my-issues" \}[^>]*\{\.\.\.SIDEBAR_TIPS\.myIssues\}/);
  expect(nav).toMatch(/runShortcut\("search"\)\} \{\.\.\.SIDEBAR_TIPS\.search\}/);
});

test("a space row's tooltip is Linear's team Home row: its name and Ctrl ⇧ N for the first nine, the name alone after (`r4`)", async () => {
  expect(spaceTip("Mine", 0)).toEqual({ title: "Mine (Ctrl ⇧ 1)", "data-tip": "right" });
  expect(spaceTip("Ops (EU)", 8)).toEqual({ title: "Ops (EU) (Ctrl ⇧ 9)", "data-tip": "right" });
  expect(spaceTip("Ops (EU)", 9)).toEqual({ title: "Ops (EU)", "data-tip": "right", "data-tip-plain": "" });
  const nav = await sidebarSource();
  const spaces = nav.slice(nav.indexOf("boards.map("), nav.indexOf("</SidebarLink>", nav.indexOf("boards.map(")));
  expect(spaces).toContain("{...spaceTip(b.name, index)}");
});
