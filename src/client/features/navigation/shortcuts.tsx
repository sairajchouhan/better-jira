import { newSubIssueDraft } from "@/client/features/issue/sub-issue-draft";
import { hasLocalDraft, RESUME_EDITING } from "@/client/features/issue/composer-local-draft";
import { type Issue } from "@/shared/issue-model";
import { lastToastLink, showNotification } from "@/client/state/app-notifications";
import { toasts } from "@/client/components/toast-queue";
import { recentIssues } from "./recents";
import { isMyIssues } from "./navigation";
import { issueCrumbs, pageIssue, stepIssues } from "./issue-trail";
import { useEffect, useState } from "react";
import { VIEW_SHORTCUT_IDS, viewShortcutId } from "@/client/features/views/view-shortcut";
import { createToolbarView } from "@/client/features/views/view-toolbar-actions";
import { GROUPING_ACTION, ORDERING_ACTION } from "@/client/features/views/view-choices";
import { activeView, saveOverlayToView } from "@/client/features/views/saved-views";
import { canMergeOverlay } from "@/shared/saved-view-model";
import { boardView, filterCount, groupStep, groupVisibility, visibleOrder } from "@/shared/view-model";
import { collapseTarget } from "@/client/features/views/group-collapse";
import { forgetIssueIntents, post, run as command } from "./commands";
import { canHaveSubIssues } from "@/shared/issue-properties";
import { epicLocked, epicOf, listsSubIssues, nestable, titleParentOf } from "@/shared/epics";
import { childrenByParent } from "@/client/features/issue/sub-issue-model";
import { getHotkeyManager, type Hotkey, type HotkeyChord } from "@tanstack/react-hotkeys";
import { boardOf, get, isWatching, ME, set, useStore, type Overlay, issueBoardId } from "@/client/state/store";
import { actions, beginCreate, beginCreateInView } from "@/client/state/issue-actions";
import { currentKey } from "@/client/state/jira-sync";
import { redoEdit, undoEdit } from "@/client/state/undo-history";
import { navigate, openIssueByKey, ui, pageURL } from "./app-navigation";
import { toggleFavorite } from "./favorites";
import { dropPlan } from "@/client/routes/board-drop";
import {
  clearFilters,
  setDisplay,
  toggleAllCollapsed,
  toggleCollapsed,
  updateRule,
  viewSettings,
} from "@/client/features/views/view-settings";
import { copyIssue, PAGE_URL_COPIED, type CopyKind } from "@/client/features/issue/issue-copy";
import { codeBlockBindings, editorBindings } from "@/client/features/editor/editor-bindings";
import { Dialog } from "@/client/components/dialog";
import { actionMenuOpen } from "@/client/components/open-action-menus";
import { TextInput } from "@/client/components/field";
import { Shortcut as KeyboardShortcut, type Keys } from "@/client/components/keycap";
import { Text } from "@/client/components/text";
import { shortcutMatches, shortcutSections } from "./shortcut-panel";
import { goToPullRequests } from "@/client/features/issue/card-badges";
import { followPeek, isPeekOpen, togglePeek } from "@/client/features/views/view-peek-state";
import {
  clearFilters as clearInboxFilters,
  deleteAll,
  deleteRow,
  hasSelectedRow,
  markAllRead,
  moveRow,
  openRow,
  openSnooze,
  priorityInbox,
  showTab,
  toggleRead,
  undoInbox,
} from "@/client/features/inbox/inbox";
import { copyText } from "@/client/lib/clipboard";

type State = ReturnType<typeof get>;
type Shortcut = {
  id: string;
  name: string;
  group: string;
  /** Absent for ⌘K-only commands, as Linear's "Copy issue as Markdown". */
  hotkey?: Hotkey;
  issue?: boolean;
  document?: boolean;
  run: () => void;
  /** Whether it would act, from the state and the issue it would act on only: the ⌘K list calls it in a store selector. */
  when?: (s: State, issue: Issue | undefined) => boolean;
  /** The ⌘K row's name when it depends on state, e.g. "Unfavorite issue". */
  label?: () => string;
  /** Faint text after the ⌘K row's name, read as the list renders (Linear's action `detail`). */
  detail?: () => string | undefined;
};
/** The issue a menu item runs a shortcut on (`runShortcut(id, key)`); a right-click menu's issue never becomes the selection. */
let acting: string | null = null;
const selected = (s = get()) => {
  const key = acting ?? (s.overlay && s.target) ?? (!s.document && s.selected);
  return key ? s.issues.get(key) : undefined;
};
/** The issue the title line names, and ⌘⇧↑ and ⌘⇧→ open: the parent Task ("Sub-issue of"), else the epic ("In epic")
 *  (shared/epics.ts titleParentOf, BJ-289). */
const titleParentIn = (s: State, issue: Issue | undefined) => issue && titleParentOf(issue, (key) => s.issues.get(key))?.key;
/** Linear: an issue shortcut acts on the row under the pointer or keyboard focus, as its row menu's hints promise: a sub-issue row
 *  (its section answers the command), else a board card or list row (its React Aria row's `data-key`, ISSUE-10). */
const hoveredRow = () => {
  const key =
    command("hovered-sub-issue") ??
    globalThis.document?.querySelector<HTMLElement>("[data-key][role=row]:hover")?.dataset.key;
  return key ? get().issues.get(key) : undefined;
};
const lastViewed = (s: State) =>
  recentIssues().map((key) => s.issues.get(currentKey(key))).find((i) => i && i.key !== s.selected);
const viewOf = (s: State) => s.savedViews.find((v) => v.id === s.activeViewId);
/** A menu's own issue (`runShortcut(id, key)`) wins over the row under the pointer, which wins over the selection, as in
 *  `overlay()`; a hovered card needs no selection (ISSUE-10). */
