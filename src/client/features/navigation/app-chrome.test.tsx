import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { commit } from "@/client/state/store";
import { latestNotification } from "@/client/state/app-notifications";
import { toasts } from "@/client/components/toast-queue";
import { SidebarToggle, boardEntries } from "./app-chrome";

afterEach(() => commit({ sidebarHidden: false }));

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

test("R3-chrome-D8: a sidebar board's menu says Copy link and confirms with Linear's Link copied to clipboard", async () => {
  const written: string[] = [];
  const clipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard");
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void written.push(text) } });
  const hadLocation = "location" in globalThis;
  if (!hadLocation) Object.assign(globalThis, { location: new URL("http://app.test/") });
  try {
    const entries = boardEntries({ id: 7, name: "Seven", columns: [] });
    expect(entries.map((entry) => entry.name)).toEqual(["Favorite", "Copy link", "Open in new tab"]);
    entries[1]!.run?.();
    await Bun.sleep(0);
    expect(written).toEqual([`${location.origin}/board/7/all`]);
    expect(latestNotification()?.text).toBe("Link copied to clipboard");
  } finally {
    if (clipboard) Object.defineProperty(globalThis.navigator, "clipboard", clipboard);
    else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
    if (!hadLocation) delete (globalThis as { location?: unknown }).location;
    toasts.dismissAll();
  }
});
