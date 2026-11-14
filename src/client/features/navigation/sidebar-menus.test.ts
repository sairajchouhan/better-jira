import { joinGroups } from "@/client/components/action-menu";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { commit, get } from "@/client/state/store";
import { latestNotification } from "@/client/state/app-notifications";
import { toasts } from "@/client/components/toast-queue";
import { savedFavorites } from "@/client/state/browser-preferences";
import type { ActionEntry } from "@/client/components/action-menu";
import {
  SIDEBAR_PREFS,
  boardEntries,
  favoriteEntries,
  moreEntries,
  parseSidebarPrefs,
  sidebarItemEntries,
  visibilityOptions,
  type SidebarPrefs,
} from "./sidebar-menus";

/** The rows as the menu draws them: "┄" before a row that starts a group, "▸" after a submenu. */
const rows = (entries: ActionEntry[]) =>
  entries.map((e) => `${e.divider ? "┄ " : ""}${e.name}${e.children ? " ▸" : ""}`);

const written: string[] = [],
  opened: string[] = [];
const saved = {
  clipboard: Object.getOwnPropertyDescriptor(globalThis.navigator, "clipboard"),
  location: "location" in globalThis,
  window: "window" in globalThis,
};
// Another file (store.test.ts) may already have installed a read-only `window`; stub `open` on whichever window is there.
const win = () => (globalThis as unknown as { window: { open?: unknown } }).window;
let savedOpen: unknown;
beforeEach(() => {
  written.length = opened.length = 0;
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void written.push(text) },
  });
  if (!saved.location) Object.assign(globalThis, { location: new URL("http://app.test/") });
  if (!saved.window) Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  savedOpen = win().open;
  win().open = (url: string) => void opened.push(url);
  commit({ favorites: [], site: "https://jira.test" });
});
afterEach(() => {
  if (saved.clipboard) Object.defineProperty(globalThis.navigator, "clipboard", saved.clipboard);
  else delete (globalThis.navigator as { clipboard?: unknown }).clipboard;
  if (!saved.location) delete (globalThis as { location?: unknown }).location;
  // A later file's module code reads `window` as "in a browser" and then `location`, so neither may outlive this file's tests.
  win().open = savedOpen;
  if (!saved.window) delete (globalThis as { window?: unknown }).window;
  toasts.dismissAll();
});

const noop = () => {};
const withPrefs = (prefs: SidebarPrefs = SIDEBAR_PREFS) => ({ prefs, setPrefs: noop });

test("chrome-54: Inbox's right-click menu is Linear's yPn(inbox) and link group", () => {
  expect(rows(sidebarItemEntries("inbox", { ...withPrefs(), unread: 3, markAllRead: noop }))).toEqual([
    "Mark all notifications as read",
    "┄ Visibility ▸",
    "Customize sidebar",
    "┄ Copy link",
    "Open in new tab",
  ]);
  // Nothing unread: no Mark all (gEn's applicable), and Visibility opens the menu without a divider above it.
  expect(rows(sidebarItemEntries("inbox", { ...withPrefs(), unread: 0, markAllRead: noop }))[0]).toBe("Visibility ▸");
});

test("chrome-54: My issues' right-click menu has Visibility, Customize sidebar and the link group", () => {
  expect(rows(sidebarItemEntries("myIssues", withPrefs()))).toEqual([
    "Visibility ▸",
    "Customize sidebar",
    "┄ Copy link",
    "Open in new tab",
  ]);
});

test("chrome-54: Visibility lists the item's own options (Linear OPn), checks the current one, and saves the pick", () => {
  let next: SidebarPrefs | undefined;
  const visibility = (item: "inbox" | "myIssues", prefs: SidebarPrefs) =>
    sidebarItemEntries(item, { prefs, setPrefs: (p) => (next = p) }).find((e) => e.name === "Visibility")!.children!;
  const inbox = visibility("inbox", { ...SIDEBAR_PREFS, inbox: "WithNotifications" });
  expect(inbox.map((e) => [e.name, !!e.selected])).toEqual([
    ["Always show", false],
    ["Show when badged", true],
  ]);
  const mine = visibility("myIssues", SIDEBAR_PREFS);
  expect(mine.map((e) => e.name)).toEqual(["Always show", "Don't show"]);
  mine[1]!.run!();
  expect(next).toEqual({ ...SIDEBAR_PREFS, myIssues: "MoreMenu" });
});

test("Inbox can't move to More (Linear DPn); a stored Don't show for it reads as Always", () => {
  expect(visibilityOptions("inbox")).not.toContain("MoreMenu");
  expect(parseSidebarPrefs({ inbox: "MoreMenu", myIssues: "WithNotifications" })).toEqual(SIDEBAR_PREFS);
});

test("chrome-54: Copy link copies the row's address with Linear's toast", async () => {
  const copyLink = sidebarItemEntries("myIssues", withPrefs()).find((e) => e.name === "Copy link")!;
  copyLink.run!();
  await Bun.sleep(0);
  expect(written).toEqual([`${location.origin}/my-issues`]);
  expect(latestNotification()?.text).toBe("Link copied to clipboard");
});

test("chrome-53: the More menu lists the hidden items, then Customize sidebar", () => {
  const more = moreEntries(
    { ...SIDEBAR_PREFS, myIssues: "MoreMenu" },
    { inbox: noop, myIssues: noop },
    { inbox: "G I", myIssues: "G M" },
  );
  expect(rows(more)).toEqual(["My issues", "┄ Customize sidebar"]);
  expect(more[0]!.shortcut).toBe("G M");
});

test("a sidebar board's menu is Linear's team menu (g3) with what Jira backs", async () => {
  expect(rows(boardEntries({ id: 7, name: "Seven", columns: [] }))).toEqual(["Favorite", "┄ Board settings", "Copy URL"]);
  commit({ favorites: ["board:7"] });
  const entries = boardEntries({ id: 7, name: "Seven", columns: [], removable: true }, "Mod+Shift+,");
  expect(rows(entries)).toEqual(["Unfavorite", "┄ Board settings", "Copy URL", "┄ Remove from sidebar"]);
  expect(entries[2]!.shortcut).toBe("Mod+Shift+,");
  entries[2]!.run!();
  await Bun.sleep(0);
  expect(written).toEqual([`${location.origin}/board/7/all`]);
  expect(latestNotification()?.text).toBe("Board URL copied to clipboard");
  entries[1]!.run!();
  expect(opened).toEqual(["https://jira.test/secure/RapidView.jspa?rapidView=7"]);
});

test("every favorite gets Linear's favorite menu (d5n): Copy URL, Open in new tab, ┄ Remove favorite", () => {
  commit({ favorites: ["view:v1", "KAN-1"] });
  const entries = favoriteEntries("view:v1", () => "http://app.test/view/v1");
  expect(rows(entries)).toEqual(["Copy URL", "Open in new tab", "┄ Remove favorite"]);
  entries[1]!.run!();
  expect(opened).toEqual(["http://app.test/view/v1"]);
  // Remove favorite toggles the stored list (toggleFavorite), so it flips the favorite whatever this test's storage holds.
  const before = savedFavorites().includes("view:v1");
  entries[2]!.run!();
  expect(get().favorites.includes("view:v1")).toBe(!before);
});

test("joinGroups starts each non-empty group after the first with a divider, as Linear's joinActionGroupsWithDividers", () => {
  const a = { name: "a", divider: true },
    b = { name: "b" },
    c = { name: "c" };
  expect(rows(joinGroups([], [a, b], [], [c]))).toEqual(["a", "b", "┄ c"]);
});
