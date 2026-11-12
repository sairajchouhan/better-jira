import { latestNotification, showNotification } from "./app-notifications";
import { toasts } from "./toast-queue";
import { recentIssues } from "./recents";
import { isMyIssues } from "./navigation";
import { useEffect, useState } from "react";
import { VIEW_SHORTCUT_IDS, viewShortcutId } from "./view-shortcut";
import { createToolbarView } from "./view-toolbar-actions";
import { activeView, saveOverlayToView } from "./saved-views";
import { canMergeOverlay } from "./saved-view-model";
import { filterCount, visibleOrder } from "./view-model";
import { forgetIssueIntents, post, run as command } from "./commands";
import { canHaveChildren } from "./issue-properties";
import { formatForDisplay, getHotkeyManager, type Hotkey } from "@tanstack/react-hotkeys";
import {
  actions,
  beginCreate,
  boardOf,
  currentKey,
  get,
  isLocalIssue,
  isWatching,
  ME,
  navigate,
  redoEdit,
  set,
  toggleFavorite,
  ui,
  undoEdit,
  useStore,
  type Issue,
  type Overlay,
} from "./store";
import {
  buckets,
  columnInScope,
  rankBetween,
} from "./view-model";
import {
  clearFilters,
  setDisplay,
  setScope,
  toggleCollapsed,
  updateRule,
  viewSettings,
} from "./view-settings";
import { copyIssue, type CopyKind } from "./issue-copy";
import { editorBindings } from "./editor-bindings";
import { Dialog } from "./dialog";
import { Field, TextInput } from "./field";
import { Shortcut as KeyboardShortcut, type Keys } from "./keycap";
import { Text } from "./text";
import { EmptyState } from "./empty-state";
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
} from "./inbox";

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
};
/** The issue a menu item runs a shortcut on (`runShortcut(id, key)`); a right-click menu's issue never becomes the selection. */
let acting: string | null = null;
const selected = (s = get()) => {
  const key = acting ?? (s.overlay && s.target) ?? (!s.document && s.selected);
  return key ? s.issues.get(key) : undefined;
};
/** Linear: an issue shortcut acts on the sub-issue row under the pointer or keyboard focus, as its row menu's hints promise. */
const hoveredRow = () => {
  const key = command("hovered-sub-issue");
  return key ? get().issues.get(key) : undefined;
};
const lastViewed = (s: State) =>
  recentIssues().map((key) => s.issues.get(currentKey(key))).find((i) => i && i.key !== s.selected);