const target = () => (!acting && hoveredRow()) || selected();
const issueAction = (fn: (issue: Issue) => void) => () => {
  const issue = target();
  if (issue) fn(issue);
};
const overlay = (value: NonNullable<Overlay>) => () => {
  ui.send({ type: "overlay.open", overlay: value, target: null });
};
/** An issue's picker or menu, on the issue `target()` acts on when that isn't the selection. */
const issueOverlay = (value: NonNullable<Overlay>) => () => {
  ui.send({ type: "overlay.open", overlay: value, target: acting ?? hoveredRow()?.key ?? null });
};
/** Open the issue and keep the intent, for that issue only, until its field owner mounts. */
const focus = (name: "focus-title" | "focus-comment" | "edit-description" | "change-subscribers") =>
  issueAction((issue) => {
    navigate({ selected: issue.key, panel: true });
    post(name, issue.key);
  });
const order = () => visibleOrder(get(), ME.id);
function move(direction: number, horizontal = false) {
  if (get().inbox && !horizontal) return moveRow(direction);
  const s = get(),
    cols = order(),
    flat = [...new Map(cols.flat().map((i) => [i.key, i])).values()];
  if (s.panel && !horizontal) {
    // On an issue page, ↑/↓ step through what its counter counts (the list it opened over, or the Sub-issues section it opened
    // from) and keep the trail, as Linear's `jf` steps the siblings of the breadcrumb's list state.
    const page = pageIssue(s) ? s.issues.get(s.selected!) : undefined;
    const list = page ? stepIssues(issueCrumbs(page, s.trail, s.issues, s.boards), flat) : flat;
    const index = list.findIndex((i) => i.key === s.selected);
    if (page && index < 0) return;
    const next = list[index < 0 ? 0 : index + direction];
    if (next) navigate({ selected: next.key, trail: s.trail });
    return;
  }
  const col = cols.findIndex((c) => c.some((i) => i.key === s.selected)),
    row = cols[col]?.findIndex((i) => i.key === s.selected) ?? 0;
  let next: Issue | undefined;
  if (col < 0) next = flat[0];
  else if (horizontal) {
    for (let c = col + direction; c >= 0 && c < cols.length; c += direction) {
      next =
        cols[c]!.filter((i) => i.key !== s.selected)[row] ??
        cols[c]!.find((i) => i.key !== s.selected);
      if (next) break;
    }
  } else next = cols[col]?.[row + direction];
  if (!next) return;
  navigate({ selected: next.key });
  followPeek(next.key);
}
/** The status Move left/right takes the issue to on a status-grouped board: the first status of the nearest group the board
 *  shows (Linear's `Pvr`/`Fvr`, board layout only: `kvr`). */
function columnTarget(issue: Issue, direction: number, s = get()) {
  const view = boardView(s, ME.id);
  if (!view || view.prefs.display.columns !== "status" || view.prefs.display.layout !== "board") return undefined;
  const group = groupStep(view.columns, view.prefs, issue.key, direction);
  return group && boardOf(issue.key)?.columns.find((c) => c.name === group.id)?.statuses[0];
}
function moveColumn(direction: number) {
  const issue = selected(),
    status = issue && columnTarget(issue, direction);
  if (issue && status) actions.status(issue.key, status.id);
}
/** Whether `issue` can step `direction` within its group, to an edge with `edge` (Linear's `Vvr`/`Bvr`: not already first/last). */
function canReorder(issue: Issue, direction: number, s = get()) {
  const list = visibleOrder(s, ME.id).find((c) => c.some((i) => i.key === issue.key));
  return !!list && list.length > 1 && list.at(direction < 0 ? 0 : -1)!.key !== issue.key;
}
function reorder(direction: number, edge = false) {
  // The sub-issue row under the pointer moves within its parent's manual order (Linear's Move…, R3-relations-D4).
  const child = command("hovered-sub-issue");
  if (child) {
    command("reorder-sub-issue", { key: child, move: edge ? (direction < 0 ? "top" : "bottom") : direction < 0 ? "up" : "down" });
    return;
  }
  const issue = selected();
  if (!issue) return;
  const list = order().find((c) => c.some((i) => i.key === issue.key));
  if (!list) return;
  const i = list.findIndex((x) => x.key === issue.key),
    rest = list.filter((x) => x.key !== issue.key),
    at = edge
      ? direction < 0
        ? 0
        : rest.length
      : Math.max(0, Math.min(rest.length, i + direction));
  if (at === i) return;
  const board = issueBoardId(issue);
  const { descending } = viewSettings(board).display;
  // The same plan as a drag's drop (Linear's Move up/down/top/bottom run its drop, `moveModelsInNewPosition` → `kFn`): ranked
  // beside the card it now sits by in the group as shown, never one a filter hides.
  const [place] = dropPlan(list, [issue.key], rest[at]?.key, { manual: true, descending }, get().issues);
  if (place) actions.drop(issue.key, board, [], place);
}
const manual = (s = get()) => viewSettings(s.board, s).display.ordering === "manual";
/** Linear's Move… sub-actions (`Ivr`), in its order. */
export const MOVES = [
  ["reorder-top", "Move to top"],
  ["reorder-up", "Move up"],
  ["column-right", "Move right"],
  ["reorder-down", "Move down"],
  ["column-left", "Move left"],
  ["reorder-bottom", "Move to bottom"],
] as const;
type MoveId = (typeof MOVES)[number][0];
/** Whether Move… lists the move for `issue` (Linear's `applicable`), and why it is disabled when it is listed but can't run
 *  (`disabledReason`): up/down/top/bottom need a manually ordered group. Linear's moves need the list's own metadata
 *  (`c4`/`kvr` read `metadataOfType(bX)`), so they apply only while the board is on screen: never on a full-page issue,
 *  a document or the Inbox, where ⌥←/⌥→ would write the issue's status to Jira (R3-palette-shortcuts-D1). */
