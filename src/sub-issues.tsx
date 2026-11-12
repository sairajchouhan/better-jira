/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useSubIssueComposer } from "./use-sub-issue-composer";
import { useStoredState } from "./stored-state";
import { RelationIcon, Icon, PriorityIcon, ProgressRing, StatusIcon } from "./icons";
import { Confirm, MenuSurface } from "./menu-surface";
import { Menu } from "./menu";
import { StatusMenu, PriorityMenu, AssigneeMenu, LabelsMenu } from "./property-menu";
import { issueMenuEntries, type IssueMenuDialog } from "./issue-menu";
import { InlineEditor } from "./rich-editor-loader";
import { useCommand } from "./commands";
import {
  lateMediaDiscarded,
} from "./document";
import {
  actions,
  addLocalFiles,
  get,
  issueURL,
  navigate,
  ui,
  useStore,
  type Board,
  type Issue,
  type IssueDraft,
} from "./store";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Avatar } from "./avatar";
import { statusById } from "./board-catalog";
import { Relations, PropertyPicker } from "./personal-controls";
import { ResourceForm } from "./issue-resources";
import { shortDate } from "./due-date";
import { shortcutLabel } from "./shortcuts";
import { canHaveChildren } from "./issue-properties";
import { type Property } from "./view-model";
import { childrenByParent, defaultSubIssueDisplay, subIssueRows, type SubIssueDisplay } from "./sub-issue-model";


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
/** Each trigger owns its anchor; the explicit field menu owns all picker behavior. */
function PropertyControl({
  field,
  label,
  title,
  className,
  board,
  value,
  priorityEmpty,
  onChange,
  children,
}: {
  field: Field;
  label: string;
  title?: string;
  className: string;
  board: Board;
  value: IssueDraft;
  priorityEmpty?: string;
  onChange: (patch: IssueDraft) => void;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const props = { anchor, board, close: () => setAnchor(null) };
  const menus = {
    status: (
      <StatusMenu
        {...props}
        value={value.status ?? ""}
        onChange={(status) => onChange({ status })}
      />
    ),
    priority: (
      <PriorityMenu
        {...props}
        value={value.priority ?? ""}
        empty={priorityEmpty}
        onChange={(priority) => onChange({ priority: priority || undefined })}
      />
    ),
    assignee: (
      <AssigneeMenu
        {...props}
        value={value.assignee ?? null}
        onChange={(assignee) => onChange({ assignee })}
      />
    ),
    labels: (
      <LabelsMenu
        {...props}
        value={value.labels ?? []}
        onChange={(labels) => onChange({ labels })}
      />
    ),
  };
  return (
    <>
      <button
        type="button"
        title={title}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        aria-label={label}
        className={className}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {children}
      </button>
      {anchor && menus[field]}
    </>
  );
}
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
      ? {
          properties: source.properties.filter((p) => properties.some(([id]) => id === p)),
        }
      : {}),
  } as SubIssueDisplay;
}
type Boards = ReturnType<typeof get>["boards"];
export const statusOf = (boards: Boards, child: Issue) => {
  const board = boards.find((b) => b.id === child.board),
    columns = board?.columns ?? [],
    result = statusById(board, child.status);
  return {
    name: result?.name ?? child.status,
    category: result?.category ?? "new",
    order: columns.findIndex((c) => c.statuses.some((s) => s.id === child.status)),
  };
};
const openIssue = (target: Issue) =>
  navigate({
    board: target.board,
    selected: target.key,
    panel: true,
    view: get().view,
  });

