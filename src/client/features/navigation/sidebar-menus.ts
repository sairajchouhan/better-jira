/**
 * The sidebar's right-click menus, built the way Linear builds them (startup-root):
 * - a personal item (Inbox, My issues): `yPn(key)`, then the SidebarLink's own `O$n.build` link group;
 * - the More menu: `yPn(Jp.more_workspace)`, the hidden items and then Customize sidebar;
 * - a board row: the team row's `g3()`;
 * - a favorite: `d5n`'s actions.
 * One builder per kind, so the right-click and any button that opens the same menu list the same rows.
 */
import type { Board } from "@/shared/issue-model";
import { defaultPreferences } from "@/shared/view-model";
import type { ActionEntry } from "@/client/components/action-menu";
import { get, set } from "@/client/state/store";
import { showNotification } from "@/client/state/app-notifications";
import { removeBoard } from "@/client/state/server-data";
import { placeURL, ui } from "./app-navigation";
import { toggleFavorite } from "./favorites";

/** Linear's sidebar visibility preferences (`$xe`) and their labels (`eSe`). */
export const VISIBILITY = {
  Always: "Always show",
  WithNotifications: "Show when badged",
  MoreMenu: "Don't show",
} as const;
export type Visibility = keyof typeof VISIBILITY;
export type SidebarItem = "inbox" | "myIssues";
export type SidebarPrefs = { collapsed: string[]; inbox: Visibility; myIssues: Visibility };
export const SIDEBAR_PREFS: SidebarPrefs = { collapsed: [], inbox: "Always", myIssues: "Always" };

/** Linear's `OPn`: Always for every item, Show when badged only for badged items (`JY`: Inbox), and Don't show for every
 *  item but Inbox (`DPn`), which can't move to More. The Customize sidebar dialog and the row's Visibility submenu share it. */
export const visibilityOptions = (item: SidebarItem): Visibility[] =>
  item === "inbox" ? ["Always", "WithNotifications"] : ["Always", "MoreMenu"];

const visibility = (item: SidebarItem, v: unknown): Visibility =>
  typeof v === "string" && (visibilityOptions(item) as string[]).includes(v) ? (v as Visibility) : "Always";
export const parseSidebarPrefs = (raw: unknown): SidebarPrefs => {
  const r = (raw ?? {}) as Partial<Record<keyof SidebarPrefs, unknown>>;
  return {
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((c) => typeof c === "string") : [],
    inbox: visibility("inbox", r.inbox),
    myIssues: visibility("myIssues", r.myIssues),
  };
};

/** Linear's `Yn.joinActionGroupsWithDividers`: each non-empty group after the first starts with a divider. */
export function joinGroups(...groups: ActionEntry[][]): ActionEntry[] {
  return groups
    .filter((group) => group.length)
    .flatMap((group, g) => group.map((entry, i) => (i === 0 ? { ...entry, divider: g > 0 } : entry)));
}

const copy = (url: string, toast: string) =>
  void navigator.clipboard.writeText(url).then(
    () => showNotification({ text: toast }),
    (e) => showNotification({ text: String(e) }),
  );
const openInNewTab = (url: string) => window.open(url, "_blank", "noopener");

/** The SidebarLink's own rows (`O$n.build`): Copy link (`iX`, toast "Link copied to clipboard") and Open in new tab (`n4`; Linear
 *  shows it in its desktop app, where it opens an app tab, and here it opens a browser tab). */
export function linkEntries(url: () => string): ActionEntry[] {
  return [
    { name: "Copy link", icon: "link", run: () => copy(url(), "Link copied to clipboard") },
    { name: "Open in new tab", icon: "external", run: () => openInNewTab(url()) },
  ];
}

const customizeSidebar: ActionEntry = {
  name: "Customize sidebar",
  icon: "side",
  run: () => ui.send({ type: "overlay.open", overlay: "customize-sidebar" }),
};
const ITEM = {
  inbox: { name: "Inbox", url: () => placeURL({ to: "inbox" }) },
  // Linear's My issues row links to the tab last open (`myIssuesLastTab`), Assigned by default.
  myIssues: { name: "My issues", url: () => placeURL({ to: "person", person: null, tab: get().personTab }) },
} as const;