export function moveAvailability(id: MoveId, issue: Issue | undefined, s = get()): { disabledReason?: string } | null {
  if (!issue || !listVisible(s)) return null;
  if (id === "column-left" || id === "column-right")
    return columnTarget(issue, id === "column-left" ? -1 : 1, s) ? {} : null;
  if (!canReorder(issue, id === "reorder-top" || id === "reorder-up" ? -1 : 1, s)) return null;
  return manual(s) ? {} : { disabledReason: "This group is not ordered manually" };
}
function scope(value: "active" | "backlog" | "all", mine = false) {
  navigate({ mine, ...(!mine && isMyIssues(get()) ? { board: get().board } : {}), panel: false, selected: null, scope: value });
}
function copy(kind: CopyKind) {
  const issue = target();
  if (issue) void copyIssue(kind, issue);
}
function relation(kind: string) {
  ui.send({ type: "overlay.open", overlay: "relations", kind, target: hoveredRow()?.key ?? null });
}
function collapse(all = false) {
  // The groups the list shows, as boardView lays them out for J/K: never the board's unfiltered groups (BJ-278).
  const s = get(),
    view = boardView(s, ME.id),
    target = view && collapseTarget(groupVisibility(view.columns, view.prefs).show, s.selected, all);
  if (!view || !target) return;
  if (target.from) toggleAllCollapsed(view.board.id, target.ids, target.from);
  else toggleCollapsed(view.board.id, target.ids);
}

