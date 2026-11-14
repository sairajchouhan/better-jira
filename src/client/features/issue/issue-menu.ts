import { type Issue, type IssueDraft } from "@/shared/issue-model";
import { createElement } from "react";
import { get, boardOf, ME } from "@/client/state/store";
import { actions, beginCreate } from "@/client/state/issue-actions";
import { isLocalIssue, hasLocalJiraChanges } from "@/client/state/local-edits";
import { ui } from "@/client/features/navigation/app-navigation";
import { toggleFavorite } from "@/client/features/navigation/favorites";
import { canHaveChildren, needsParent } from "@/shared/issue-properties";
import { createIssueDocument } from "./issue-resources";
import { withMoveEntry } from "./sub-issue-model";
import { MOVES, moveAvailability, runShortcut, hotkeyOf } from "@/client/features/navigation/shortcuts";
import { copyIssue, copyKinds, copyIcons, copyShortcuts } from "./issue-copy";
import { reminderSubmenu } from "@/client/features/reminders/reminders";
import { post } from "@/client/features/navigation/commands";
import { RELATION_ISSUE, jiraLinkType, relationName } from "@/shared/relations";
import { DueRows, IssueLabelRows } from "./property-menu";
import type { ActionEntry } from "@/client/components/action-menu";
import { Icon, PriorityIcon, StatusIcon, type IconName } from "@/client/components/icons";
import { Avatar } from "@/client/components/avatar";
import {
  assignableUsers,
  clearPriorityRow,
  knownLabels,
  priorityChoices,
  statuses,
} from "@/shared/board-catalog";
export type IssueMenuDialog =
  | "status"
  | "priority"
  | "assignee"
  | "labels"
  | "project"
  | "type"
  | "milestone"
  | "due"
  | "reminder"
  | "link"
  | "pull-request"
  | "history"
  | "rename";
/** A menu's "create sub-issue" acts on the menu's issue, never the selection: closing the menu clears its target. */
export const createSubIssue = (issue: Issue) =>
  requestAnimationFrame(() => runShortcut("sub-issue", issue.key));
