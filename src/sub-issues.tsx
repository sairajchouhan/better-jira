import { Text } from "./text";
import { PropertyTrigger } from "./property-trigger";
import { LabelChip } from "./label-chip";
import { CountBadge } from "./count-badge";
import { Dialog, ConfirmDialog } from "./dialog";
import { TextInput } from "./field";
import { Button, IconButton } from "./button";
import { SectionDisclosure } from "./section-disclosure";
/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useSubIssueComposer } from "./use-sub-issue-composer";
import { useStoredState } from "./stored-state";
import { FieldMenuButton } from "./pill-select";
import { DisplayProperties, SelectRow, Toggle } from "./display-options";
import {
  RelationIcon,
  Icon,
  PriorityIcon,
  ProgressRing,
  StatusIcon,
} from "./icons";
import { MenuSurface } from "./menu-surface";
import { Menu } from "./menu";
import {
  StatusMenu,
  PriorityMenu,
  AssigneeMenu,
  LabelsMenu,
} from "./property-menu";
import { issueMenuEntries } from "./issue-menu";
import { InlineEditor } from "./rich-editor-loader";
import { useCommand } from "./commands";
import {
  actions,
  get,
  issueURL,
  navigate,
  ui,
  useStore,
  type Issue,
} from "./store";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Avatar } from "./avatar";
import { statusById } from "./board-catalog";
import { PropertyPicker, type IssueField } from "./personal-controls";
import { ResourceForm } from "./issue-resources";
import { shortDate } from "./due-date";
import { hotkeyOf } from "./shortcuts";
import { shortcutTitle } from "./keycap";
import { canHaveChildren } from "./issue-properties";
import { type Property } from "./view-model";
import {
  childrenByParent,
  defaultSubIssueDisplay,
  subIssueRows,
  type SubIssueDisplay,
} from "./sub-issue-model";

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
const COMPLETED = [
  ["all", "All"],
  ["day", "Past day"],
  ["week", "Past week"],
  ["month", "Past month"],
  ["none", "None"],
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
// Compact composer/row property geometry has no variant in the primitive contract.
const button = "rounded px-2 py-1 text-fg-3 hover:bg-hover";
function parseDisplay(value: unknown): SubIssueDisplay {
  const base = defaultSubIssueDisplay();
  if (!value || typeof value !== "object") return base;
  const source = value as Partial<SubIssueDisplay>;
  return {
    ...base,
    ...(orderings.some(([id]) => id === source.ordering)
      ? { ordering: source.ordering }
      : {}),
    ...(["all", "day", "week", "month", "none"].includes(source.completed ?? "")
      ? { completed: source.completed }
      : {}),
    ...(typeof source.nested === "boolean" ? { nested: source.nested } : {}),
    ...(Array.isArray(source.properties)
      ? {
          properties: source.properties.filter((p) =>
            properties.some(([id]) => id === p),
          ),
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
    order: columns.findIndex((c) =>
      c.statuses.some((s) => s.id === child.status),
    ),
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
  useCommand("open-parent-sub-issues", (key) => {
    if (key !== issue.key || !progress.current) return;
    setMenu(progress.current);
    return true;
  });
  const parent = issue.parent ? all.get(issue.parent) : undefined;
  if (!parent) return null;
  const status = (i: Issue) => statusOf(boards, i),
    model = subIssueRows(parent.key, all, defaultSubIssueDisplay(), status),
    siblings = model.rows
      .filter((row) => row.depth === 0)
      .map((row) => row.issue);
  return (
    <Text
      className="mt-2 mb-2.5 flex h-[26px] items-center leading-[normal]"
      as="div"
      variant="small"
      color="inherit"
    >
      <span className="mr-0.5 font-[450] text-fg-3">Sub-issue of</span>
      {/* Text has no anchor variant; preserve link semantics and keyboard navigation. */}
      <a
        data-parent-link
        className="flex h-[26px] min-w-0 items-center gap-1 rounded-lg border border-transparent px-1 hover:bg-hover"
        href={issueURL(parent)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
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
      <PropertyTrigger
        ref={progress}
        data-parent-progress
        title={shortcutTitle(`Open sub-issues of ${parent.key}`, hotkeyOf("sub-issues-of-parent"))}
        aria-label={`Open sub-issues of ${parent.key}`}
        onClick={(event) => setMenu(event.currentTarget)}
        variant="row"
        state="value"
        aria-expanded={!!menu}
        className="ml-1 shrink-0"
      >
        <ProgressRing value={model.total ? model.completed / model.total : 0} />
        {model.completed}/{model.total}
      </PropertyTrigger>
      {menu && (
        <MenuSurface
          label={`Open sub-issues of ${parent.key}`}
          anchor={menu}
          close={() => setMenu(null)}
          fit
        >
          <Menu style={{ width: 347 }}>
            <Menu.Input
              hideWhenEmpty
              autoFocus
              aria-label={`Open sub-issues of ${parent.key}…`}
            />
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
                    <span className="mr-2 text-[var(--menu-fg-3)]">
                      {child.key}
                    </span>
                    {child.summary}
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Menu.List>
          </Menu>
        </MenuSurface>
      )}
    </Text>
  );
}

export function SubIssues({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    namespace = useStore((s) => s.namespace),
    writable = useStore((s) => s.writable);
  const noPriority = writable ? "Default priority" : "No priority";
  const storageKey = `better-jira:sub-issues:v1:${namespace}`;
  const [display, setDisplay] = useStoredState(
    storageKey,
    parseDisplay,
    defaultSubIssueDisplay(),
    "Could not save sub-issue display settings",
  );
  const [rowDialog, setRowDialog] = useState<{
    kind: "rename" | "link" | "pull-request" | IssueField;
    key: string;
  } | null>(null);
  // Linear keeps each issue's section collapsed across reloads.
  const collapseKey = `better-jira:sub-issues-collapsed:v1:${namespace}:${issue.key}`;
  const [collapsed, setCollapsed] = useStoredState(
    collapseKey,
    (raw) => raw === 1 || raw === true,
    false,
  );
  const [reveal, setReveal] = useState(false),
    [settings, setSettings] = useState<HTMLElement | null>(null),
    [rowMenu, setRowMenu] = useState<{
      anchor: HTMLElement;
      key: string;
      point?: { x: number; y: number };
    } | null>(null);

  const board = boards.find((b) => b.id === issue.board)!;
  const {
    state: { title, description, files, draft, editor, creating, confirming },
    actions: { update, setProperties, addFiles, onLateMedia, start, discard, cancel, submit, setConfirming },
    meta: { form, titleInput, scope },
  } = useSubIssueComposer(issue, board, namespace, setCollapsed);
  const status = (child: Issue) => statusOf(boards, child);
  // Direct children per row, for Linear's "0/2" progress pill.
  const progress = useMemo(() => {
    const counts = new Map<string, [number, number]>();
    for (const [parent, children] of childrenByParent(all)) {
      counts.set(parent, [
        children.filter((i) => status(i).category === "done").length,
        children.length,
      ]);
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
    if (
      (patch.completed !== undefined &&
        patch.completed !== display.completed) ||
      (patch.nested !== undefined && patch.nested !== display.nested)
    )
      setReveal(false);
    setDisplay({ ...display, ...patch });
  };
  const section = useRef<HTMLElement>(null);
  // ⌘⇧O does what this section's create button does, while it shows one.
  useCommand("create-sub-issue", (key) => {
    const button = section.current?.querySelector<HTMLElement>(
      "[data-create-child]",
    );
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
  const rowEntries = (child: Issue, _anchor: HTMLElement): ActionEntry[] =>
    issueMenuEntries(child, {
      presentation: "sub-issue",
      close: () => setRowMenu(null),
      openDialog: (kind) => {
        setRowMenu(null);
        if (kind === "reminder") {
          ui.send({
            type: "overlay.open",
            overlay: "reminder",
            target: child.key,
          });
          return;
        }
        // The sub-issue menu has no "Show description history" entry.
        if (kind !== "history") setRowDialog({ kind, key: child.key });
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
          <SectionDisclosure label="Sub-issues" expanded={!collapsed} onToggle={() => setCollapsed(!collapsed)} />
          <Text
            data-sub-progress
            className="ml-0.5 flex items-center gap-1.5"
            as="span"
            variant="mini"
            color="muted"
          >
            <ProgressRing value={model.completed / model.total} />
            {model.completed}/{model.total}
          </Text>
          <span className="flex-1" />
          {model.hiddenCompleted > 0 && (
            <Button
              onClick={() => setReveal(!reveal)}
              variant="borderless"
              size="small"
            >
              {reveal ? "Hide" : "Show"} {model.hiddenCompleted} completed
            </Button>
          )}
          <IconButton
            label="Sub-issue display options"
            onClick={(e) => setSettings(e.currentTarget)}
            variant="borderless"
            size="medium"
          >
            <Icon name="display" size={14} />
          </IconButton>
          <IconButton
            data-create-child
            label="Create new sub-issue"
            onClick={start}
            variant="borderless"
            size="medium"
          >
            <Icon name="plus" size={14} />
          </IconButton>
        </div>
      )}
      {!collapsed &&
        model.rows.map(({ issue: child, depth, contextOnly }, index) => (
          <SubIssueRow
            key={child.key}
            child={child}
            depth={depth}
            contextOnly={contextOnly}
            index={index}
            rows={model.rows}
            display={display}
            boards={boards}
            progress={progress.get(child.key)}
            active={rowMenu?.key === child.key}
            openMenu={(anchor, point) =>
              setRowMenu({ anchor, key: child.key, point })
            }
          />
        ))}
      {!model.total && !creating && canHaveChildren(get(), issue) && (
        <Button
          data-create-child
          aria-label="Add sub-issues"
          onClick={start}
          variant="borderless"
          size="small"
        >
          + Add sub-issues
        </Button>
      )}
      {creating && (
        <div
          ref={form}
          tabIndex={-1}
          aria-label="Create sub-issue"
          className="sub-issue-composer outline-none mt-3 rounded-lg border border-line-2 bg-card p-3"
        >
          <div className="flex items-center gap-2">
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue status. ${statusById(board, draft.status)?.name ?? "Todo"} is selected`}
              menu={StatusMenu}
              menuProps={{
                board,
                value: draft.status ?? "",
                onChange: (status) => setProperties({ status }),
              }}
            >
              <StatusIcon
                status={
                  statusById(board, draft.status) ?? {
                    name: "Todo",
                    category: "new",
                  }
                }
              />
            </FieldMenuButton>
            <TextInput
              ref={titleInput}
              autoFocus
              aria-label="Sub-issue title"
              placeholder="Issue title"
              value={title}
              onChange={(e) => update({ title: e.target.value })}
              className="min-w-0 flex-1"
            />
          </div>
          <InlineEditor
            key={editor}
            id={`sub-issue-description-${issue.key}`}
            mentionIssue={issue.key}
            scope={scope}
            onLateMedia={onLateMedia}
            initial={description}
            label="Sub-issue description"
            placeholder="Add description…"
            attachments={files}
            onFiles={addFiles}
            onChange={(description) => update({ description })}
            onSave={submit}
            saveLabel="Create"
            hint={{ save: "create", cancel: "close" }}
            onCancel={cancel}
          />
          <div className="flex gap-1">
            {/* Linear names the value on each chip: "Priority", the assignee, "Labels". */}
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue priority. ${draft.priority ?? noPriority} is selected`}
              menu={PriorityMenu}
              menuProps={{
                board,
                value: draft.priority ?? "",
                empty: noPriority,
                clearable: true,
                onChange: (priority) => setProperties({ priority: priority || undefined }),
              }}
            >
              <span className="flex items-center gap-1.5">
                <PriorityIcon name={draft.priority} />
                {draft.priority ?? "Priority"}
              </span>
            </FieldMenuButton>
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue assignee. ${draft.assignee?.name ?? "Unassigned"}`}
              menu={AssigneeMenu}
              menuProps={{
                board,
                value: draft.assignee ?? null,
                onChange: (assignee) => setProperties({ assignee }),
              }}
            >
              <span className="flex items-center gap-1.5">
                <Icon name="user" size={14} />
                {draft.assignee?.name ?? "Assignee"}
              </span>
            </FieldMenuButton>
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue labels. ${draft.labels?.join(", ") || "No labels"}`}
              menu={LabelsMenu}
              menuProps={{
                board,
                value: draft.labels ?? [],
                onChange: (labels) => setProperties({ labels }),
              }}
            >
              <span className="flex items-center gap-1.5">
                <Icon name="label" size={14} />
                {draft.labels?.length ? draft.labels.join(", ") : "Labels"}
              </span>
            </FieldMenuButton>
          </div>
        </div>
      )}
      {rowDialog &&
        all.get(rowDialog.key) &&
        (() => {
          const child = all.get(rowDialog.key)!,
            done = () => setRowDialog(null);
          return rowDialog.kind === "rename" ? (
            <RenameIssue issue={child} close={done} />
          ) : rowDialog.kind === "link" || rowDialog.kind === "pull-request" ? (
            <ResourceForm issue={child} kind={rowDialog.kind} close={done} />
          ) : (
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
        <ConfirmDialog
          title="Discard this draft?"
          description="Confirm that you want to discard this draft."
          confirmLabel="Discard"
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
          <SelectRow
            label="Ordering"
            value={display.ordering}
            options={orderings}
            onChange={(ordering) => change({ ordering: ordering as SubIssueDisplay["ordering"] })}
          />
          <SelectRow
            label="Completed issues"
            value={display.completed}
            options={COMPLETED}
            onChange={(completed) => change({ completed: completed as SubIssueDisplay["completed"] })}
          />
          <Toggle
            label="Nested sub-issues"
            value={display.nested}
            onChange={() => change({ nested: !display.nested })}
          />
          <DisplayProperties
            properties={properties}
            shown={display.properties}
            onChange={(properties) => change({ properties })}
          />
        </MenuSurface>
      )}
    </section>
  );
}

/** Linear's Rename… from a sub-issue row: the title in a small dialog, Enter saves. */
function RenameIssue({ issue, close }: { issue: Issue; close: () => void }) {
  const [title, setTitle] = useState(issue.summary);
  return (
    <Dialog label="Rename issue" close={close} width={420}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim() && title.trim() !== issue.summary)
            actions.summary(issue.key, title.trim());
          close();
        }}
      >
        <TextInput
          autoFocus
          aria-label="Issue title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          className="w-full"
        />
      </form>
    </Dialog>
  );
}
const continues = (rows: { depth: number }[], index: number, level: number) => {
  for (const row of rows.slice(index + 1))
    if (row.depth <= level) return row.depth === level;
  return false;
};

function SubIssueRow({
  child,
  depth,
  contextOnly,
  index,
  rows,
  display,
  boards,
  progress,
  active,
  openMenu,
}: {
  child: Issue;
  depth: number;
  contextOnly: boolean;
  index: number;
  rows: { depth: number }[];
  display: SubIssueDisplay;
  boards: Boards;
  progress?: [number, number];
  active: boolean;
  openMenu: (anchor: HTMLElement, point: { x: number; y: number }) => void;
}) {
  const status = (child: Issue) => statusOf(boards, child);
  // Rows pick through PropertyPicker, the one field→write path every issue picker shares.
  const control = (field: IssueField, title: string, content: ReactNode) => (
    <FieldMenuButton
      className={button}
      title={title}
      aria-label={`Change ${field} for ${child.key}`}
      menu={PropertyPicker}
      menuProps={{ issue: child, field }}
    >
      {content}
    </FieldMenuButton>
  );
  const childURL = (child: Issue) => {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("board", String(child.board));
    url.searchParams.set("issue", child.key);
    url.searchParams.delete("document");
    return url.href;
  };

  return (
    <div
      key={child.key}
      data-sub-issue={child.key}
      data-depth={depth}
      data-context-only={contextOnly || undefined}
      className={`relative -ml-1.5 flex min-h-9 items-center gap-px rounded-lg pr-1 hover:bg-hover ${active ? "bg-hover" : ""}`}
      style={{ paddingLeft: 31 + depth * 24 }}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.currentTarget, {
          x: event.clientX + 3,
          y: event.clientY,
        });
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
        control("status", status(child).name, <StatusIcon status={status(child)} />)}
      {display.properties.includes("priority") &&
        control(
          "priority",
          child.priority ?? "No priority",
          <PriorityIcon name={child.priority} />,
        )}
      {display.properties.includes("id") && (
        <span className="px-1 text-fg-3">{child.key}</span>
      )}
      {/* Text has no anchor variant; preserve the native issue link. */}
      <a
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-[13px] font-medium text-fg"
        href={childURL(child)}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
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
          <LabelChip size="compact" data-row-progress className="shrink-0">
            <LabelChip.Icon>
              <ProgressRing value={progress![0] / progress![1]} />
            </LabelChip.Icon>
            <LabelChip.Text>{progress!.join("/")}</LabelChip.Text>
          </LabelChip>
        )}
      </a>
      {/* Linear's row badges (RAJ-54 blocking 1, RAJ-55 blocked 1; Opus review 4): a red relation icon and how many issues. */}
      {(["blocking", "blocked"] as const).map((kind) => {
        const count =
          child.relations?.filter((r) => r.kind === kind).length ?? 0;
        return (
          count > 0 && (
            <Text
              key={kind}
              data-row-relation={kind}
              title={`${kind === "blocked" ? "Blocked by" : "Blocking"} ${count} ${count === 1 ? "issue" : "issues"}`}
              className="flex shrink-0 items-center gap-1"
              as="span"
              variant="mini"
              color="muted"
            >
              <RelationIcon kind={kind} />
              {count}
            </Text>
          )
        );
      })}
      {display.properties.includes("labels") &&
        control(
          "labels",
          child.labels.join(", "),
          child.labels.join(", ") || <Icon name="label" size={13} />,
        )}
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
        <span title="Links">
          <CountBadge>{child.links.length}</CountBadge>
        </span>
      )}
      {display.properties.includes("pullRequests") && !!child.prCount && (
        <span title="Pull requests">
          <CountBadge>{child.prCount}</CountBadge>
        </span>
      )}
      {display.properties.includes("assignee") &&
        control(
          "assignee",
          child.assignee?.name ?? "Unassigned",
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
  );
}
