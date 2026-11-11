/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { RelationIcon, Icon, PriorityIcon, ProgressRing, StatusIcon } from "./icons";
import { Confirm, MenuSurface, MENU_INPUT, MENU_ITEM } from "./menu-surface";
import { RichEditor } from "./rich-editor-loader";
import {
  discardLateMedia,
  documentHasMedia,
  lateMediaDiscarded,
  normalizeDocument,
  type AdfDocument,
} from "./document";
import {
  actions,
  addLocalFiles,
  beginCreate,
  get,
  issueURL,
  ME,
  navigate,
  restoreLocalFiles,
  set,
  toggleFavorite,
  useStore,
  type Issue,
  type IssueDraft,
} from "./store";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Avatar } from "./avatar";
import { copyIcons, copyKinds, copyShortcuts, issueCopy } from "./issue-copy";
import { Relations } from "./personal-controls";
import { ResourceForm, createIssueDocument } from "./issue-resources";
import { duePresets, shortDate } from "./due-date";
import { reminderPresets, reminderTime } from "./reminder-display";
import { shortcutLabel } from "./shortcuts";
import { RELATION_ISSUE } from "./issue-activity";
import { canHaveChildren, needsParent } from "./issue-properties";
import { priorityRank, rankBetween, type Property } from "./view-model";
import { defaultSubIssueDisplay, subIssueRows, type SubIssueDisplay } from "./sub-issue-model";
import {
  emptySubIssueDraft,
  readSubIssueDraft,
  saveSubIssueDraft,
  type SubIssueDraft,
} from "./sub-issue-draft";