/** Live Linear Chrome reference, 6 Nov 2026. Only existing personal workflows are included. */
export const shortcuts: Shortcut[] = [
  ...(
    [
      { id: "rename", name: "Rename document", hotkey: "Shift+R" },
      { id: "favorite", name: "Favorite document", hotkey: "Alt+F" },
      { id: "authors", name: "Show document author names", hotkey: "Shift+A" },
      { id: "remind", name: "Remind me about document", hotkey: "Shift+H" },
      { id: "subscribers", name: "Change document subscribers", hotkey: "Mod+Shift+S" },
      { id: "copy-url", name: "Copy document URL", hotkey: "Mod+Shift+," },
      { id: "copy-title", name: "Copy document title", hotkey: "Mod+Shift+'" },
      // Outside text fields only; a page text selection keeps the browser's own copy.
      { id: "copy-link", name: "Copy document title as link", hotkey: "Mod+C" },
      { id: "copy-markdown", name: "Copy document content as Markdown", hotkey: "Mod+Alt+C" },
    ] as const
  ).map((entry): Shortcut => ({
    ...entry,
    id: `document-${entry.id}`,
    document: true,
    group: "Documents",
    when: (s) => !!s.document,
    run: () => void command("document-action", entry.id),
  })),
  {
    id: "commands",
    name: "Open command menu",
    group: "General",
    hotkey: "Mod+K",
    run: () => ui.send({ type: "palette.toggle" }),
  },
  {
    id: "help",
    name: "Open help menu",
    group: "General",
    hotkey: "Shift+?",
    run: overlay("help"),
  },
  {
    id: "shortcuts",
    name: "View keyboard shortcuts",
    group: "General",
    hotkey: "Mod+/",
    run: () =>
      get().overlay === "shortcuts" ? ui.send({ type: "overlay.close" }) : overlay("shortcuts")(),
  },
  {
    id: "search",
    name: "Open search",
    group: "General",
    hotkey: "/",
    run: overlay("search"),
  },
  {
    id: "back",
    name: "Back / clear selection",
    group: "General",
    hotkey: "Escape",
    run: () =>
      get().columnSelection.size
        ? set({ columnSelection: new Set() })
        : get().sidebarOpen
          ? set({ sidebarOpen: false })
          : get().inbox && get().panel && get().view === "page" && !get().document
            ? navigate({ view: "side" })
            : ui.send({ type: "escape" }),
  },
  {
    id: "undo",
    name: "Undo",
    group: "General",
    hotkey: "Mod+Z",
    run: undoEdit,
  },
  {
    id: "redo",
    name: "Redo",
    group: "General",
    hotkey: "Mod+Shift+Z",
    run: redoEdit,
  },
  {
    id: "sidebar",
    name: "Toggle left sidebar",
    group: "Navigation",
    hotkey: "[",
    // Below 768px the sidebar opens over the page instead (Linear's Menu button).
    run: () => {
      // A peek ends with the toggle, so hiding the sidebar again doesn't bring it back floating.
      set({ sidebarPeek: false });
      if (matchMedia("(max-width: 767.98px)").matches) set({ sidebarOpen: !get().sidebarOpen });
      else ui.send({ type: "sidebar.toggle" });
    },
  },
  {
    id: "details",
    name: "Toggle right sidebar",
    group: "Navigation",
    hotkey: "]",
    when: (s) => !s.document,
    run: () =>
      get().panel
        ? set({ issuePropertiesHidden: !get().issuePropertiesHidden })
        : set({ details: !get().details }),
  },
  {
    id: "open-issue",
    name: "Open issue",
    group: "Navigation",
    hotkey: ["O", "I"],
    run: overlay("issues"),
  },
  {
    id: "open-document",
    name: "Open document",
    group: "Navigation",
    hotkey: ["O", "D"],
    run: overlay("documents"),
  },
  {
    id: "open-user",
    name: "Open user",
    group: "Navigation",
    hotkey: ["O", "U"],
    run: overlay("users"),
  },
  {
    id: "active",
    name: "Go to active issues",
    group: "Navigation",
    hotkey: ["G", "A"],
    run: () => scope("active"),
  },
  {
    id: "backlog",
    name: "Go to backlog",
    group: "Navigation",
    hotkey: ["G", "B"],
    run: () => scope("backlog"),
  },
  {
    id: "all",
    name: "Go to all issues",
    group: "Navigation",
    hotkey: ["G", "E"],
    run: () => scope("all"),
  },
  {
    id: "inbox",
    name: "Go to inbox",
    group: "Navigation",
    hotkey: ["G", "I"],
    run: () => navigate({ inbox: true, selected: null, panel: false }),
  },
  ...(
    [
      ["inbox-read", "Mark as read / unread", "U", () => toggleRead()],
      ["inbox-read-all", "Mark all notifications as read", "Alt+U", () => void markAllRead()],
      ["inbox-delete", "Delete notification", "E", () => deleteRow()],
      ["inbox-backspace", "Delete notification", "Backspace", () => deleteRow()],
      [
        "inbox-delete-read",
        "Delete all read notifications",
        "Shift+Backspace",
        () => deleteAll("read"),
      ],
      ["inbox-snooze", "Snooze notification…", "H", () => hasSelectedRow() && openSnooze({ invoked: "keyboard" })],
    ] as const
  ).map(([id, name, hotkey, run]): Shortcut => ({
    id,
    name,
    hotkey,
    group: "Inbox",
    run,
    // Enablement is computed on store changes, and the inbox selection lives outside the store: row actions check it when they run.
    when: (s) => s.inbox,
  })),
  {
    id: "inbox-undo",
    name: "Undo",
    group: "Inbox",
    hotkey: "Z",
    run: undoInbox,
    when: (s) => s.inbox,
  },
  ...(
    [
      ["inbox-priority", "Show priority notifications", "Alt+1", "direct"],
      ["inbox-other", "Show other notifications", "Alt+2", "watching"],
    ] as const
  ).map(([id, name, hotkey, tab]): Shortcut => ({
    id,
    name,
    hotkey,
    group: "Inbox",
    run: () => showTab(tab),
    // The tabs exist only in the priority inbox; the Inbox's own display option, outside the store, read per key and ⌘K open
    // (R3-palette-shortcuts-D6).
    when: (s) => s.inbox && priorityInbox(),
  })),
  {
    id: "mine",
    name: "Go to my issues",
    group: "Navigation",
    hotkey: ["G", "M"],
    run: () => scope("all", true),
  },
  {
    id: "favorite-open",
    name: "Open a favorite",
    group: "Navigation",
    hotkey: ["O", "F"],
    run: overlay("favorites"),
  },
  {
    id: "team-open",
    name: "Open space",
    group: "Navigation",
    hotkey: ["O", "T"],
    run: overlay("boards"),
  },
  { id: "board-add", name: "Add space", group: "Navigation", run: overlay("add-board") },
  {
    id: "customize-sidebar",
    name: "Customize sidebar",
    group: "Navigation",
    run: overlay("customize-sidebar"),
  },
  // Linear's "Preferences" (Go, G then S, Navigation group `fO`): opens its preferences modal (features/navigation/preferences.tsx).
  {
    id: "preferences",
    name: "Preferences",
    group: "Navigation",
    hotkey: ["G", "S"],
    run: overlay("preferences"),
  },
  ...Array.from({ length: 9 }, (_, i): Shortcut => ({
    id: `team-${i + 1}`,
    name: `Go to space ${i + 1}`,
    group: "Navigation",
    hotkey: `Control+Shift+${i + 1}` as Hotkey,
    when: (s) => !!s.boards[i],
    run: () => {
      const board = get().boards[i];
      if (board) navigate({ board: board.id, selected: null, panel: false });
    },
  })),
  {
    id: "view-open",
    name: "Open view",
    group: "Navigation",
    hotkey: ["O", "V"],
    run: overlay("views"),
  },
  {
    id: "display",
    name: "Show display options",
    group: "Navigation",
    hotkey: "Shift+V",
    run: () => ui.send({ type: "toolbar.open", toolbar: "display" }),
    when: boardVisible,
  },
  {
    // ⌘K only, like Linear's: the last issue opened before the selected one.
    id: "last-viewed",
    name: "Open last viewed issue",
    group: "Navigation",
    when: (s) => !!lastViewed(s),
    run: () => {
      const issue = lastViewed(get());
      if (issue) navigate({ board: issueBoardId(issue), selected: issue.key, panel: true, trail: null });
    },
  },
  {
    id: "toast-open",
    name: "Open link from last toast",
    group: "Navigation",
    hotkey: "Mod+Alt+O",
    when: () => !!lastToastLink(),
    run: () => {
      // Like the toast's View issue: a key Jira has since replaced still finds the issue.
      const issue = get().issues.get(currentKey(lastToastLink() ?? ""));
      if (issue) navigate({ board: issueBoardId(issue), selected: issue.key, panel: true, trail: null });
    },
  },
  {
    id: "dismiss-toast",
    name: "Dismiss all toasts",
    group: "Navigation",
    hotkey: "Mod+Alt+X",
    run: () => toasts.dismissAll(),
  },
  {
    id: "new",
    name: "New issue",
    group: "Issues",
    hotkey: "C",
    run: () => beginCreateInView(),
    // Linear's FAST_CREATE_ISSUE: `detail: e => { if (e.fastCreateStates.issue.hasLocalDraft) return "Resume editing" }`.
    detail: () => (hasLocalDraft(get().namespace) ? RESUME_EDITING : undefined),
  },
  {
    id: "new-full",
    name: "Create issue in fullscreen…",
    group: "Issues",
    hotkey: "V",
    run: () => {
      // Only a composer that opened takes the full-screen intent; a refused create (storage down) leaves none behind.
      if (beginCreateInView()) post("create-expanded", undefined);
    },
  },
  ...(
    [
      ["assign", "Assign issue to user", "A", "assign"],
      ["status", "Change issue status", "S", "status"],
      ["priority", "Change priority", "P", "priority"],
      ["type", "Change issue type", "Shift+T", "type"],
      ["labels", "Change labels", "L", "labels"],
      ["due", "Set due date", "Shift+D", "due"],
      ["remind", "Remind me", "Shift+H", "reminder"],
      ["project", "Add to epic", "Shift+P", "project"],
      ["milestone", "Add to milestone", "Shift+M", "milestone"],
    ] as const
  ).map(([id, name, hotkey, value]) => ({
    id,
    name,
    hotkey,
    group: "Issues",
    issue: true,
    // The project is the issue's epic (shared/epics.ts): only a standard issue picks one, and Linear's `zBn` reads "Move to
    // project…" once the issue is in one. The Jira project itself never changes.
    ...(id === "project"
      ? {
          when: (s: State, issue?: Issue) => !!issue && !epicLocked(issue, (key) => s.issues.get(key)),
          label: () => {
            const issue = target();
            return issue && epicOf(issue, (key) => get().issues.get(key)) ? "Move to epic" : "Add to epic";
          },
        }
      : {}),
    run: issueOverlay(value),
  })),
  {
    id: "assign-me",
    name: "Assign to me",
    label: () => (target()?.assignee?.id === ME.id ? "Un-assign from me" : "Assign to me"),
    group: "Issues",
    hotkey: "I",
    issue: true,
    run: issueAction((i) => actions.assign(i.key, i.assignee?.id === ME.id ? null : ME)),
  },
  {
    id: "remove-due",
    name: "Remove due date",
    group: "Issues",
    hotkey: "Mod+Shift+D",
    issue: true,
    when: (_, issue) => !!issue?.due,
    run: issueAction((i) => actions.patch(i.key, { due: null })),
  },
  {
    id: "rename",
    name: "Rename",
    group: "Issues",
    hotkey: "Shift+R",
    issue: true,
    run: focus("focus-title"),
  },
  {
    id: "description",
    name: "Focus issue description input",
    group: "Issues",
    hotkey: "Control+Shift+I",
    issue: true,
    run: focus("edit-description"),
  },
  {
    id: "favorite",
    name: "Mark as favorite",
    label: () =>
      get().favorites.includes(selected()?.key ?? "") ? "Unfavorite issue" : "Mark as favorite",
    group: "Issues",
    hotkey: "Alt+F",
    when: (s) => !viewOf(s) || !boardVisible(s),
    issue: true,
    run: issueAction((i) => toggleFavorite(i.key)),
  },
  {
    id: "delete",
    name: "Delete issue",
    group: "Issues",
    hotkey: "Mod+Backspace",
    issue: true,
    run: issueAction((i) => actions.remove(i.key)),
  },
  {
    id: "subscribers",
    name: "Change subscribers",
    group: "Issues",
    hotkey: "Mod+Shift+S",
    issue: true,
    run: focus("change-subscribers"),
  },
  {
    id: "subscribe",
    name: "Subscribe to issue",
    label: () =>
      selected() && isWatching(selected()!) ? "Unsubscribe from issue" : "Subscribe to issue",
    group: "Issues",
    hotkey: "Shift+S",
    issue: true,
    run: issueAction((i) =>
      actions.patch(i.key, {
        watchers: i.watchers?.some((w) => w.id === ME.id)
          ? i.watchers.filter((w) => w.id !== ME.id)
          : [...(i.watchers ?? []), ME],
      }),
    ),
  },
  ...(
    [
      ["blocked", "Mark as blocked", "B"],
      ["blocking", "Mark as blocking", "X"],
      ["related", "Reference related issue", "R"],
      ["duplicate", "Mark as duplicate", "M"],
    ] as const
  ).map(([id, name, last]) => ({
    id,
    name,
    group: "Issues",
    hotkey: ["M", last] as Hotkey,
    issue: true,
    run: () => relation(id),
  })),
  {
    id: "link",
    name: "Link any URL to issue",
    group: "Issues",
    hotkey: "Control+L",
    issue: true,
    run: () => {
      post("issue-options-start", "link");
      navigate({ panel: true });
      issueOverlay("options")();
    },
  },
  {
    id: "sub-issue",
    name: "Create sub-issue",
    group: "Issues",
    hotkey: "Mod+Shift+O",
    issue: true,
    run: issueAction((i) => {
      if (!canHaveSubIssues(get(), i)) {
        set({
          perf: listsSubIssues(i)
            ? `Jira has no issue type below ${i.type}, so ${i.key} can't have sub-issues`
            : `${i.key} sits above epics: its epics join it in Jira, not as sub-issues`,
        });
        return;
      }
      // Under an epic, the new issue goes into it as the Epic picker puts it there (subIssueParent).
      if (!command("create-sub-issue", i.key)) beginCreate(newSubIssueDraft(i));
    }),
  },
  {
    id: "parent-set",
    name: "Set parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+P",
    issue: true,
    // An epic is a project and an initiative sits above them: neither has a parent issue. Any other issue opens the picker, as
    // Linear's `hFn` applies to every issue; it lists only parents Jira takes.
    when: (_, i) => !i || nestable(i),
    run: () => relation("parent"),
  },
  {
    id: "parent-open",
    name: "Open parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowUp",
    issue: true,
    // Linear's OPEN_PARENT_ISSUE is applicable while the issue has a parent and opens it. Ours opens what the "Sub-issue of" line
    // names: the parent Task, else the epic (titleParentOf, BJ-289); an epic or an issue in neither has none, so it is hidden.
    // A parent no board holds opens too, kept first (BJ-354), as Linear's hydrates a parent its sync didn't bring.
    when: (s) => !!titleParentIn(s, selected(s)),
    run: issueAction((i) => {
      const parent = titleParentIn(get(), i);
      if (parent) openIssueByKey(parent);
    }),
  },
  {
    id: "sub-issues-of-parent",
    name: "Open sub-issues of parent",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowRight",
    issue: true,
    when: (s) => !!s.issues.get(titleParentIn(s, selected(s)) ?? ""),
    // The parent's sub-issue menu lives in the open issue.
    run: () => {
      navigate({ panel: true });
      post("open-parent-sub-issues", get().selected!);
    },
  },
  {
    id: "child-open",
    name: "Open sub-issue",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowDown",
    issue: true,
    when: (s) => {
      const key = selected(s)?.key;
      return !!key && !!childrenByParent(s.issues).get(key)?.length;
    },
    run: issueAction((i) => {
      const child = childrenByParent(get().issues).get(i.key)?.[0];
      if (child) navigate({ board: issueBoardId(child), selected: child.key, panel: true });
    }),
  },
  ...(
    [
      ["copy-id", "Copy issue id", "Mod+.", "ID"],
      ["copy-branch", "Copy git branch name", "Mod+Shift+.", "git branch name"],
      ["copy-url", "Copy issue URL", "Mod+Shift+,", "URL"],
      ["copy-title", "Copy issue title", "Mod+Shift+'", "title"],
      ["copy-link", "Copy issue title as link", "Mod+C", "title as link"],
      ["copy-issue-markdown", "Copy issue as Markdown", undefined, "issue as Markdown"],
      ["copy-markdown", "Copy everything as Markdown", "Mod+Alt+C", "everything as Markdown"],
      // Linear's wX: ⌘⌥P, which runs even from a text field (runWithInputFocus).
      ["copy-prompt", "Copy as prompt", "Mod+Alt+P", "as prompt"],
    ] as const
  ).map(([id, name, hotkey, kind]) => ({
    id,
    name,
    hotkey,
    group: "Issues",
    issue: true,
    run: () => void copy(kind),
  })),
  {
    id: "comment",
    name: "Comment on issue",
    group: "Comments",
    hotkey: "Control+M",
    issue: true,
    run: focus("focus-comment"),
  },
  {
    // Linear's `xpn`: ⇧→ (and ⇧←) on an issue with pull requests; one opens, several list from the card's badge.
    id: "go-pull-requests",
    name: "Go to linked pull request…",
    group: "Issues",
    hotkey: "Shift+ArrowRight",
    issue: true,
    when: (_s, issue) => !!issue?.prCount,
    run: issueAction((issue) => {
      if (issue.prCount) void goToPullRequests(issue);
    }),
  },
  {
    id: "peek",
    name: "Peek into item",
    group: "List / Board",
    hotkey: "Space",
    // Linear's view peek (view-peek-state.ts) over the list or board, not beside an open issue (R3-palette-shortcuts-D1). It peeks
    // the card under the pointer, as S/A/P/L act on (`target()`), since Linear's list focus follows the pointer; an open peek
    // closes on the next press wherever the pointer is.
    when: (s, issue) => listVisible(s) && !s.panel && (!!issue || isPeekOpen()),
    run: () => togglePeek(target()?.key),
  },
  {
    id: "open",
    name: "Open focused item",
    group: "List / Board",
    hotkey: "Enter",
    issue: true,
    when: boardVisible,
    run: () => (get().inbox ? openRow() : navigate({ panel: true, view: "page" })),
  },
  {
    id: "layout",
    name: "Toggle layout view",
    group: "List / Board",
    hotkey: "Mod+B",
    run: () => {
      const d = viewSettings(get().board).display;
      setDisplay(get().board, {
        layout: d.layout === "board" ? "list" : "board",
      });
    },
  },
  {
    id: "copy-page",
    name: "Copy page URL",
    group: "List / Board",
    hotkey: "Mod+Shift+C",
    run: () => {
      void copyText(pageURL())
        // Linear's Copy page URL toast (startup-root `Current URL copied to clipboard`).
        .then(() => showNotification(PAGE_URL_COPIED))
        .catch(() => set({ perf: "Could not access the clipboard" }));
    },
  },
  ...(
    [
      ["up", "Move up", "ArrowUp", -1, false],
      ["up-vim", "Move up", "K", -1, false],
      ["down", "Move down", "ArrowDown", 1, false],
      ["down-vim", "Move down", "J", 1, false],
      ["left", "Move left", "ArrowLeft", -1, true],
      ["right", "Move right", "ArrowRight", 1, true],
    ] as const
  ).map(([id, name, hotkey, dir, horizontal]) => ({
    id,
    name,
    hotkey,
    group: "List / Board",
    // Up/down also step through issues on the issue page and rows in the Inbox; left/right walk board columns only.
    ...(horizontal ? { when: listVisible } : {}),
    run: () => move(dir, horizontal),
  })),
  ...(
    [
      ["reorder-up", "Move one position up", "Alt+ArrowUp", -1, false],
      ["reorder-down", "Move one position down", "Alt+ArrowDown", 1, false],
      ["reorder-top", "Move to top of group", "Alt+Shift+ArrowUp", -1, true],
      ["reorder-bottom", "Move to bottom of group", "Alt+Shift+ArrowDown", 1, true],
    ] as const
  ).map(([id, name, hotkey, dir, edge]) => ({
    id,
    name,
    hotkey,
    group: "List / Board",
    issue: true,
    // Board moves act on the selection (or a menu's issue), never the card that slides under the pointer as the board
    // re-lays out; a hovered sub-issue row reorders within its parent (R3-relations-D4).
    when: (s: State, issue: Issue | undefined) => {
      if (issue && issue.key === command("hovered-sub-issue")) return true;
      const move = moveAvailability(id, selected(s), s);
      return !!move && !move.disabledReason;
    },
    run: () => reorder(dir, edge),
  })),
  {
    id: "column-left",
    name: "Move to left column",
    group: "List / Board",
    hotkey: "Alt+ArrowLeft",
    issue: true,
    when: (s) => !!moveAvailability("column-left", selected(s), s),
    run: () => moveColumn(-1),
  },
  {
    id: "column-right",
    name: "Move to right column",
    group: "List / Board",
    hotkey: "Alt+ArrowRight",
    issue: true,
    when: (s) => !!moveAvailability("column-right", selected(s), s),
    run: () => moveColumn(1),
  },
  {
    id: "collapse",
    name: "Collapse/expand group",
    group: "List / Board",
    hotkey: "T",
    issue: true,
    when: (s) => listVisible(s) && viewSettings(s.board, s).display.layout === "list",
    run: () => collapse(),
  },
  {
    id: "collapse-all",
    name: "Collapse/expand all groups",
    group: "List / Board",
    hotkey: "Alt+T",
    when: (s) => listVisible(s) && viewSettings(s.board, s).display.layout === "list",
    run: () => collapse(true),
  },
  {
    // Linear's useGroupingMenu `d` (⌥⇧G): the command menu on the grouping choices, without the Display menu.
    id: "grouping",
    name: GROUPING_ACTION.name,
    group: "List / Board",
    hotkey: "Alt+Shift+G",
    when: listVisible,
    run: overlay("grouping"),
  },
  {
    // Linear's useOrderingMenu `_` (⌥⇧O): the command menu on the ordering choices.
    id: "ordering",
    name: ORDERING_ACTION.name,
    group: "List / Board",
    hotkey: "Alt+Shift+O",
    when: listVisible,
    run: overlay("ordering"),
  },
  {
    id: "find",
    name: "Find in view",
    group: "Filters",
    hotkey: "Mod+F",
    when: boardVisible,
    // The Inbox's own field (Linear's inbox find) takes it there and keeps its state with the inbox.
    run: () => {
      if (!get().inbox) set({ findInView: true });
      post("focus-find", undefined);
    },
  },
  {
    id: "filter",
    name: "Add filter",
    group: "Filters",
    hotkey: "F",
    when: boardVisible,
    // Linear opens under the chip row's "+" once the board has filters, under the toolbar button otherwise.
    run: () =>
      get().inbox
        ? ui.send({ type: "overlay.open", overlay: "inbox-filter" })
        : ui.send({ type: "toolbar.open", toolbar: filterCount(viewSettings(get().board).filters) ? "add-filter" : "filter" }),
  },
  {
    id: "view-create",
    name: "Create new view…",
    group: "Views",
    hotkey: "Alt+V",
    when: (s) => boardVisible(s) && !s.inbox,
    run: createToolbarView,
  },
  {
    id: "view-save",
    name: "Save to this view",
    group: "Views",
    hotkey: "Alt+S",
    when: (s) => {
      const view = viewOf(s);
      return boardVisible(s) && !!view && filterCount(s.overlayFilters) > 0 && canMergeOverlay(view.filters, s.overlayFilters);
    },
    run: () => {
      void saveOverlayToView().catch(() =>
        showNotification({
          text: "Could not save view. Try again.",
        }),
      );
    },
  },
  {
    id: "view-favorite",
    name: "Favorite / unfavorite view",
    group: "Views",
    hotkey: "Alt+F",
    when: (s) => boardVisible(s) && !!viewOf(s),
    run: () => {
      const view = activeView();
      if (view) toggleFavorite(`view:${view.id}`);
    },
  },
  {
    id: "filter-clear",
    name: "Clear all filters",
    group: "Filters",
    hotkey: "Alt+Shift+F",
    when: boardVisible,
    run: () => {
      if (get().inbox) return clearInboxFilters();
      clearFilters(get().board);
    },
  },
  {
    id: "filter-last",
    name: "Clear last issue filter",
    group: "Filters",
    hotkey: "Shift+F",
    when: boardVisible,
    run: () => {
      const { filters } = viewSettings(get().board);
      const last = filters.children.at(-1);
      if (last) updateRule(get().board, last.id, null);
    },
  },
];
/** Board filters and display act only while the board is on screen, not behind a full-page issue or a document. */
function boardVisible(s = get()) {
  return !s.document && (!s.panel || s.view !== "page");
}
/** The issue list or board itself is on screen: the board, not the Inbox's notification list in its place. */
function listVisible(s = get()) {
  return boardVisible(s) && !s.inbox;
}
/** A shortcut's registry hotkey by id, for every `shortcut`/`keys` prop; "" when it has none. Caps come from
 *  `chordKeys`, which already draws Help's "Shift+?" as "?". */