export function issueMenuEntries(
  issue: Issue,
  {
    openDialog,
    close,
    presentation = "detail",
  }: {
    openDialog: (kind: IssueMenuDialog) => void;
    close: () => void;
    presentation?: "detail" | "row" | "sub-issue";
  },
): ActionEntry[] {
  const parent = issue.parent ? get().issues.get(issue.parent) : undefined;
  const favorite = get().favorites.includes(issue.key);
  const open = (overlay: "due" | "reminder") => openDialog(overlay);
  const related = (kind: NonNullable<IssueDraft["related"]>["kind"]) => {
    close();
    beginCreate({ related: { key: issue.key, kind }, project: issue.project });
  };
  const mark = (kind: string) => {
    close();
    ui.send({ type: "overlay.open", overlay: "relations", target: issue.key, kind });
  };
  const reopen = (view: "link" | "pull-request" | "history") => {
    openDialog(view);
  };
  // A right-click on a card or list row (Linear's contextual menu) lists each property's choices in a submenu (BJ-26);
  // the shortcut still opens the full picker.
  const board = boardOf(issue.key),
    boardIssues = [...get().issues.values()].filter((i) => i.board === issue.board);
  const choose = (write: () => void) => () => {
    write();
    close();
  };
  // Each submenu matches its picker (S, P, A, L, Shift+D): Linear's placeholder, number keys, and the same rows.
  const property = (name: string, icon: IconName, id: string, entry: Omit<ActionEntry, "name" | "icon">): ActionEntry => ({
    name,
    icon,
    shortcut: hotkeyOf(id),
    ...entry,
  });
  const numbered = (from: number) => (entry: ActionEntry, i: number) => ({
    ...entry,
    number: i + from <= 9 ? i + from : undefined,
  });
  const inline = {
    status: property("Status", "status", "status", {
      placeholder: "Change status…",
      children: statuses(board)
        .map((s) => ({
          name: s.name,
          image: createElement(StatusIcon, { status: s }),
          selected: s.id === issue.status,
          run: choose(() => actions.status(issue.key, s.id)),
        }))
        .map(numbered(1)),
    }),
    priority: property("Priority", "priority", "priority", {
      placeholder: issue.priority ? "Change priority to…" : "Set priority to…",
      nameAsParent: issue.priority ? "Change priority to" : "Set priority to",
      children: [
        ...(clearPriorityRow(get().writable) ? [""] : []),
        ...priorityChoices(get().options, boardIssues, get().writable),
      ].map((p, i, rows) => ({
        name: p || "No priority",
        image: createElement(PriorityIcon, { name: p || undefined }),
        selected: p === (issue.priority ?? ""),
        // Linear numbers No priority 0, so the named rows keep 1… when Jira can't clear the priority.
        number: rows[0] ? i + 1 : i,
        run: choose(() => actions.patch(issue.key, { priority: p || undefined })),
      })),
    }),
    assignee: property("Assignee", "user", "assign", {
      placeholder: "Assign to…",
      hoistFrom: 3,
      children: [
        { name: "No assignee", user: null },
        ...assignableUsers(ME, get().options.users, get().issues.values()).map((u) => ({ name: u.name, user: u })),
      ]
        .map(({ name, user }) => ({
          name,
          image: createElement(Avatar, { user, size: 16 }),
          selected: (issue.assignee?.id ?? null) === (user?.id ?? null),
          run: choose(() => actions.assign(issue.key, user)),
        }))
        .map(numbered(0)),
    }),
    // The submenu is the L picker's checkbox rows on the issue's live labels; these children are the root search's "Add label › x".
    labels: property("Labels", "label", "labels", {
      placeholder: issue.labels.length ? "Change or add labels…" : "Add labels…",
      hoistFrom: 3,
      nameAsParent: (label) => (label.selected ? "Change label" : "Add label"),
      rows: (query) => createElement(IssueLabelRows, { issue: issue.key, query }),
      children: knownLabels(boardIssues, get().options.labels).map((label) => {
        const on = issue.labels.includes(label);
        return {
          name: label,
          image: createElement(Icon, { name: "label", size: 16 }),
          selected: on,
          run: choose(() =>
            actions.patch(issue.key, {
              labels: on ? issue.labels.filter((l) => l !== label) : [...issue.labels, label],
            }),
          ),
        };
      }),
    }),
  };
  const picker = (name: string, icon: IconName, id: string): ActionEntry => ({
    name,
    icon,
    shortcut: hotkeyOf(id),
    run: () => openDialog(id as IssueMenuDialog),
  });
  const due = property("Due date", "calendar", "due", {
    placeholder: "Try: 24h, 7 days, Feb 9",
    hoistFrom: Infinity,
    rows: (query) =>
      createElement(DueRows, {
        query,
        value: issue.due ?? null,
        onPick: (at) => {
          actions.patch(issue.key, { due: at });
          close();
        },
        onCustom: () => {
          post("issue-options-start", "due");
          open("due");
        },
      }),
  });
  const properties: ActionEntry[] = [
    {
      name: "Issue type",
      icon: "board",
      shortcut: hotkeyOf("type"),
      run: () => openDialog("type"),
    },
    {
      name: "Add link…",
      icon: "link",
      shortcut: hotkeyOf("link"),
      run: () => reopen("link"),
    },
    {
      name: "Add pull request…",
      icon: "branch",
      run: () => reopen("pull-request"),
    },
    {
      name: "Add document…",
      icon: "file",
      run: () => createIssueDocument(issue),
    },
    ...(presentation === "sub-issue"
      ? [
          {
            name: "Rename…",
            icon: "pencil" as const,
            shortcut: hotkeyOf("rename"),
            run: () => openDialog("rename"),
          },
        ]
      : []),
  ];
  const actionsAfter: ActionEntry[] = [
    {
      name: "Create related",
      icon: "square-plus",
      divider: true,
      children: [
        { name: "Issue…", run: () => related("related") },
        ...(canHaveChildren(get(), issue)
          ? [
              {
                name: "Sub-issue…",
                shortcut: hotkeyOf("sub-issue"),
                run: () => {
                  close();
                  createSubIssue(issue);
                },
              },
            ]
          : []),
        { name: "Parent issue…", run: () => related("parent") },
        { name: "Blocked issue…", run: () => related("blocked") },
        { name: "Blocking issue…", run: () => related("blocking") },
      ],
    },
    {
      name: "Mark as",
      icon: "flag",
      children: [
        { name: "Parent of…", run: () => mark("child") },
        {
          name: "Sub-issue of…",
          shortcut: hotkeyOf("parent-set"),
          run: () => mark("parent"),
        },
        {
          name: "Related to…",
          shortcut: hotkeyOf("related"),
          run: () => mark("related"),
        },
        {
          name: "Blocked by…",
          shortcut: hotkeyOf("blocked"),
          run: () => mark("blocked"),
        },
        {
          name: "Blocking…",
          shortcut: hotkeyOf("blocking"),
          run: () => mark("blocking"),
        },
        {
          name: "Duplicate of…",
          shortcut: hotkeyOf("duplicate"),
          run: () => mark("duplicate"),
        },
      ],
    },
    // Linear (RAJ-52): Remove lists the parent and every relation, named by the other issue's role ("Blocking issue RAJ-54 …").
    ...((parent && !needsParent(get(), issue)) || issue.relations?.length
      ? [
          {
            name: "Remove",
            icon: "flag-x" as const,
            children: [
              ...(parent && !needsParent(get(), issue)
                ? [
                    {
                      name: `Parent issue ${parent.key} ${parent.summary}`,
                      run: () => {
                        actions.patch(issue.key, { parent: undefined });
                        close();
                      },
                    },
                  ]
                : []),
              ...(issue.relations ?? []).map((r) => {
                const role = RELATION_ISSUE[r.kind] ?? "related",
                  summary = get().issues.get(r.key)?.summary ?? r.issue?.summary ?? "";
                // A Jira link kind is named by this issue's phrase: "Is caused by VB-2 …".
                const name = jiraLinkType(r.kind)
                  ? relationName(r)
                  : `${role[0]!.toUpperCase()}${role.slice(1)} issue`;
                return {
                  name: `${name} ${r.key} ${summary}`.trim(),
                  run: () => {
                    actions.relate(issue.key, r.key, r.kind, true);
                    close();
                  },
                };
              }),
            ],
          },
        ]
      : []),
    {
      name: "Copy",
      icon: "clipboard",
      divider: true,
      children: copyKinds.map((kind) => ({
        name: `Copy ${kind}`,
        icon: copyIcons[kind],
        shortcut: hotkeyOf(copyShortcuts[kind] ?? ""),
        // ActionMenu already closed; closing again after the await would close whatever menu opened meanwhile.
        run: () => void copyIssue(kind, issue),
      })),
    },
    {
      name: "Make a copy…",
      icon: "copy",
      run: () => actions.duplicate(issue.key),
    },
    {
      name: favorite ? "Remove from favorites" : "Favorite",
      icon: favorite ? "starred" : "star",
      divider: true,
      shortcut: hotkeyOf("favorite"),
      run: () => {
        toggleFavorite(issue.key);
        close();
      },
    },
    {
      name: "Remind me",
      icon: "clock",
      shortcut: hotkeyOf("remind"),
      ...reminderSubmenu(
        (at) => {
          actions.remind(issue.key, at);
          close();
        },
        () => {
          post("issue-options-start", "reminder");
          open("reminder");
        },
      ),
    },
    ...(presentation === "sub-issue"
      ? []
      : [
          {
            name: "Show description history",
            icon: "undo" as const,
            divider: true,
            run: () => reopen("history"),
          },
        ]),
    ...(!isLocalIssue(issue.key) && hasLocalJiraChanges(issue.key)
      ? [
          {
            name: "Restore mirrored Jira version",
            icon: "redo" as const,
            run: () => void actions.restoreJira(issue.key),
          },
        ]
      : []),
  ];
  const remove: ActionEntry = {
    name: "Delete",
    icon: "trash",
    shortcut: hotkeyOf("delete"),
    divider: presentation === "sub-issue",

    run: () => actions.remove(issue.key),
  };
  // Linear's Move… (`Lvr`, includeDisabledSubActions): its six moves in order, those the issue can't make left out, and
  // up/down/top/bottom listed but disabled with its reason while the group isn't ordered manually.
  const moves = MOVES.flatMap(([id, name]): ActionEntry[] => {
    const move = moveAvailability(id, issue);
    return move ? [{ name, shortcut: hotkeyOf(id), disabledReason: move.disabledReason, run: () => runShortcut(id, issue.key) }] : [];
  });
  const entries: ActionEntry[] =
    presentation !== "detail"
      ? [
          inline.status,
          inline.priority,
          inline.assignee,
          due,
          inline.labels,
          ...(presentation === "sub-issue" && !get().writable
            ? [picker("Project", "layers", "project")]
            : []),
          {
            name: "More properties",
            icon: "square-dots",
            children: properties,
          },
          ...actionsAfter,
          remove,
        ]
      : [due, ...properties, ...actionsAfter, remove];
  return presentation === "row" && moves.length ? withMoveEntry(entries, moveMenu(moves)) : entries;
}
/** Linear's Move… (`Lvr`): found by its sub-actions, not its own name; where it sits is `withMoveEntry`'s. */
export const moveMenu = (children: ActionEntry[]): ActionEntry => ({
  name: "Move…",
  icon: "move",
  search: "hidden",
  children,
});
