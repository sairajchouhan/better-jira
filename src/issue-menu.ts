import {
  actions,
  get,
  beginCreate,
  toggleFavorite,
  isLocalIssue,
  hasLocalJiraChanges,
  ui,

  type Issue,
  type IssueDraft,
} from "./store";
import { canHaveChildren, needsParent } from "./issue-properties";
import { createIssueDocument } from "./issue-resources";
import { shortcuts, canRunShortcut, runShortcut } from "./shortcuts";
import { copyIssue, copyKinds, copyIcons, copyShortcuts } from "./issue-copy";
import { reminderEntries } from "./reminders";
import { duePresets } from "./due-date";
import { post } from "./commands";
import { RELATION_ISSUE } from "./issue-activity";
import type { ActionEntry } from "./action-menu";
import type { IconName } from "./icons";
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
  const favorite = get().favorites.includes(issue.key),
    keys = (id: string) => shortcuts.find((entry) => entry.id === id)?.hotkey;
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
  // A right-click on a card or list row (Linear's row menu) leads with the property pickers its shortcuts open, acting on the selected issue.
  const picker = (name: string, icon: IconName, id: string): ActionEntry => ({
    name,
    icon,
    shortcut: keys(id),
    run: () => openDialog(id === "assign" ? "assignee" : (id as IssueMenuDialog)),
  });
  const due: ActionEntry = {
    name: "Due date",
    icon: "calendar",
    shortcut: keys("due"),
    children: [
      {
        name: "Custom…",
        run: () => {
          post("issue-options-start", "due");
          open("due");
        },
      },
      ...duePresets().map((preset) => ({
        name: preset.name,
        hint: preset.label,
        run: () => {
          actions.patch(issue.key, { due: preset.due });
          close();
        },
      })),
    ],
  };
  const properties: ActionEntry[] = [
    {
      name: "Issue type",
      icon: "board",
      shortcut: keys("type"),
      run: () => openDialog("type"),
    },
    {
      name: "Add link…",
      icon: "link",
      shortcut: keys("link"),
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
            shortcut: keys("rename"),
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
                shortcut: keys("sub-issue"),
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
          shortcut: keys("parent-set"),
          run: () => mark("parent"),
        },
        {
          name: "Related to…",
          shortcut: keys("related"),
          run: () => mark("related"),
        },
        {
          name: "Blocked by…",
          shortcut: keys("blocked"),
          run: () => mark("blocked"),
        },
        {
          name: "Blocking…",
          shortcut: keys("blocking"),
          run: () => mark("blocking"),
        },
        {
          name: "Duplicate of…",
          shortcut: keys("duplicate"),
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
                const role = RELATION_ISSUE[r.kind] ?? "related";
                return {
                  name: `${role[0]!.toUpperCase()}${role.slice(1)} issue ${r.key} ${get().issues.get(r.key)?.summary ?? ""}`.trim(),
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
        shortcut: keys(copyShortcuts[kind] ?? ""),
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
      shortcut: keys("favorite"),
      run: () => {
        toggleFavorite(issue.key);
        close();
      },
    },
    {
      name: "Remind me",
      icon: "clock",
      shortcut: keys("remind"),
      children: reminderEntries((at) => {
        actions.remind(issue.key, at);
        close();
      }, () => {
        post("issue-options-start", "reminder");
        open("reminder");
      }),
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
    shortcut: keys("delete"),
    divider: presentation === "sub-issue",

    run: () => actions.remove(issue.key),
  };
  const moves = (
    [
      ["column-left", "Left column"],
      ["column-right", "Right column"],
      ["reorder-top", "To top of group"],
      ["reorder-up", "One position up"],
      ["reorder-down", "One position down"],
      ["reorder-bottom", "To bottom of group"],
    ] as const
  )
    .filter(([id]) => canRunShortcut(id))
    .map(([id, name]) => ({
      name,
      shortcut: keys(id),
      run: () => runShortcut(id, issue.key),
    }));
  const entries: ActionEntry[] =
    presentation !== "detail"
      ? [
          picker("Status", "status", "status"),
          picker("Priority", "priority", "priority"),
          picker("Assignee", "user", "assign"),
          due,
          picker("Labels", "label", "labels"),
          ...(presentation === "sub-issue" && !get().writable
            ? [picker("Project", "layers", "project")]
            : []),
          {
            name: "More properties",
            icon: "square-dots",
            children: properties,
          },
          ...actionsAfter,
          ...(presentation === "row" && moves.length
            ? [
                {
                  name: "Move",
                  icon: "chevron" as const,
                  divider: true,
                  children: moves,
                },
              ]
            : []),
          remove,
        ]
      : [due, ...properties, ...actionsAfter, remove];
  return entries;
}