export const hotkeyOf = (id: string): Keys => shortcuts.find((s) => s.id === id)?.hotkey ?? "";
/** Whether the shortcut would do something in `state` on `issue`, reading nothing else, so a store selector can call it.
 *  `issue` defaults to the selection; keys, clicks and menus pass `target()`, which the sub-issue row under the pointer can change. */
export function shortcutApplies(entry: Shortcut, state: State = get(), issue = selected(state)) {
  return (
    (!state.document || (!entry.issue && entry.group !== "List / Board")) &&
    (!entry.issue || !!issue) &&
    (!entry.when || entry.when(state, issue))
  );
}
export function canRunShortcut(id: string) {
  const entry = shortcuts.find((s) => s.id === id);
  return !!entry && shortcutApplies(entry, get(), target());
}
export function runShortcut(id: string, key?: string) {
  const entry = shortcuts.find((s) => s.id === id);
  acting = key ?? null;
  try {
    if (entry && shortcutApplies(entry, get(), target())) entry.run();
  } finally {
    acting = null;
  }
}
/** Whether a key may run the shortcut now: an open menu or toolbar keeps the keys, except ⌘K and ⌘/ that close their own.
 *  An open action menu keeps them wherever focus is, as Linear's isActionMenuOpen does (BJ-216: ⇧⌘. beside the PR menu's
 *  "Copy branch name" must not copy the issue's branch); ⌘K and ⌘/ still pass it, as before.
 *  ⌘C keeps the browser's copy whenever page text is selected. */