const viewOf = (s: State) => s.savedViews.find((v) => v.id === s.activeViewId);
/** A menu's own issue (`runShortcut(id, key)`) wins over the row under the pointer, as in `overlay()`. */
const target = () => {
  const issue = selected();
  return issue && !acting ? (hoveredRow() ?? issue) : issue;
};
const issueAction = (fn: (issue: Issue) => void) => () => {
  const issue = target();
  if (issue) fn(issue);
};
const overlay = (value: NonNullable<Overlay>) => () => {
  ui.send({
    type: "overlay.open",
    overlay: value,
    target: selected() ? (acting ?? hoveredRow()?.key ?? null) : null,
  });
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
    const index = flat.findIndex((i) => i.key === s.selected);
    const next = flat[index < 0 ? 0 : index + direction];
    if (next) navigate({ selected: next.key });
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
  if (next) navigate({ selected: next.key });
}
function moveColumn(direction: number) {
  const issue = selected();
  if (!issue) return;
  const board = boardOf(issue.key)!,
    prefs = viewSettings(issue.board);
  const choices = board.columns.filter((c) => columnInScope(c, prefs.scope));
  if (prefs.display.groupDescending) choices.reverse();
  const at = choices.findIndex((c) => c.statuses.some((s) => s.id === issue.status));
  const target = choices[at + direction]?.statuses[0];
  if (at >= 0 && target) actions.status(issue.key, target.id);
}
function reorder(direction: number, edge = false) {
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
  const descending = viewSettings(issue.board).display.descending;
  const a = rest[at - 1]?.rank,
    b = rest[at]?.rank;
  actions.drop(issue.key, issue.board, [], descending ? rankBetween(b, a) : rankBetween(a, b));
}
const manual = (s = get()) => viewSettings(s.board, s).display.ordering === "manual";
function scope(value: "active" | "backlog" | "all", mine = false) {
  navigate({ mine, ...(!mine && isMyIssues(get()) ? { board: get().board } : {}), panel: false, selected: null });
  setScope(get().board, value);
}
function copy(kind: CopyKind) {
  const issue = target();
  if (issue) void copyIssue(kind, issue);
}
function relation(kind: string) {
  ui.send({ type: "overlay.open", overlay: "relations", kind, target: hoveredRow()?.key ?? null });
}
function collapse(all = false) {
  const s = get(),
    board = s.boards.find((b) => b.id === s.board);
  if (!board) return;
  const by = viewSettings(s.board, s).display.columns,
    groups = buckets(
      [...s.issues.values()].filter((i) => i.board === s.board),
      by,
      board,
      [...s.issues.values()],
    );
  const ids = all
    ? groups.map((g) => g.id)
    : groups.filter((g) => g.issues.some((i) => i.key === s.selected)).map((g) => g.id);
  toggleCollapsed(s.board, ids);
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
    run: () =>
      matchMedia("(max-width: 767.98px)").matches
        ? set({ sidebarOpen: !get().sidebarOpen })
        : ui.send({ type: "sidebar.toggle" }),
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
      ["inbox-snooze", "Snooze notification…", "H", () => hasSelectedRow() && openSnooze()],
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
    run: () => priorityInbox() && showTab(tab),
    when: (s) => s.inbox,
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
    name: "Open a team / board",
    group: "Navigation",
    hotkey: ["O", "T"],
    run: overlay("boards"),
  },
  { id: "board-add", name: "Add board", group: "Navigation", run: overlay("add-board") },
  {
    id: "customize-sidebar",
    name: "Customize sidebar",
    group: "Navigation",
    run: overlay("customize-sidebar"),
  },
  ...Array.from({ length: 9 }, (_, i): Shortcut => ({
    id: `team-${i + 1}`,
    name: `Go to team / board ${i + 1}`,
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
      if (issue) navigate({ board: issue.board, selected: issue.key, panel: true });
    },
  },
  {
    id: "toast-open",
    name: "Open link from last toast",
    group: "Navigation",
    hotkey: "Mod+Alt+O",
    when: () => !!latestNotification()?.key,
    run: () => {
      // Like the toast's View issue: a key Jira has since replaced still finds the issue.
      const issue = get().issues.get(currentKey(latestNotification()?.key ?? ""));
      if (issue) navigate({ board: issue.board, selected: issue.key, panel: true });
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
    run: () => beginCreate(),
  },
  {
    id: "new-full",
    name: "New issue in full screen view",
    group: "Issues",
    hotkey: "V",
    run: () => {
      // Only a composer that opened takes the full-screen intent; a refused create (storage down) leaves none behind.
      if (beginCreate()) post("create-expanded", undefined);
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
      ["project", "Add to project", "Shift+P", "project"],
      ["milestone", "Add to project milestone", "Shift+M", "milestone"],
    ] as const
  ).map(([id, name, hotkey, value]) => ({
    id,
    name,
    hotkey,
    group: "Issues",
    issue: true,
    // Jira can't move an issue to another project: only an issue made here, not yet in Jira, picks one (R2-issue-fields-D8).
    ...(id === "project"
      ? { when: (s: State, issue?: Issue) => !s.writable || isLocalIssue(issue?.key ?? "") }
      : {}),
    run: overlay(value),
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
      overlay("options")();
    },
  },
  {
    id: "sub-issue",
    name: "Create sub-issue",
    group: "Issues",
    hotkey: "Mod+Shift+O",
    issue: true,
    run: issueAction((i) => {
      if (!canHaveChildren(get(), i)) {
        set({ perf: `Jira has no issue type below ${i.type}, so ${i.key} can't have sub-issues` });
        return;
      }
      if (!command("create-sub-issue", i.key)) beginCreate({ parent: i.key, project: i.project });
    }),
  },
  {
    id: "parent-set",
    name: "Set parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+P",
    issue: true,
    run: () => relation("parent"),
  },
  {
    id: "parent-open",
    name: "Open parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowUp",
    issue: true,
    when: (s) => !!s.issues.get(selected(s)?.parent ?? ""),
    run: issueAction((i) => {
      const parent = get().issues.get(i.parent ?? "");
      if (parent) navigate({ board: parent.board, selected: parent.key, panel: true });
    }),
  },
  {
    id: "sub-issues-of-parent",
    name: "Open sub-issues of parent",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowRight",
    issue: true,
    when: (s) => !!s.issues.get(selected(s)?.parent ?? ""),
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
      return !!key && [...s.issues.values()].some((c) => c.parent === key);
    },
    run: issueAction((i) => {
      const child = [...get().issues.values()].find((c) => c.parent === i.key);
      if (child) navigate({ board: child.board, selected: child.key, panel: true });
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
    id: "peek",
    name: "Peek into item",
    group: "List / Board",
    hotkey: "Space",
    issue: true,
    run: () => navigate({ panel: true, view: "side" }),
  },
  {
    id: "open",
    name: "Open focused item",
    group: "List / Board",
    hotkey: "Enter",
    issue: true,
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
      void navigator.clipboard
        .writeText(location.href)
        .then(() => set({ perf: "Copied page URL" }))
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
    when: manual,
    run: () => reorder(dir, edge),
  })),
  {
    id: "column-left",
    name: "Move to left column",
    group: "List / Board",
    hotkey: "Alt+ArrowLeft",
    issue: true,
    when: (s) => viewSettings(s.board, s).display.columns === "status",
    run: () => moveColumn(-1),
  },
  {
    id: "column-right",
    name: "Move to right column",
    group: "List / Board",
    hotkey: "Alt+ArrowRight",
    issue: true,
    when: (s) => viewSettings(s.board, s).display.columns === "status",
    run: () => moveColumn(1),
  },
  {
    id: "collapse",
    name: "Collapse/expand group",
    group: "List / Board",
    hotkey: "T",
    issue: true,
    when: (s) => viewSettings(s.board, s).display.layout === "list",
    run: () => collapse(),
  },
  {
    id: "collapse-all",
    name: "Collapse/expand all groups",
    group: "List / Board",
    hotkey: "Alt+T",
    when: (s) => viewSettings(s.board, s).display.layout === "list",
    run: () => collapse(true),
  },
  {
    id: "find",
    name: "Find in view",
    group: "Filters",
    hotkey: "Mod+F",
    when: boardVisible,
    run: () => {
      set({ findInView: true });
      post("focus-find", undefined);
    },
  },
  {
    id: "filter",
    name: "Add filter",
    group: "Filters",
    hotkey: "F",
    when: boardVisible,
    run: () =>
      get().inbox
        ? ui.send({ type: "overlay.open", overlay: "inbox-filter" })
        : ui.send({ type: "toolbar.open", toolbar: "filter" }),
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
 *  ⌘C keeps the browser's copy whenever page text is selected. */
function hotkeyEnabled(entry: Shortcut, s: State, issue: Issue | undefined) {
  return (
    s.boards.length > 0 &&
    ((!s.overlay && !s.toolbar) ||
      (entry.id === "commands" && s.overlay === "palette") ||
      (entry.id === "shortcuts" && s.overlay === "shortcuts")) &&
    (entry.hotkey !== "Mod+C" || !!getSelection()?.isCollapsed) &&
    shortcutApplies(entry, s, issue)
  );
}
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
        get().toolbar
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
    const bound = shortcuts
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
              entry.id === "sub-issue"
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
  ];
  const words = query
    .toLowerCase()
    .split(/[+\s]+/)
    .filter(Boolean);
  const matches = catalog.filter((s) => {
    const names = formatForDisplay(s.hotkey, { useSymbols: false, sequenceSeparator: " then " });
    const raw = Array.isArray(s.hotkey) ? s.hotkey.join(" ") : s.hotkey;
    const glyphs = formatForDisplay(s.hotkey, { sequenceSeparator: " then " });
    const text = `${s.name} ${s.group} ${names} ${raw} ${glyphs}`.toLowerCase();
    const tokens = text.split(/[^\p{L}\p{N}]+/u);
    // A single letter is a key name, so it must be a whole word: "shift d" is not every name with a d in it.
    return words.every((word) =>
      word.length === 1 && /[\p{L}\p{N}]/u.test(word) ? tokens.includes(word) : text.includes(word),
    );
  });
  return (
    <Dialog
      label="Keyboard Shortcuts"
      width={720}
      close={() => ui.send({ type: "overlay.close" })}
    >
      <Dialog.Header className="mb-3">
        <Dialog.Title>Keyboard Shortcuts</Dialog.Title>
        <Dialog.Close label="Close dialog" />
      </Dialog.Header>
      <Text as="p" variant="mini" color="muted" className="mb-3">
        Issue actions need a selected issue. Editor shortcuts apply while typing. Reordering
        requires Manual ordering.
      </Text>
      <Field className="mb-4">
        <Field.Label className="sr-only">Search shortcuts</Field.Label>
        <TextInput
          autoFocus
          placeholder="Search shortcuts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full"
        />
      </Field>
      <Dialog.Body className="max-h-[60vh] overflow-y-auto">
        {[...new Set(matches.map((s) => s.group))].map((group) => (
          <section key={group} className="mb-5">
            <Text as="h3" variant="mini" color="muted" className="mb-2">
              {group}
            </Text>
            <dl>
              {matches
                .filter((s) => s.group === group)
                .map((s) => (
                  <div key={s.id} className="flex items-center gap-3 py-1.5">
                    <dt className="flex-1">
                      <Text variant="mini" color="inherit">{s.name}</Text>
                    </dt>
                    <dd>
                      <KeyboardShortcut keys={s.hotkey} />
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
        {!matches.length && <EmptyState title="No shortcuts found" />}
      </Dialog.Body>
    </Dialog>
  );
}
