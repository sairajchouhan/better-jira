import { type Issue, type IssueDraft } from "@/shared/issue-model";
import { createElement } from "react";
import { get, boardOf, ME } from "@/client/state/store";
import { actions, beginCreate } from "@/client/state/issue-actions";
import { isLocalIssue, hasLocalJiraChanges } from "@/client/state/local-edits";
import { ui } from "@/client/features/navigation/app-navigation";
import { toggleFavorite } from "@/client/features/navigation/favorites";
import { canHaveSubIssues, needsParent } from "@/shared/issue-properties";
import { epicChoices, epicLocked, epicOf, epicPatch, nestable, parentOf } from "@/shared/epics";
import { createIssueDocument } from "./issue-resources";
import { withMoveEntry } from "./sub-issue-model";
import { MOVES, moveAvailability, runShortcut, hotkeyOf } from "@/client/features/navigation/shortcuts";
import { copyIssue, copyKinds, copyIcons, copyShortcuts } from "./issue-copy";
import { reminderSubmenu } from "@/client/features/reminders/reminders";
import { post } from "@/client/features/navigation/commands";
import { RELATION_ISSUE, jiraLinkType, relationName } from "@/shared/relations";
import { DueRows, IssueAssigneeRows, IssueLabelRows } from "./property-menu";
import type { ActionEntry } from "@/client/components/action-menu";
import { Icon, PriorityIcon, StatusIcon, type IconName } from "@/client/components/icons";
import { Avatar } from "@/client/components/avatar";
import { personKeywords, rowKeywords } from "@/client/lib/fuzzy-score";
import {
  assigneeGroups,
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
/** Every assignee choice in the picker's order, people outside the team included: the root search hoists them only from three
 *  characters, past the two that list them in the picker. */
function assigneeChoices(issue: Issue) {
  const g = assigneeGroups({
    me: ME,
    current: issue.assignee,
    jiraUsers: get().options.users,
    issues: get().issues.values(),
    board: issue.board,
  });
  const team = new Set(g.team.map((u) => u.id));
  return [...g.assigned, ...g.suggested, ...g.team, ...g.others].map((user) => ({ user, team: !!user && team.has(user.id) }));
}
/** A menu's "create sub-issue" acts on the menu's issue, never the selection: closing the menu clears its target. */
export const createSubIssue = (issue: Issue) =>
  requestAnimationFrame(() => runShortcut("sub-issue", issue.key));
/** Each submenu matches its picker (S, P, A, L, Shift+D): Linear's placeholder, number keys, and the same rows. */
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
/**
 * The issue's Status, Priority, Assignee and Labels actions with their values as children (Linear's RCn, Odn, Xun and eK), each
 * value writing through `actions` (undoable) and then closing. `menu` names them as Linear does there: "contextual" for a
 * right-click menu ("Status", "Assignee"), "command" for ⌘K ("Change status…", "Assign to…"), where the name, without its "…",
 * is the breadcrumb of a value hoisted into the root search ("Change status › In Progress").
 */
export function issuePropertyEntries(issue: Issue, { close, menu }: { close: () => void; menu: "contextual" | "command" }) {
  const command = menu === "command";
  const board = boardOf(issue.key),
    boardIssues = [...get().issues.values()].filter((i) => i.board === issue.board);
  const lookup = (key: string) => get().issues.get(key);
  const epic = epicOf(issue, lookup),
    projectLocked = epicLocked(issue, lookup);
  const choose = (write: () => void) => () => {
    write();
    close();
  };
  return {
    status: property(command ? "Change status…" : "Status", "status", "status", {
      placeholder: "Change status…",
      children: statuses(board)
        .map((s, i) => ({
          name: s.name,
          // The S picker's rows: their place in the workflow orders the names a query starts (PCn.createScoreOverride).
          keywords: rowKeywords({ order: i }),
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
    // The submenu is the A picker's rows (AssigneeRows) on the issue's live assignee; these children, from the same groups,
    // are the root search's "Assignee › x".
    assignee: property(command ? "Assign to…" : "Assignee", "user", "assign", {
      placeholder: "Assign to…",
      hoistFrom: 3,
      rows: (query) => createElement(IssueAssigneeRows, { issue: issue.key, query }),
      children: assigneeChoices(issue).map(({ user, team }) => ({
        name: user?.name ?? "No assignee",
        image: createElement(Avatar, { user, size: 16 }),
        selected: (issue.assignee?.id ?? null) === (user?.id ?? null),
        keywords: user ? personKeywords(user.name, { me: user.id === ME.id, team }) : ["unassigned"],
        // Linear's keywordsExactMatch on your own row: "me" finds you.
        exact: user?.id === ME.id ? ["me"] : undefined,
        run: choose(() => actions.assign(issue.key, user)),
      })),
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
    // Linear's contextual "Project" (`zBn`, `isContextualMenu`): the ⇧P picker's rows, the project being the issue's epic.
    project: property("Epic", "layers", "project", {
      placeholder: epic ? "Move to epic…" : "Add to epic…",
      nameAsParent: epic ? "Move to epic" : "Add to epic",
      // The word Linear (and Jira people) search by still finds it.
      keywords: ["project"],
      hoistFrom: 3,
      disabledReason: projectLocked,
      children: projectLocked
        ? undefined
        : [
            { key: null, name: "No epic" },
            ...epicChoices(boardIssues, board, { project: issue.project?.key, current: epic }),
          ].map(({ key, name }, i) => ({
            name,
            // The ⇧P picker's: "No epic" by `VBn`'s keywords, an epic by its key too.
            keywords: rowKeywords({ keywords: key ?? "project delete" }),
            icon: "layers" as const,
            selected: key === (epic ?? null),
            // Linear's "No project" ("No epic" here) takes 0 (`YBn` numkeyShortcut); the projects have none.
            number: i === 0 ? 0 : undefined,
            run: choose(() => actions.patch(issue.key, epicPatch(key))),
          })),
    }),
  };
}
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
  // The parent issue only: an epic parent is the issue's project, removed from Project, never from Remove › Parent (parentOf).
  const lookup = (key: string) => get().issues.get(key);
  const parentKey = parentOf(issue, lookup),
    parent = parentKey ? lookup(parentKey) : undefined,
    nests = nestable(issue);
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
  const inline = issuePropertyEntries(issue, { close, menu: "contextual" });
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
        ...(canHaveSubIssues(get(), issue)
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
        ...(nests ? [{ name: "Parent issue…", run: () => related("parent") }] : []),
        { name: "Blocked issue…", run: () => related("blocked") },
        { name: "Blocking issue…", run: () => related("blocking") },
      ],
    },
    {
      name: "Mark as",
      icon: "flag",
      children: [
        // An epic is a project: it has no parent issue and no sub-issues.
        ...(canHaveSubIssues(get(), issue) ? [{ name: "Parent of…", run: () => mark("child") }] : []),
        ...(nests
          ? [
              {
                name: "Sub-issue of…",
                shortcut: hotkeyOf("parent-set"),
                run: () => mark("parent"),
              },
            ]
          : []),
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
      children: copyEntries(issue),
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
          inline.project,
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
/** Linear's copy actions (`TX`), one row per kind: the issue menu's Copy submenu and the breadcrumb menu list the same rows. */
export const copyEntries = (issue: Issue): ActionEntry[] =>
  copyKinds.map((kind) => ({
    name: `Copy ${kind}`,
    icon: copyIcons[kind],
    shortcut: hotkeyOf(copyShortcuts[kind] ?? ""),
    // ActionMenu already closed; closing again after the await would close whatever menu opened meanwhile.
    run: () => void copyIssue(kind, issue),
  }));
/** The issue breadcrumb's right-click menu (Linear's `Api` for an issue: `[...TX, Ko(sfn)]`): the copy rows, then ┄ Rename… ⇧R,
 *  which focuses the page's title. */
export const issueBreadcrumbEntries = (issue: Issue): ActionEntry[] => [
  ...copyEntries(issue),
  {
    name: "Rename…",
    icon: "pencil",
    shortcut: hotkeyOf("rename"),
    divider: true,
    run: () => runShortcut("rename", issue.key),
  },
];
/** Linear's Move… (`Lvr`): found by its sub-actions, not its own name; where it sits is `withMoveEntry`'s. */
export const moveMenu = (children: ActionEntry[]): ActionEntry => ({
  name: "Move…",
  icon: "move",
  search: "hidden",
  children,
});