type Prefs = { prefs: SidebarPrefs; setPrefs: (prefs: SidebarPrefs) => void };
/** Linear's Visibility submenu (`SPn`): the item's options (`xPn`), the current one checked. */
function visibilityEntry(item: SidebarItem, { prefs, setPrefs }: Prefs): ActionEntry {
  return {
    name: "Visibility",
    icon: "eye",
    children: visibilityOptions(item).map((v) => ({
      name: VISIBILITY[v],
      selected: prefs[item] === v,
      run: () => setPrefs({ ...prefs, [item]: v }),
    })),
  };
}

/**
 * A personal sidebar row's right-click menu (chrome-54), Linear's `yPn(key)` plus the link group:
 * Inbox: Mark all notifications as read (`gEn`, while anything is unread, its ⌥U hint dropped), ┄ Visibility ▸, Customize sidebar,
 * ┄ Copy link, Open in new tab. My issues: the same without Mark all.
 */
export function sidebarItemEntries(
  item: SidebarItem,
  options: Prefs & { unread?: number; markAllRead?: () => void },
): ActionEntry[] {
  const mark: ActionEntry[] =
    item === "inbox" && options.unread && options.markAllRead
      ? [{ name: "Mark all notifications as read", icon: "check", run: options.markAllRead }]
      : [];
  return joinGroups(mark, [visibilityEntry(item, options), customizeSidebar], linkEntries(ITEM[item].url));
}

/** Linear's More menu (`yPn(Jp.more_workspace)`, chrome-53): every item set to Don't show, then ┄ Customize sidebar. */
export function moreEntries(prefs: SidebarPrefs, open: Record<SidebarItem, () => void>, shortcut: Record<SidebarItem, ActionEntry["shortcut"]>): ActionEntry[] {
  const hidden = (["inbox", "myIssues"] as const)
    .filter((item) => prefs[item] === "MoreMenu")
    .map((item): ActionEntry => ({
      name: ITEM[item].name,
      icon: item === "inbox" ? "inbox" : "user",
      shortcut: shortcut[item],
      run: open[item],
    }));
  return joinGroups(hidden, [customizeSidebar]);
}

export const boardURL = (board: Pick<Board, "id">) =>
  placeURL({ to: "board", board: board.id, scope: (get().preferences[board.id] ?? defaultPreferences()).scope });
/** Copy URL as Linear's team `gBn` names it in a contextual menu, with its ⌘⇧, hint and "Team URL copied to clipboard" toast. */
export const boardCopyURL = (board: Board, shortcut?: ActionEntry["shortcut"]): ActionEntry => ({
  name: "Copy URL",
  icon: "link",
  shortcut,
  run: () => copy(boardURL(board), "Board URL copied to clipboard"),
});

/**
 * A sidebar board's right-click menu, as Linear's team row (`g3()`: Join team, Favorite, ┄ Team settings, Copy URL, Open archive,
 * ┄ Subscribe ▸, Configure Slack…, ┄ Leave team…), with what Jira backs: Favorite, ┄ Board settings (Jira's board configuration),
 * Copy URL, and ┄ Remove from sidebar in Leave team's place, only for a board added in the app (BJ-24).
 */
export function boardEntries(board: Board, shortcut?: ActionEntry["shortcut"]): ActionEntry[] {
  const id = `board:${board.id}`,
    favorite = get().favorites.includes(id);
  return joinGroups(
    [{ name: favorite ? "Unfavorite" : "Favorite", icon: favorite ? "starred" : "star", run: () => toggleFavorite(id) }],
    [
      {
        name: "Board settings",
        icon: "external",
        run: () => openInNewTab(`${get().site}/secure/RapidView.jspa?rapidView=${board.id}`),
      },
      boardCopyURL(board, shortcut),
    ],
    board.removable
      ? [
          {
            name: "Remove from sidebar",
            icon: "close",
            run: () =>
              void removeBoard(board.id).then(
                () => showNotification({ text: `Removed ${board.name}`, detail: "Add it again from Add board." }),
                (error: Error) => set({ perf: error.message }),
              ),
          },
        ]
      : [],
  );
}

/** A Favorites row's right-click menu, Linear's `d5n` for every kind of favorite: Copy URL (`b6n`), Open in new tab (`n4`),
 *  ┄ Remove favorite (`W1`). Move to… (`S6n`) needs favorite folders, which this app doesn't have. */
export function favoriteEntries(id: string, url: () => string): ActionEntry[] {
  return joinGroups(
    [
      { name: "Copy URL", icon: "link", run: () => copy(url(), "URL copied to clipboard") },
      { name: "Open in new tab", icon: "external", run: () => openInNewTab(url()) },
    ],
    [{ name: "Remove favorite", icon: "close", run: () => toggleFavorite(id) }],
  );
}