export function hotkeyEnabled(entry: Shortcut, s: State, issue: Issue | undefined, menuOpen = actionMenuOpen()) {
  return (
    s.boards.length > 0 &&
    ((!s.overlay && !s.toolbar && (!menuOpen || entry.id === "commands" || entry.id === "shortcuts")) ||
      (entry.id === "commands" && s.overlay === "palette") ||
      (entry.id === "shortcuts" && s.overlay === "shortcuts")) &&
    (entry.hotkey !== "Mod+C" || !!getSelection()?.isCollapsed) &&
    shortcutApplies(entry, s, issue)
  );
}
/** Linear binds G then each of these keys (`keyboardShortcut:{key:["g", …]}` in startup-root.CnUSfl4j.js: Preferences, projects,
 *  views, Loops, cycles…), and its resolver tries the whole sequence before the last key alone. The ones we have no command
 *  for are reserved as inert chords, so G then S/P/L/U/T/V never falls through to that key's own shortcut
 *  (R3-palette-shortcuts-D2: G U toggled a notification's read state in Atlassian). */
const LINEAR_G_CHORD_KEYS = [..."-ABCDEFIJLMNPQRSTUVWX"] as HotkeyChord[];
export const reservedChords: Shortcut[] = LINEAR_G_CHORD_KEYS.filter(
  (key) => !shortcuts.some((s) => Array.isArray(s.hotkey) && s.hotkey[0] === "G" && s.hotkey[1] === key),
).map((key) => ({ id: `reserved-g-${key}`, name: `G then ${key}`, group: "Navigation", hotkey: ["G", key], run: () => {} }));
/** Registers the keyboard map once. Which shortcuts are enabled is worked out from the store at each key press,
 *  before the hotkey listener sees it, so a store change (a Jira poll) re-renders and re-registers nothing. */