/** Linear's "Sub-issue of" line under a child's title: the parent link, and a progress pill whose menu lists the parent's sub-issues (⌘⇧→). */
export function SubIssueOf({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    [menu, setMenu] = useState<HTMLElement | null>(null),
    progress = useRef<HTMLButtonElement>(null);
  useCommand("open-parent-sub-issues", () => {
    if (!progress.current) return;
    setMenu(progress.current);
    return true;
  });
  const parent = issue.parent ? all.get(issue.parent) : undefined;
  if (!parent) return null;
  const status = (i: Issue) => statusOf(boards, i),
    model = subIssueRows(parent.key, all, defaultSubIssueDisplay(), status),
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
        ref={progress}
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
          fit
        >
          <Menu style={{ width: 347 }}>
            <Menu.Input hideWhenEmpty autoFocus aria-label={`Open sub-issues of ${parent.key}…`} />
            <Menu.List>
              <Menu.Group heading="Navigation">
                {siblings.map((child) => (
                  <Menu.Item
                    key={child.key}
                    value={`${child.key} ${child.summary}`}
                    icon={<StatusIcon status={status(child)} />}
                    checked={child.key === issue.key}
                    hint={<Avatar user={child.assignee ?? null} size={14} />}
                    onSelect={() => {
                      setMenu(null);
                      if (child.key !== issue.key) openIssue(child);
                    }}
                  >
                    <span className="mr-2 text-[var(--menu-fg-3)]">{child.key}</span>
                    {child.summary}
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Menu.List>
          </Menu>
        </MenuSurface>
      )}
    </div>
  );
}

export function SubIssues({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    namespace = useStore((s) => s.namespace),
    writable = useStore((s) => s.writable);
  const noPriority = writable ? "Default priority" : "No priority";
  const storageKey = `better-jira:sub-issues:v1:${namespace}`;
  const [display, setDisplay] = useStoredState(storageKey, parseDisplay, defaultSubIssueDisplay(), "Could not save sub-issue display settings");
  const [rowDialog, setRowDialog] = useState<{
    kind: IssueMenuDialog | "rename" | "relation";
    key: string;
  } | null>(null);
  // Linear keeps each issue's section collapsed across reloads.
  const collapseKey = `better-jira:sub-issues-collapsed:v1:${namespace}:${issue.key}`;
  const [collapsed, setCollapsed] = useStoredState(collapseKey, (raw) => raw === 1 || raw === true, false);
  const [reveal, setReveal] = useState(false),
    [settings, setSettings] = useState<HTMLElement | null>(null),
    [rowMenu, setRowMenu] = useState<{
      anchor: HTMLElement;
      key: string;
      point?: { x: number; y: number };
    } | null>(null);

  const board = boards.find((b) => b.id === issue.board)!;
  const { state: { title, description, files, draft, editor, creating, confirming },
    actions: { update, late, start, discard, cancel, submit, setConfirming },
    meta: { form, titleInput, scope, pending } } = useSubIssueComposer(issue, board, namespace, setCollapsed);
  const status = (child: Issue) => statusOf(boards, child);
  // Direct children per row, for Linear's "0/2" progress pill.
  const progress = useMemo(() => {
    const counts = new Map<string, [number, number]>();
    for (const [parent, children] of childrenByParent(all)) {
      counts.set(parent, [children.filter((i) => status(i).category === "done").length, children.length]);
    }
    return counts;
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
  }, [all, boards]);
  const model = useMemo(
    () => subIssueRows(issue.key, all, display, status, Date.now(), reveal),
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
    [issue.key, all, boards, display, reveal],
  );
  const change = (patch: Partial<SubIssueDisplay>) => {
    if ((patch.completed !== undefined && patch.completed !== display.completed) ||
        (patch.nested !== undefined && patch.nested !== display.nested)) setReveal(false);
    setDisplay({ ...display, ...patch });
  };
  const section = useRef<HTMLElement>(null);
  // ⌘⇧O does what this section's create button does, while it shows one.
  useCommand("create-sub-issue", (key) => {
    const button = section.current?.querySelector<HTMLElement>("[data-create-child]");
    if (key !== issue.key || !button) return;
    button.click();
    return true;
  });
  useCommand(
    "hovered-sub-issue",
    () =>
      section.current?.querySelector<HTMLElement>(
        "[data-sub-issue]:hover, [data-sub-issue]:focus-within",
      )?.dataset.subIssue,
  );
  /** The composer's chip for a field, picking into the draft. */
  const draftControl = (field: Field, label: string, content: React.ReactNode) => (
    <PropertyControl
      key={field}
      field={field}
      board={board}
      value={draft}
      priorityEmpty={noPriority}
      onChange={(patch) => update({ properties: { ...pending.current.properties, ...patch } })}
      label={label}
      className={button}
    >
      {content}
    </PropertyControl>
  );
  const rowEntries = (child: Issue, _anchor: HTMLElement): ActionEntry[] =>
    issueMenuEntries(child, {
      presentation: "sub-issue",
      close: () => setRowMenu(null),
      openDialog: (kind) => {
        setRowMenu(null);
        if (kind === "reminder") {
          ui.send({ type: "overlay.open", overlay: "reminder", target: child.key });
          return;
        }
        setRowDialog({
          kind: kind === "relations" ? "relation" : kind,
          key: child.key,
        });
      },
    });
  return (
    <section
      ref={section}
      data-sub-issues={issue.key}
      aria-label="Sub-issues"
      className="mt-[14px] text-[13px]"
    >
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
          <SubIssueRow key={child.key} child={child} depth={depth} contextOnly={contextOnly}
            index={index} rows={model.rows} display={display} boards={boards} board={board}
            progress={progress.get(child.key)} active={rowMenu?.key === child.key}
            openMenu={(anchor, point) => setRowMenu({ anchor, key: child.key, point })} />
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
            {draftControl(
              "status",
              `Sub-issue status. ${statusById(board, draft.status)?.name ?? "Todo"} is selected`,
              <StatusIcon
                status={
                  statusById(board, draft.status) ?? {
                    name: "Todo",
                    category: "new",
                  }
                }
              />,
            )}
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
          <InlineEditor
            key={editor}
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
            {(["priority", "assignee", "labels"] as const).map((field) =>
              draftControl(
                field,
                field === "priority"
                  ? `Sub-issue priority. ${draft.priority ?? noPriority} is selected`
                  : field === "assignee"
                    ? `Sub-issue assignee. ${draft.assignee?.name ?? "Unassigned"}`
                    : `Sub-issue labels. ${draft.labels?.join(", ") || "No labels"}`,
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
                </span>,
              ),
            )}
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
          ) : rowDialog.kind === "link" || rowDialog.kind === "pull-request" ? (
            <ResourceForm issue={child} kind={rowDialog.kind} close={done} />
          ) : rowDialog.kind === "reminder" ||
            rowDialog.kind === "history" ||
            rowDialog.kind === "relations" ? null : (
            <PropertyPicker issue={child} field={rowDialog.kind} close={done} />
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
              onChange={(e) =>
                change({
                  ordering: e.target.value as SubIssueDisplay["ordering"],
                })
              }
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
                change({
                  completed: e.target.value as SubIssueDisplay["completed"],
                })
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

function SubIssueRow({ child, depth, contextOnly, index, rows, display, boards, board, progress, active, openMenu }: {
  child: Issue; depth: number; contextOnly: boolean; index: number; rows: { depth: number }[];
  display: SubIssueDisplay; boards: Boards; board: Board; progress?: [number, number]; active: boolean;
  openMenu: (anchor: HTMLElement, point: { x: number; y: number }) => void;
}) {
  const status = (child: Issue) => statusOf(boards, child);
  const control = (child: Issue, field: Field, content: React.ReactNode) => (
    <PropertyControl
      field={field}
      board={boards.find((b) => b.id === child.board) ?? board}
      value={child}
      onChange={(patch) => {
        if (patch.status) actions.status(child.key, patch.status);
        else actions.patch(child.key, patch);
      }}
      title={
        field === "status"
          ? status(child).name
          : field === "priority"
            ? (child.priority ?? "No priority")
            : field === "assignee"
              ? (child.assignee?.name ?? "Unassigned")
              : child.labels.join(", ")
      }
      label={`Change ${field} for ${child.key}`}
      className={button}
    >
      {content}
    </PropertyControl>
  );
  const childURL = (child: Issue) => {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("board", String(child.board));
    url.searchParams.set("issue", child.key);
    url.searchParams.delete("document");
    return url.href;
  };

  return (          <div
            key={child.key}
            data-sub-issue={child.key}
            data-depth={depth}
            data-context-only={contextOnly || undefined}
            className={`relative -ml-1.5 flex min-h-9 items-center gap-px rounded-lg pr-1 hover:bg-hover ${active ? "bg-hover" : ""}`}
            style={{ paddingLeft: 31 + depth * 24 }}
            onContextMenu={(event) => {
              event.preventDefault();
              openMenu(event.currentTarget, { x: event.clientX + 3, y: event.clientY });
            }}
          >
            {Array.from({ length: depth }, (_, level) => {
              level++;
              const left = level * 24 + 21.5,
                more = continues(
                  rows,
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
              {progress && (
                <span
                  data-row-progress
                  className="flex h-6 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-line-2 px-2 text-[12px] font-[450] text-fg-3"
                >
                  <ProgressRing value={progress![0] / progress![1]} />
                  {progress!.join("/")}
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
          </div>);
}