const orderings = [
  ["manual", "Manual"],
  ["title", "Title"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["assignee", "Assignee"],
  ["estimate", "Estimate"],
  ["updated", "Updated"],
  ["created", "Created"],
  ["due", "Due date"],
  ["links", "Link count"],
] as const;
const properties: [Property, string][] = [
  ["priority", "Priority"],
  ["id", "ID"],
  ["status", "Status"],
  ["labels", "Labels"],
  ["milestone", "Milestone"],
  ["due", "Due date"],
  ["links", "Links"],
  ["assignee", "Assignee"],
  ["pullRequests", "Pull requests"],
];
const button = "rounded px-2 py-1 text-fg-3 hover:bg-hover";
/** Linear's round 28px section buttons (Display options, Create new sub-issue). */
export const CIRCLE =
  "grid size-7 place-items-center rounded-full bg-card text-fg-3 hover:bg-hover";
type Field = "status" | "priority" | "assignee" | "labels";
type Picker = { anchor: HTMLElement; field: Field; key?: string };
function parseDisplay(value: unknown): SubIssueDisplay {
  const base = defaultSubIssueDisplay();
  if (!value || typeof value !== "object") return base;
  const source = value as Partial<SubIssueDisplay>;
  return {
    ...base,
    ...(orderings.some(([id]) => id === source.ordering) ? { ordering: source.ordering } : {}),
    ...(["all", "day", "week", "month", "none"].includes(source.completed ?? "")
      ? { completed: source.completed }
      : {}),
    ...(typeof source.nested === "boolean" ? { nested: source.nested } : {}),
    ...(Array.isArray(source.properties)
      ? { properties: source.properties.filter((p) => properties.some(([id]) => id === p)) }
      : {}),
  } as SubIssueDisplay;
}
type Boards = ReturnType<typeof get>["boards"];
export const statusOf = (boards: Boards, child: Issue) => {
  const columns = boards.find((b) => b.id === child.board)?.columns ?? [];
  const result = columns.flatMap((c) => c.statuses).find((s) => s.id === child.status);
  return {
    name: result?.name ?? child.status,
    category: result?.category ?? "new",
    order: columns.findIndex((c) => c.statuses.some((s) => s.id === child.status)),
  };
};
const openIssue = (target: Issue) =>
  navigate({ board: target.board, selected: target.key, panel: true, view: get().view });

/** Linear's "Sub-issue of" line under a child's title: the parent link, and a progress pill whose menu lists the parent's sub-issues (⌘⇧→). */
export function SubIssueOf({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    [menu, setMenu] = useState<HTMLElement | null>(null);
  const parent = issue.parent ? all.get(issue.parent) : undefined;
  if (!parent) return null;
  const status = (i: Issue) => statusOf(boards, i),
    model = subIssueRows(parent.key, [...all.values()], defaultSubIssueDisplay(), status),
    siblings = model.rows.filter((row) => row.depth === 0).map((row) => row.issue);
  return (
    <div className="mt-2 mb-2.5 flex h-[26px] items-center text-[13px] leading-[normal]">
      <span className="mr-0.5 font-[450] text-fg-3">Sub-issue of</span>
      <a
        data-parent-link
        className="flex h-[26px] min-w-0 items-center gap-1 rounded-lg border border-transparent px-1 hover:bg-hover"
        href={issueURL(parent)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          openIssue(parent);
        }}
      >
        <span className="grid size-3.5 place-items-center">
          <StatusIcon status={status(parent)} />
        </span>
        <span className="font-[450] text-fg-3">{parent.key}</span>
        <span className="truncate font-medium text-fg">{parent.summary}</span>
      </a>
      <button
        data-parent-progress
        title={`Open sub-issues of ${parent.key} (${shortcutLabel("sub-issues-of-parent")})`}
        aria-label={`Open sub-issues of ${parent.key}`}
        className="ml-1 flex h-[26px] shrink-0 items-center gap-1.5 rounded-full border border-line-3 px-2 text-[12px] font-[450] text-fg-3 hover:bg-hover"
        onClick={(event) => setMenu(event.currentTarget)}
      >
        <ProgressRing value={model.total ? model.completed / model.total : 0} />
        {model.completed}/{model.total}
      </button>
      {menu && (
        <MenuSurface
          label={`Open sub-issues of ${parent.key}`}
          anchor={menu}
          close={() => setMenu(null)}
          width={349}
        >
          <Command loop className="-m-3 py-0">
            <Command.Input
              autoFocus
              aria-label={`Open sub-issues of ${parent.key}…`}
              className="sr-only"
            />
            <Command.List className="pb-1.5">
              <Command.Group
                heading="Navigation"
                className="[&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:leading-[14px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-3"
              >
                {siblings.map((child) => (
                  <Command.Item
                    key={child.key}
                    value={`${child.key} ${child.summary}`}
                    className={`${MENU_ITEM} mx-1.5 w-auto! px-2 font-[450]`}
                    onSelect={() => {
                      setMenu(null);
                      if (child.key !== issue.key) openIssue(child);
                    }}
                  >
                    <StatusIcon status={status(child)} />
                    <span className="text-fg-3">{child.key}</span>
                    <span className="min-w-0 flex-1 truncate text-fg-2">{child.summary}</span>
                    {child.key === issue.key && <Icon name="check" size={16} />}
                    {child.assignee ? (
                      <Avatar user={child.assignee} size={14} />
                    ) : (
                      <span
                        title="Unassigned"
                        className="grid size-3.5 place-items-center rounded-full bg-sel"
                      />
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </MenuSurface>
      )}
    </div>
  );
}

export function SubIssues({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    namespace = useStore((s) => s.namespace),
    writable = useStore((s) => s.writable),
    jiraPriorities = useStore((s) => s.options.priorities);
  const noPriority = writable ? "Default priority" : "No priority";
  const storageKey = `better-jira:sub-issues:v1:${namespace}`;
  const [display, setDisplay] = useState(() => {
    try {
      return parseDisplay(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
    } catch {
      return defaultSubIssueDisplay();
    }
  });
  const [rowDialog, setRowDialog] = useState<{
    kind: "link" | "pull-request" | "rename" | "relation";
    key: string;
  } | null>(null);
  // Linear keeps each issue's section collapsed across reloads.
  const collapseKey = `better-jira:sub-issues-collapsed:v1:${namespace}:${issue.key}`;
  const [collapsed, setCollapsedState] = useState(() => {
      try {
        return localStorage.getItem(collapseKey) === "1";
      } catch {
        return false;
      }
    }),
    setCollapsed = (value: boolean) => {
      setCollapsedState(value);
      try {
        if (value) localStorage.setItem(collapseKey, "1");
        else localStorage.removeItem(collapseKey);
      } catch {}
    },
    [reveal, setReveal] = useState(false),
    [creating, setCreating] = useState(false),
    [settings, setSettings] = useState<HTMLElement | null>(null),
    [rowMenu, setRowMenu] = useState<{
      anchor: HTMLElement;
      key: string;
      point?: { x: number; y: number };
    } | null>(null),
    [picker, setPicker] = useState<Picker | null>(null),
    [query, setQuery] = useState(""),
    [confirming, setConfirming] = useState(false);
  const board = boards.find((b) => b.id === issue.board)!;
  const initial = (): IssueDraft => ({
    parent: issue.key,
    project: issue.project,
    assignee: ME,
    priority: undefined,
    status:
      board.columns
        .find((c) => !/backlog/i.test(c.name) && c.statuses.some((s) => s.category === "new"))
        ?.statuses.find((s) => s.category === "new")?.id ?? board.columns[0]?.statuses[0]?.id,
    labels: [],
  });
  const draftKey = `better-jira:sub-issue-draft:v1:${namespace}:${issue.key}`;
  const [value, setValue] = useState(() => readSubIssueDraft(draftKey, initial())),
    pending = useRef(value),
    [editor, setEditor] = useState(0);
  const { title, description, files, properties: draft } = value;
  const update = (patch: Partial<SubIssueDraft>) => {
    const next = { ...pending.current, ...patch };
    pending.current = next;
    setValue(next);
    try {
      saveSubIssueDraft(draftKey, next);
    } catch {
      set({ perf: "Could not retain this sub-issue draft across reloads" });
    }
  };
  // An upload that finishes after this composer closed (navigation, a remount) updates whichever composer now owns the draft, else the stored draft;
  // never this closure's stale copy, which would overwrite newer edits. A discarded draft drops it (discardLateMedia).
  const scope = `${issue.key}:sub-issue`,
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const apply = (event: Event) => {
      event.preventDefault();
      update(
        (event as CustomEvent<(draft: SubIssueDraft) => Partial<SubIssueDraft>>).detail(
          pending.current,
        ),
      );
    };
    addEventListener(`late:${draftKey}`, apply);
    return () => {
      mounted.current = false;
      removeEventListener(`late:${draftKey}`, apply);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, [draftKey]);
  const late = (change: (draft: SubIssueDraft) => Partial<SubIssueDraft>) => {
    if (mounted.current) {
      update(change(pending.current));
      return;
    }
    if (dispatchEvent(new CustomEvent(`late:${draftKey}`, { detail: change, cancelable: true }))) {
      try {
        const stored = readSubIssueDraft(draftKey, initial());
        saveSubIssueDraft(draftKey, { ...stored, ...change(stored) });
      } catch {}
    }
  };
  useEffect(() => {
    let active = true;
    void restoreLocalFiles(pending.current.files).then((saved) => {
      if (active)
        update({
          files: pending.current.files.map(
            (file) => saved.find((restored) => restored.id === file.id) ?? file,
          ),
        });
    });
    return () => {
      active = false;
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, []);
  const form = useRef<HTMLDivElement>(null),
    titleInput = useRef<HTMLInputElement>(null);
  const status = (child: Issue) => statusOf(boards, child);
  // Direct children per row, for Linear's "0/2" progress pill.
  const progress = useMemo(() => {
    const counts = new Map<string, [number, number]>();
    for (const i of all.values())
      if (i.parent) {
        const count = counts.get(i.parent) ?? [0, 0];
        count[1]++;
        if (status(i).category === "done") count[0]++;
        counts.set(i.parent, count);
      }
    return counts;
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, [all, boards]);
  const model = useMemo(
    () => subIssueRows(issue.key, [...all.values()], display, status, Date.now(), reveal),
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
    [issue.key, all, boards, display, reveal],
  );
  useEffect(() => {
    setReveal(false);
  }, [display.completed, display.nested]);
  useEffect(() => {
    setQuery("");
  }, [picker?.field, picker?.key]);
  const change = (patch: Partial<SubIssueDisplay>) => {
    const next = { ...display, ...patch };
    setDisplay(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      set({ perf: "Could not save sub-issue display settings" });
    }
  };
  const start = () => {
    setCollapsed(false);
    setCreating(true);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  const close = () => {
    setCreating(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-sub-issues="${CSS.escape(issue.key)}"] [data-create-child]`,
        )
        ?.focus(),
    );
  };
  const discard = () => {
    discardLateMedia(scope);
    setConfirming(false);
    update(emptySubIssueDraft(initial()));
    setEditor((n) => n + 1);
    close();
  };
  // Like Linear: a draft with content asks before it is thrown away; an empty one just closes.
  const filled = () => {
    const { title, description, files } = pending.current;
    return (
      !!title.trim() ||
      files.length > 0 ||
      JSON.stringify(description).includes('"text"') ||
      documentHasMedia(description)
    );
  };
  const cancel = () => {
    if (filled()) setConfirming(true);
    else discard();
  };
  // Escape first leaves the field for the composer itself, then cancels from there.
  const escape = () => {
    if (document.activeElement !== form.current) form.current?.focus();
    else cancel();
  };
  // The editor hands over its document: a send deferred for an upload has media this render's closure has not seen (Opus review 4).
  const submit = (doc?: AdfDocument) => {
    const { title, description, files, properties: draft } = pending.current;
    if (!title.trim() || files.some((file) => file.missing)) return;
    const lastRank = [...all.values()]
      .filter((i) => i.parent === issue.key)
      .map((i) => i.rank ?? "")
      .sort()
      .at(-1);
    const key = actions.create(
      title,
      {
        ...draft,
        rank: rankBetween(lastRank),
        descriptionDoc: doc ?? description,
        attachments: files,
      },
      true,
    );
    if (!key) return;
    // Linear starts the next sub-issue from the defaults, not the last one's properties.
    update({ title: "", description: normalizeDocument(""), files: [], properties: initial() });
    setEditor((n) => n + 1);
    requestAnimationFrame(() => titleInput.current?.focus());
  };
  const submitFromButton = () =>
    form.current?.querySelector<HTMLButtonElement>(".rich-editor-submit")?.click();
  useHotkey("Mod+Enter", submitFromButton, {
    target: titleInput,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Mod+Shift+Enter", submitFromButton, {
    target: form,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Mod+Shift+O", () => titleInput.current?.focus(), {
    target: form,
    capture: true,
    ignoreInputs: false,
  });
  useHotkey("Escape", escape, { target: form, capture: true, ignoreInputs: false });
  const target = picker?.key ? all.get(picker.key) : undefined;
  const targetDraft = target ?? draft;
  const select = (field: Field, value: string, on = target) => {
    const base = on ?? draft;
    let patch: IssueDraft = {};
    if (field === "status") patch = { status: value };
    if (field === "priority") patch = { priority: value || undefined };
    if (field === "assignee")
      patch = {
        assignee:
          [ME, ...[...all.values()].flatMap((i) => (i.assignee ? [i.assignee] : []))].find(
            (u) => u.id === value,
          ) ?? null,
      };
    if (field === "labels")
      patch = {
        labels: base.labels?.includes(value)
          ? base.labels.filter((l) => l !== value)
          : [...(base.labels ?? []), value],
      };
    if (on) {
      if (field === "status") actions.status(on.key, value);
      else actions.patch(on.key, patch);
    } else update({ properties: { ...draft, ...patch } });
    if (field !== "labels") setPicker(null);
    else setQuery("");
  };
  const selected = (id: string) =>
    picker?.field === "labels"
      ? targetDraft.labels?.includes(id)
      : picker?.field === "status"
        ? targetDraft.status === id
        : picker?.field === "priority"
          ? (targetDraft.priority ?? "") === id
          : (targetDraft.assignee?.id ?? "") === id;
  const choicesFor = (field: Field | undefined, on = target) =>
    field === "status"
      ? ((on ? boards.find((b) => b.id === on.board) : board)?.columns
          .flatMap((c) => c.statuses)
          .map((s) => ({ id: s.id, name: s.name })) ?? [])
      : field === "priority"
        ? [
            ...(writable && on ? [] : [{ id: "", name: noPriority }]),
            ...[
              ...new Set([
                ...jiraPriorities.map((p) => p.name),
                ...[...all.values()].flatMap((i) => (i.priority ? [i.priority] : [])),
              ]),
            ]
              .sort((a, b) => priorityRank(a) - priorityRank(b))
              .map((p) => ({ id: p, name: p })),
          ]
        : field === "assignee"
          ? [
              { id: "", name: "Unassigned" },
              ...[
                ...new Map(
                  [ME, ...[...all.values()].flatMap((i) => (i.assignee ? [i.assignee] : []))].map(
                    (u) => [u.id, u],
                  ),
                ).values(),
              ].map((u) => ({ id: u.id, name: u.name })),
            ]
          : [
              ...new Set([
                ...((on ?? draft).labels ?? []),
                ...[...all.values()].flatMap((i) => i.labels),
              ]),
            ].map((label) => ({ id: label, name: label }));
  const choices = choicesFor(picker?.field);
  const control = (child: Issue, field: Field, content: React.ReactNode) => (
    <button
      type="button"
      title={
        field === "status"
          ? status(child).name
          : field === "priority"
            ? (child.priority ?? "No priority")
            : field === "assignee"
              ? (child.assignee?.name ?? "Unassigned")
              : child.labels.join(", ")
      }
      aria-haspopup="dialog"
      aria-expanded={picker?.key === child.key && picker.field === field}
      aria-label={`Change ${field} for ${child.key}`}
      className={button}
      onClick={(event) => setPicker({ anchor: event.currentTarget, field, key: child.key })}
    >
      {content}
    </button>
  );
  const rowEntries = (child: Issue, _anchor: HTMLElement): ActionEntry[] => [
    // Linear's row menu groups, icons and hints (RAJ-52, 2026-11-08), acting on the row's issue. Convert to and Open in have no local equivalent.
    ...(
      [
        ["status", "status", "status"],
        ["priority", "priority", "priority"],
        ["assignee", "user", "assign"],
      ] as const
    ).map(([field, icon, key]) => ({
      name: field[0]!.toUpperCase() + field.slice(1),
      icon,
      shortcut: shortcutLabel(key) || undefined,
      children: choicesFor(field, child).map((choice) => ({
        name: choice.name,
        run: () => select(field, choice.id, child),
      })),
    })),
    {
      name: "Due date",
      icon: "calendar",
      shortcut: shortcutLabel("due") || undefined,
      children: duePresets().map((preset) => ({
        name: preset.name,
        shortcut: preset.label,
        run: () => actions.patch(child.key, { due: preset.due }),
      })),
    },
    {
      name: "Labels",
      icon: "label",
      shortcut: shortcutLabel("labels") || undefined,
      children: choicesFor("labels", child).map((choice) => ({
        name: `${child.labels.includes(choice.id) ? "✓ " : ""}${choice.name}`,
        run: () => select("labels", choice.id, child),
      })),
    },
    // Jira's API can't move an issue to another project or out of one.
    ...(writable
      ? []
      : ([
          {
            name: "Project",
            icon: "layers",
            shortcut: shortcutLabel("project") || undefined,
            children: [
              {
                name: "No project",
                run: () => actions.patch(child.key, { project: null, milestones: [] }),
              },
              ...[
                ...new Map(
                  [...all.values()].flatMap((i) =>
                    i.project ? [[i.project.key, i.project] as const] : [],
                  ),
                ).values(),
              ].map((project) => ({
                name: `${child.project?.key === project.key ? "✓ " : ""}${project.name}`,
                run: () => actions.patch(child.key, { project, milestones: [] }),
              })),
            ],
          },
        ] as ActionEntry[])),
    {
      name: "More properties",
      icon: "square-dots",
      children: [
        {
          name: "Add link…",
          icon: "link",
          shortcut: shortcutLabel("link") || undefined,
          run: () => setRowDialog({ kind: "link", key: child.key }),
        },
        {
          name: "Add pull request…",
          icon: "branch",
          run: () => setRowDialog({ kind: "pull-request", key: child.key }),
        },
        { name: "Add document…", icon: "file", run: () => void createIssueDocument(child) },
        {
          name: "Rename…",
          icon: "pencil",
          shortcut: shortcutLabel("rename") || undefined,
          run: () => setRowDialog({ kind: "rename", key: child.key }),
        },
      ],
    },
    {
      name: "Create related",
      icon: "square-plus",
      divider: true,
      children: [
        {
          name: "Issue…",
          run: () =>
            beginCreate({ related: { key: child.key, kind: "related" }, project: child.project }),
        },
        ...(canHaveChildren(get(), child)
          ? [
              {
                name: "Sub-issue…",
                run: () => beginCreate({ parent: child.key, project: child.project }),
              },
            ]
          : []),
        ...(["parent", "blocked", "blocking"] as const).map((kind) => ({
          name: `${kind === "parent" ? "Parent" : kind === "blocked" ? "Blocked" : "Blocking"} issue…`,
          run: () => beginCreate({ related: { key: child.key, kind }, project: child.project }),
        })),
      ],
    },
    {
      name: "Mark as",
      icon: "flag",
      children: (
        [
          ["child", "Parent of…"],
          ["parent", "Sub-issue of…", "parent-set"],
          ["related", "Related to…", "related"],
          ["blocked", "Blocked by…", "blocked"],
          ["blocking", "Blocking…", "blocking"],
          ["duplicate", "Duplicate of…", "duplicate"],
        ] as const
      ).map(([kind, name, key]) => ({
        name,
        shortcut: key ? shortcutLabel(key) || undefined : undefined,
        run: () => {
          set({ relationKind: kind });
          setRowDialog({ kind: "relation", key: child.key });
        },
      })),
    },
    // Remove sits in the Create related group and names the parent and every relation by the other issue's role, as on Issue options.
    ...((child.parent && !needsParent(get(), child)) || child.relations?.length
      ? [
          {
            name: "Remove",
            icon: "flag-x" as const,
            children: [
              ...(child.parent && !needsParent(get(), child)
                ? [
                    {
                      name: `Parent issue ${child.parent} ${all.get(child.parent)?.summary ?? ""}`.trim(),
                      run: () => actions.patch(child.key, { parent: undefined }),
                    },
                  ]
                : []),
              ...(child.relations ?? []).map((r) => {
                const role = RELATION_ISSUE[r.kind] ?? "related";
                return {
                  name: `${role[0]!.toUpperCase()}${role.slice(1)} issue ${r.key} ${all.get(r.key)?.summary ?? ""}`.trim(),
                  run: () => actions.relate(child.key, r.key, r.kind, true),
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
        shortcut: shortcutLabel(copyShortcuts[kind] ?? "") || undefined,
        run: () =>
          void navigator.clipboard
            .writeText(
              issueCopy(kind, child, undefined, issueURL(child), status(child).name, ME.name),
            )
            .then(
              () => set({ perf: `Copied ${kind}` }),
              () => set({ perf: "Could not access the clipboard" }),
            ),
      })),
    },
    { name: "Make a copy…", icon: "copy", run: () => actions.duplicate(child.key) },
    {
      name: get().favorites.includes(child.key) ? "Remove from favorites" : "Favorite",
      icon: get().favorites.includes(child.key) ? "starred" : "star",
      divider: true,
      shortcut: shortcutLabel("favorite") || undefined,
      run: () => toggleFavorite(child.key),
    },
    {
      name: "Remind me",
      icon: "clock",
      shortcut: shortcutLabel("remind") || undefined,
      children: reminderPresets().map((preset) => ({
        name: preset.label,
        shortcut: reminderTime(preset.at),
        run: () => actions.remind(child.key, preset.at),
      })),
    },
    {
      name: "Delete",
      icon: "trash",
      divider: true,
      shortcut: shortcutLabel("delete") || undefined,
      danger: true,
      run: () => actions.remove(child.key),
    },
  ];
  const childURL = (child: Issue) => {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("board", String(child.board));
    url.searchParams.set("issue", child.key);
    url.searchParams.delete("document");
    return url.href;
  };
  return (
    <section data-sub-issues={issue.key} aria-label="Sub-issues" className="mt-[14px] text-[13px]">
      {!!model.total && (
        <div className="-ml-1.5 mb-2 flex items-center gap-1.5 pr-2">
          <button
            aria-label={collapsed ? "Expand sub-issues section" : "Collapse sub-issues section"}
            aria-expanded={!collapsed}
            className="flex h-6 items-center gap-0.5 rounded-full pr-[13px] pl-1.5 text-[12px] font-medium text-fg-3 hover:bg-hover"
            onClick={() => setCollapsed(!collapsed)}
          >
            <span className={`grid size-4 place-items-center ${collapsed ? "" : "rotate-90"}`}>
              <Icon name="chevron" size={14} />
            </span>
            <span>Sub-issues</span>
          </button>
          <span
            data-sub-progress
            className="ml-0.5 flex items-center gap-1.5 text-[12px] text-fg-3"
          >
            <ProgressRing value={model.completed / model.total} />
            {model.completed}/{model.total}
          </span>
          <span className="flex-1" />
          {model.hiddenCompleted > 0 && (
            <button className={button} onClick={() => setReveal(!reveal)}>
              {reveal ? "Hide" : "Show"} {model.hiddenCompleted} completed
            </button>
          )}
          <button
            aria-label="Sub-issue display options"
            className={CIRCLE}
            onClick={(e) => setSettings(e.currentTarget)}
          >
            <Icon name="display" size={14} />
          </button>
          <button
            data-create-child
            aria-label="Create new sub-issue"
            className={CIRCLE}
            onClick={start}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      )}
      {!collapsed &&
        model.rows.map(({ issue: child, depth, contextOnly }, index) => (
          <div
            key={child.key}
            data-sub-issue={child.key}
            data-depth={depth}
            data-context-only={contextOnly || undefined}
            className={`relative -ml-1.5 flex min-h-9 items-center gap-px rounded-lg pr-1 hover:bg-hover ${rowMenu?.key === child.key ? "bg-hover" : ""}`}
            style={{ paddingLeft: 31 + depth * 24 }}
            onContextMenu={(event) => {
              event.preventDefault();
              setRowMenu({
                anchor: event.currentTarget,
                key: child.key,
                point: { x: event.clientX + 3, y: event.clientY },
              });
            }}
          >
            {Array.from({ length: depth }, (_, level) => {
              level++;
              const left = level * 24 + 21.5,
                more = continues(
                  model.rows,
                  index,
                  level,
                ); /* Linear's tree: a line under each open branch, ending in a curved elbow beside the row's own icon */
              return level < depth ? (
                more && (
                  <span
                    key={level}
                    aria-hidden
                    data-guide
                    className="absolute inset-y-0 w-px bg-line-3"
                    style={{ left }}
                  />
                )
              ) : (
                <Fragment key={level}>
                  <span
                    aria-hidden
                    data-guide
                    className="absolute top-0 w-px bg-line-3"
                    style={{ left, height: more ? "100%" : 12 }}
                  />
                  <svg
                    aria-hidden
                    data-elbow
                    width="10"
                    height="9"
                    viewBox="0 0 10 9"
                    className="absolute fill-line-3"
                    style={{ left, top: 10 }}
                  >
                    <path d="M0 0h1v1c0 2.5 2.212 3.546 2.212 3.546L9.737 8.06c.568.306.094 1.186-.474.88l-6.48-3.488S0 4 0 1V0Z" />
                  </svg>
                </Fragment>
              );
            })}
            {display.properties.includes("status") &&
              control(child, "status", <StatusIcon status={status(child)} />)}
            {display.properties.includes("priority") &&
              control(child, "priority", <PriorityIcon name={child.priority} />)}
            {display.properties.includes("id") && (
              <span className="px-1 text-fg-3">{child.key}</span>
            )}
            <a
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-[13px] font-medium text-fg"
              href={childURL(child)}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigate({
                  board: child.board,
                  selected: child.key,
                  panel: true,
                  view: get().view,
                });
              }}
            >
              <span className="truncate">{child.summary}</span>
              {progress.has(child.key) && (
                <span
                  data-row-progress
                  className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-line-2 px-2 text-[12px] font-[450] text-fg-3"
                >
                  <ProgressRing value={progress.get(child.key)![0] / progress.get(child.key)![1]} />
                  {progress.get(child.key)!.join("/")}
                </span>
              )}
            </a>
            {/* Linear's row badges (RAJ-54 blocking 1, RAJ-55 blocked 1; Opus review 4): a red relation icon and how many issues. */}
            {(["blocking", "blocked"] as const).map((kind) => {
              const count = child.relations?.filter((r) => r.kind === kind).length ?? 0;
              return (
                count > 0 && (
                  <span
                    key={kind}
                    data-row-relation={kind}
                    title={`${kind === "blocked" ? "Blocked by" : "Blocking"} ${count} ${count === 1 ? "issue" : "issues"}`}
                    className="flex shrink-0 items-center gap-1 text-[12px] font-[450] text-fg-3"
                  >
                    <RelationIcon kind={kind} />
                    {count}
                  </span>
                )
              );
            })}
            {display.properties.includes("labels") &&
              control(child, "labels", child.labels.join(", ") || <Icon name="label" size={13} />)}
            {display.properties.includes("milestone") && (
              <span className="truncate text-fg-3">
                {child.milestones?.map((m) => m.name).join(", ")}
              </span>
            )}
            {display.properties.includes("due") && child.due && (
              <time dateTime={child.due} className="text-fg-3">
                {shortDate(child.due, undefined, true)}
              </time>
            )}
            {display.properties.includes("links") && !!child.links?.length && (
              <span title="Links">{child.links.length}</span>
            )}
            {display.properties.includes("pullRequests") && !!child.prCount && (
              <span title="Pull requests">{child.prCount}</span>
            )}
            {display.properties.includes("assignee") &&
              control(
                child,
                "assignee",
                child.assignee ? (
                  <Avatar user={child.assignee} size={18} />
                ) : (
                  <span
                    title="Unassigned"
                    className="grid size-[18px] place-items-center rounded-full bg-sel text-[10px]"
                  >
                    <Icon name="user" size={12} />
                  </span>
                ),
              )}
          </div>
        ))}
      {!model.total && !creating && canHaveChildren(get(), issue) && (
        <button
          data-create-child
          aria-label="Add sub-issues"
          className={`${button} px-0`}
          onClick={start}
        >
          + Add sub-issues
        </button>
      )}
      {creating && (
        <div
          ref={form}
          tabIndex={-1}
          aria-label="Create sub-issue"
          className="sub-issue-composer outline-none mt-3 rounded-lg border border-line-2 bg-card p-3"
        >
          <div className="flex items-center gap-2">
            <button
              aria-label={`Sub-issue status. ${board.columns.flatMap((c) => c.statuses).find((s) => s.id === draft.status)?.name ?? "Todo"} is selected`}
              className={button}
              onClick={(e) => setPicker({ anchor: e.currentTarget, field: "status" })}
            >
              <StatusIcon
                status={
                  board.columns.flatMap((c) => c.statuses).find((s) => s.id === draft.status) ?? {
                    name: "Todo",
                    category: "new",
                  }
                }
              />
            </button>
            <input
              ref={titleInput}
              autoFocus
              aria-label="Sub-issue title"
              placeholder="Issue title"
              value={title}
              onChange={(e) => update({ title: e.target.value })}
              className="min-w-0 flex-1 bg-transparent p-1 text-[14px] outline-none"
            />
          </div>
          <RichEditor
            key={editor}
            inline
            id={`sub-issue-description-${issue.key}`}
            mentionIssue={issue.key}
            scope={scope}
            onLateMedia={(merge) => late((draft) => ({ description: merge(draft.description) }))}
            initial={description}
            label="Sub-issue description"
            placeholder="Add description…"
            attachments={files}
            onFiles={async (selected) => {
              const since = performance.now(),
                saved = await addLocalFiles(selected);
              if (!lateMediaDiscarded(scope, since))
                late((draft) => ({ files: [...draft.files, ...saved] }));
              return saved;
            }}
            onChange={(description) => update({ description })}
            onSave={submit}
            saveLabel="Create"
            hint="⌘↵ create · Esc close"
            onCancel={cancel}
          />
          <div className="flex gap-1">
            {(["priority", "assignee", "labels"] as const).map((field) => (
              <button
                key={field}
                aria-label={
                  field === "priority"
                    ? `Sub-issue priority. ${draft.priority ?? noPriority} is selected`
                    : field === "assignee"
                      ? `Sub-issue assignee. ${draft.assignee?.name ?? "Unassigned"}`
                      : `Sub-issue labels. ${draft.labels?.join(", ") || "No labels"}`
                }
                className={button}
                onClick={(e) => setPicker({ anchor: e.currentTarget, field })}
              >
                <span className="flex items-center gap-1.5">
                  {field === "priority" ? (
                    <PriorityIcon name={draft.priority} />
                  ) : (
                    <Icon name={field === "labels" ? "label" : "user"} size={14} />
                  )}
                  {/* Linear names the value on each chip: "Priority", the assignee, "Labels". */}
                  {field === "priority"
                    ? (draft.priority ?? "Priority")
                    : field === "assignee"
                      ? (draft.assignee?.name ?? "Assignee")
                      : draft.labels?.length
                        ? draft.labels.join(", ")
                        : "Labels"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {rowDialog &&
        all.get(rowDialog.key) &&
        (() => {
          const child = all.get(rowDialog.key)!,
            done = () => setRowDialog(null);
          return rowDialog.kind === "relation" ? (
            <Relations issue={child} close={done} />
          ) : rowDialog.kind === "rename" ? (
            <RenameIssue issue={child} close={done} />
          ) : (
            <ResourceForm issue={child} kind={rowDialog.kind} close={done} />
          );
        })()}
      {rowMenu && all.get(rowMenu.key) && (
        <ActionMenu
          anchor={rowMenu.anchor}
          point={rowMenu.point}
          align="end"
          label="Sub-issue actions"
          entries={rowEntries(all.get(rowMenu.key)!, rowMenu.anchor)}
          close={() => setRowMenu(null)}
        />
      )}
      {confirming && (
        <Confirm
          title="Discard this draft?"
          detail="Confirm that you want to discard this draft."
          action="Discard"
          onConfirm={discard}
          close={() => setConfirming(false)}
        />
      )}
      {settings && (
        <MenuSurface
          label="Sub-issue display options"
          anchor={settings}
          close={() => setSettings(null)}
          width={300}
        >
          <label className="mb-3 flex items-center justify-between">
            Ordering
            <select
              aria-label="Sub-issue ordering"
              value={display.ordering}
              className="rounded bg-card p-1"
              onChange={(e) => change({ ordering: e.target.value as SubIssueDisplay["ordering"] })}
            >
              {orderings.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 flex items-center justify-between">
            Completed issues
            <select
              aria-label="Completed sub-issues"
              value={display.completed}
              className="rounded bg-card p-1"
              onChange={(e) =>
                change({ completed: e.target.value as SubIssueDisplay["completed"] })
              }
            >
              {[
                ["all", "All"],
                ["day", "Past day"],
                ["week", "Past week"],
                ["month", "Past month"],
                ["none", "None"],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mb-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={display.nested}
              onChange={(e) => change({ nested: e.target.checked })}
            />
            Nested sub-issues
          </label>
          <p className="mb-2 text-fg-3">Display properties</p>
          <div className="flex flex-wrap gap-1">
            {properties.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={display.properties.includes(id)}
                className={`${button} border border-line-2 aria-pressed:bg-sel`}
                onClick={() =>
                  change({
                    properties: display.properties.includes(id)
                      ? display.properties.filter((p) => p !== id)
                      : [...display.properties, id],
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
        </MenuSurface>
      )}
      {picker && (
        <MenuSurface
          label={`Change sub-issue ${picker.field}`}
          anchor={picker.anchor}
          close={() => setPicker(null)}
          width={280}
        >
          <Command loop defaultValue={choices.find((c) => selected(c.id))?.name}>
            <Command.Input
              autoFocus
              aria-label={`Find sub-issue ${picker.field}`}
              placeholder="Filter…"
              value={query}
              onValueChange={setQuery}
              className={MENU_INPUT}
            />
            <Command.List className="max-h-[40vh] overflow-y-auto p-1">
              <Command.Empty>No matches</Command.Empty>
              {choices.map((choice) => (
                <Command.Item
                  key={choice.id}
                  className={MENU_ITEM}
                  value={choice.name}
                  aria-checked={!!selected(choice.id)}
                  onSelect={() => select(picker.field, choice.id)}
                >
                  {picker.field === "priority" && <PriorityIcon name={choice.id || undefined} />}
                  {picker.field === "status" && (
                    <StatusIcon
                      status={
                        board.columns
                          .flatMap((c) => c.statuses)
                          .find((st) => st.id === choice.id) ?? {
                          name: choice.name,
                          category: "new",
                        }
                      }
                    />
                  )}
                  <span className="flex-1">{choice.name}</span>
                  {selected(choice.id) && <Icon name="check" size={13} />}
                </Command.Item>
              ))}
              {picker.field === "labels" &&
                query.trim() &&
                !choices.some((c) => c.id.toLowerCase() === query.trim().toLowerCase()) && (
                  <Command.Item
                    className={MENU_ITEM}
                    value={`Create ${query}`}
                    onSelect={() => select("labels", query.trim())}
                  >
                    Create label "{query.trim()}"
                  </Command.Item>
                )}
            </Command.List>
          </Command>
        </MenuSurface>
      )}
    </section>
  );
}

/** Linear's Rename… from a sub-issue row: the title in a small dialog, Enter saves. */
function RenameIssue({ issue, close }: { issue: Issue; close: () => void }) {
  const [title, setTitle] = useState(issue.summary);
  return (
    <MenuSurface label="Rename issue" close={close} width={420}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && title.trim() !== issue.summary)
            actions.summary(issue.key, title.trim());
          close();
        }}
      >
        <input
          autoFocus
          aria-label="Issue title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded border border-line-2 bg-transparent px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </form>
    </MenuSurface>
  );
}
const continues = (rows: { depth: number }[], index: number, level: number) => {
  for (const row of rows.slice(index + 1)) if (row.depth <= level) return row.depth === level;
  return false;
};