export function useLinearHotkeys() {
  // An intent for an issue lapses once that issue is no longer the open one.
  const open = useStore((s) => (s.panel && !s.document ? s.selected : null));
  useEffect(() => forgetIssueIntents(open), [open]);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const id = viewShortcutId(event);
      if (
        !id ||
        event.defaultPrevented ||
        !get().boards.length ||
        get().overlay ||
        get().toolbar ||
        actionMenuOpen()
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[data-media-interactive]',
        )
      )
        return;
      if (canRunShortcut(id)) {
        event.preventDefault();
        runShortcut(id);
      }
    };
    document.addEventListener("keydown", handle);
    const bound = [...shortcuts, ...reservedChords]
      .filter((entry) => entry.hotkey && !VIEW_SHORTCUT_IDS.includes(entry.id))
      .map((entry) => ({
        entry,
        handle: getHotkeyManager().register(
          entry.hotkey!,
          (event: KeyboardEvent) => {
            if (
              event.target instanceof Element &&
              event.target.closest("[data-media-interactive]") &&
              !(
                (event.metaKey || event.ctrlKey) &&
                (entry.id === "commands" || entry.id === "shortcuts")
              )
            )
              return;
            runShortcut(entry.id);
          },
          {
            enabled: hotkeyEnabled(entry, get(), target()),
            ignoreInputs: !(
              entry.id === "shortcuts" ||
              entry.id === "commands" ||
              entry.id === "sub-issue" ||
              entry.id === "copy-prompt"
            ),
            ignoreDefaultPrevented: true,
            afterDelegatedHandlers: true,
            meta: { name: entry.name, group: entry.group } as { name: string },
            // Document and issue shortcuts share keys on purpose; `enabled` keeps exactly one of each pair active.
            ...(shortcuts.some(
              (other) =>
                other !== entry &&
                other.hotkey === entry.hotkey &&
                !!other.document !== !!entry.document,
            )
              ? { conflictBehavior: "allow" as const }
              : {}),
          },
        ),
      }));
    const sync = () => {
      const s = get(),
        issue = target();
      for (const { entry, handle } of bound) handle.setOptions({ enabled: hotkeyEnabled(entry, s, issue) });
    };
    // Capture on window runs before every document listener, the hotkey manager's included.
    window.addEventListener("keydown", sync, true);
    return () => {
      window.removeEventListener("keydown", sync, true);
      document.removeEventListener("keydown", handle);
      for (const { handle } of bound) handle.unregister();
    };
  }, []);
}
export function ShortcutHelp() {
  const [query, setQuery] = useState("");
  const catalog = [
    ...shortcuts
      .filter(
        (s) =>
          !!s.hotkey && (!/^team-\d+$/.test(s.id) || Number(s.id.slice(5)) <= get().boards.length),
      )
      .map((s) => ({ ...s, hotkey: s.hotkey! })),
    ...editorBindings.map((b) => ({
      ...b,
      id: `editor-${b.id}`,
      group: "Editor",
    })),
    ...codeBlockBindings.map((b) => ({ ...b, id: `editor-${b.id}`, group: "Code block" })),
  ];
  const matches = catalog.filter((s) => shortcutMatches(s, query));
  return (
    <Dialog label="Keyboard Shortcuts" placement="side" close={() => ui.send({ type: "overlay.close" })}>
      {/* HelpCenter's own header (`On`), not the Modal header: regularPlus labelTitle, a spacer, the small Close inline. */}
      <header className="shortcuts-header">
        <Text as="h1" variant="regularPlus">
          Keyboard Shortcuts
        </Text>
        <Dialog.Close label="Close dialog" shortcut="Escape" size="small" />
      </header>
      <div className="shortcuts-search">
        <TextInput
          autoFocus
          size="large"
          aria-label="Search shortcuts"
          placeholder="Search shortcuts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Linear's Escape clears a search first; the next one closes the panel.
          onKeyDown={(e) => {
            if (e.key !== "Escape" || !query) return;
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }}
          className="w-full"
        />
      </div>
      <div className="shortcuts-content">
        {matches.length ? (
          shortcutSections(matches).map(({ group, rows }) => (
            <section key={group} className="shortcuts-section">
              <Text as="h2" variant="smallPlus">
                {group}
              </Text>
              <dl>
                {rows.map((s) => (
                  <div key={s.id} className="shortcuts-row">
                    <dt>
                      <Text variant="smallPlus" color="muted">{s.name}</Text>
                    </dt>
                    <dd>
                      <KeyboardShortcut keys={s.hotkey} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))
        ) : (
          <Text variant="small" color="faint">No matching shortcuts found</Text>
        )}
      </div>
    </Dialog>
  );
}
