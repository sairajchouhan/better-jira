import { EntityIdentifier } from "@/client/components/entity-identifier";
import { COMPOSER_TITLE, focusEditorAt, titleKeyDown } from "@/client/features/editor/title-flow";
import { type Issue } from "@/shared/issue-model";
import { Text } from "@/client/components/text";
import { SubIssueProgressButton } from "@/client/components/sub-issue-progress-button";
import "./issue-header.css";
import { LinkBadges, PullRequestBadge } from "./card-badges";
import { Dialog, ConfirmDialog } from "@/client/components/dialog";
import { TextInput } from "@/client/components/field";
import { Button, IconButton } from "@/client/components/button";
import { SectionDisclosure } from "@/client/components/section-disclosure";
/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
import { Fragment, useMemo, useRef, useState, type ReactNode } from "react";
import { useSubIssueComposer } from "./use-sub-issue-composer";
import { useStoredState } from "@/client/state/stored-state";
import { FieldMenuButton } from "@/client/components/pill-select";
import { DisplayProperties, SelectRow, Toggle, ViewOptions } from "@/client/components/display-options";
import {
  DueIcon,
  RelationIcon,
  Icon,
  PriorityIcon,
  ProgressRing,
  StatusIcon,
} from "@/client/components/icons";
import { ChildrenMenu } from "./sub-issue-menu";
import {
  StatusMenu,
  PriorityMenu,
  AssigneeMenu,
  LabelsMenu,
  DueMenu,
} from "./property-menu";
import { issueMenuEntries, moveMenu } from "./issue-menu";
import { InlineEditor } from "@/client/features/editor/rich-editor-loader";
import { useCommand } from "@/client/features/navigation/commands";
import { get, useStore } from "@/client/state/store";
import { actions } from "@/client/state/issue-actions";
import { ui } from "@/client/features/navigation/app-navigation";
import { AppLink } from "@/client/features/navigation/app-link";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Avatar } from "@/client/components/avatar";
import { statusById } from "@/shared/board-catalog";
import { PropertyPicker, type IssueField } from "./personal-controls";
import { ResourceForm } from "./issue-resources";
import { shortDate } from "@/client/lib/due-date";
import { fullTime } from "./issue-dates";
import { hotkeyOf } from "@/client/features/navigation/shortcuts";
import { shortcutTitle } from "@/client/components/keycap";
import { canHaveSubIssues } from "@/shared/issue-properties";
import { titleParentOf, type TitleLineVariant } from "@/shared/epics";
import {
  defaultSubIssueDisplay,
  PARENT_LINE,
  statusOf,
  subIssueCount,
  SUB_ISSUE_ORDERINGS as orderings,
  SUB_ISSUE_PROPERTIES as properties,
  movedOrder,
  subIssueRows,
  type SubIssueCount,
  type SubIssueDisplay,
  type SubIssueMove,
  withMoveEntry,
} from "./sub-issue-model";

const COMPLETED = [
  ["all", "All"],
  ["day", "Past day"],
  ["week", "Past week"],
  ["month", "Past month"],
  ["none", "None"],
] as const;
// Compact composer/row property geometry has no variant in the primitive contract.
const button = "rounded px-2 py-1 text-fg-3 hover:bg-(--control-tertiary-hover)";
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

/** The line under an issue's title (BJ-289): the issue `titleParentOf` names, in its variant. A parent Task reads Linear's
 *  "Sub-issue of"; an epic reads "In epic", as an issue in an epic is not a sub-issue (the user's deviation from Linear). */
export function TitleParentLine({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues);
  const target = titleParentOf(issue, (key) => all.get(key));
  const parent = target && all.get(target.key);
  if (!target || !parent) return null;
  return <ParentLine variant={target.variant} issue={issue} parent={parent} />;
}

/** One line for both variants: the variant's label (PARENT_LINE), the parent link, and a progress pill whose menu lists the
 *  parent's issues (⌘⇧→). Only the words differ. */
function ParentLine({ variant, issue, parent }: { variant: TitleLineVariant; issue: Issue; parent: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards),
    [menu, setMenu] = useState<HTMLElement | null>(null),
    progress = useRef<HTMLButtonElement>(null);
  useCommand("open-parent-sub-issues", (key) => {
    if (key !== issue.key || !progress.current) return;
    setMenu(progress.current);
    return true;
  });
  const words = PARENT_LINE[variant],
    open = words.open(parent.key),
    // Every level below, as the parent's Sub-issues section header counts (cached per snapshot, BJ-281).
    count = subIssueCount(all, boards, parent.key, "descendants");
  return (
    <Text
      className="issue-parent-line"
      as="div"
      variant="small"
      color="inherit"
    >
      <span className="shrink-0 font-[450] text-fg-3">{words.label}</span>
      {/* Text has no anchor variant; preserve link semantics and keyboard navigation. */}
      <AppLink
        data-parent-link
        className="issue-parent-link"
        to={{ board: parent.board, selected: parent.key, panel: true }}
      >
        <span className="grid size-3.5 shrink-0 place-items-center">
          <StatusIcon status={statusOf(boards, parent)} />
        </span>
        <EntityIdentifier className="shrink-0 font-[450] text-fg-3">{parent.key}</EntityIdentifier>
        <span className="truncate font-medium text-fg">{parent.summary}</span>
      </AppLink>
      <SubIssueProgressButton
        ref={progress}
        data-parent-progress
        title={shortcutTitle(open, hotkeyOf("sub-issues-of-parent"))}
        aria-label={open}
        onClick={(event) => setMenu(event.currentTarget)}
        variant="header"
        completed={count?.done ?? 0}
        total={count?.total ?? 0}
        aria-expanded={!!menu}
      />
      {menu && (
        <ChildrenMenu parent={parent} current={issue.key} anchor={menu} close={() => setMenu(null)} />
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
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  const [reveal, setReveal] = useState(false),
    [settings, setSettings] = useState(false),
    [rowMenu, setRowMenu] = useState<{
      anchor: HTMLElement;
      key: string;
      point?: { x: number; y: number };
    } | null>(null);

  const board = boards.find((b) => b.id === issue.board)!;
  const {
    state: { title, description, files, draft, editor, creating, confirming },
    actions: { update, setProperties, addFiles, onLateMedia, start, discard, cancel, submit, setConfirming },
    meta: { form, titleInput, scope, onClickCapture },
  } = useSubIssueComposer(issue, board, namespace, setCollapsed);
  const status = (child: Issue) => statusOf(boards, child);
  const [manualOrder, setManualOrder] = useStoredState<string[]>(`${namespace}:manual-order:v1:${issue.key}`, raw => Array.isArray(raw) ? raw.filter((key): key is string => typeof key === "string") : [], []);
  const model = useMemo(
    () => subIssueRows(issue.key, all, display, status, Date.now(), reveal, manualOrder),
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft listeners retain their session; derived rows invalidate on boards rather than render-local status helpers.
    [issue.key, all, boards, display, reveal, manualOrder],
  );
  const manual = display.ordering === "manual";
  /** The visible siblings under `child`'s parent, in the order shown. */
  const siblingsOf = (child: Issue) =>
    model.rows.filter((row) => row.issue.parent === child.parent).map((row) => row.issue.key);
  // Linear's Move… for a manually ordered sub-issue list (startup-root Ivr); the order stays local (BJ-50).
  const moveChild = (key: string, move: SubIssueMove) => {
    const child = get().issues.get(key);
    if (!manual || !child) return false;
    const siblings = siblingsOf(child),
      next = movedOrder(siblings, key, move);
    if (next) setManualOrder([...manualOrder.filter((k) => !siblings.includes(k)), ...next]);
    return true;
  };
  // ⌥↑ / ⌥↓ / ⌥⇧↑ / ⌥⇧↓ on the hovered row (R3-relations-D4).
  useCommand("reorder-sub-issue", ({ key, move }) =>
    model.rows.some((row) => row.issue.key === key) && moveChild(key, move) ? true : undefined,
  );
  const moveEntry = (child: Issue): ActionEntry | undefined => {
    const siblings = siblingsOf(child),
      at = siblings.indexOf(child.key);
    if (!manual || siblings.length < 2) return;
    const step = (name: string, move: Exclude<SubIssueMove, { to: number }>, icon: "arrow-up" | "arrow-down"): ActionEntry => ({
      name,
      icon,
      shortcut: hotkeyOf(`reorder-${move}`),
      run: () => {
        setRowMenu(null);
        moveChild(child.key, move);
      },
    });
    // Linear's applicability: up moves exist below the top, down moves above the bottom.
    return moveMenu([
      ...(at > 0 ? [step("Move to top", "top", "arrow-up"), step("Move up", "up", "arrow-up")] : []),
      ...(at < siblings.length - 1
        ? [step("Move down", "down", "arrow-down"), step("Move to bottom", "bottom", "arrow-down")]
        : []),
    ]);
  };
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
  const rowEntries = (child: Issue, _anchor: HTMLElement): ActionEntry[] => {
    const entries = issueMenuEntries(child, {
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
    const move = moveEntry(child);
    return move ? withMoveEntry(entries, move) : entries;
  };
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
            ref={settingsTrigger}
            label="Sub-issue display options"
            aria-expanded={settings}
            onClick={() => setSettings(!settings)}
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
            progress={subIssueCount(all, boards, child.key, "children")}
            onDrop={
              manual
                ? (dragged, after) => {
                    const source = get().issues.get(dragged);
                    if (!source || source.parent !== child.parent || dragged === child.key) return;
                    const rest = siblingsOf(child).filter((k) => k !== dragged);
                    moveChild(dragged, { to: rest.indexOf(child.key) + (after ? 1 : 0) });
                  }
                : undefined
            }
            active={rowMenu?.key === child.key}
            openMenu={(anchor, point) =>
              setRowMenu({ anchor, key: child.key, point })
            }
          />
        ))}
      {!model.total && !creating && canHaveSubIssues(get(), issue) && (
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
          onClickCapture={onClickCapture}
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
              onKeyDown={titleKeyDown(COMPOSER_TITLE, (at) =>
                focusEditorAt(document.getElementById(`sub-issue-description-${issue.key}`), at),
              )}
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
            previousInput={{ element: () => titleInput.current, arrows: COMPOSER_TITLE.arrows }}
            attachments={files}
            onFiles={addFiles}
            onChange={(description) => update({ description })}
            onSave={submit}
            saveLabel="Create"
            hint={{ save: "create", cancel: "close" }}
            onCancel={cancel}
          />
          <div className="flex gap-1">
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue due date. ${draft.due ?? "No due date"}`}
              menu={DueMenu}
              menuProps={{ board, value: draft.due ?? null, onChange: (due) => setProperties({ due }) }}
            >
              {draft.due ?? "Due date"}
            </FieldMenuButton>
            {/* Linear names the value on each chip: "Priority", the assignee, "Labels". */}
            <FieldMenuButton
              className={button}
              aria-label={`Sub-issue priority. ${draft.priority ?? noPriority} is selected`}
              menu={PriorityMenu}
              menuProps={{
                board,
                value: draft.priority ?? "",
                empty: noPriority,
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
        <ViewOptions.Popover
          label="Sub-issue display options"
          trigger={settingsTrigger}
          close={() => setSettings(false)}
        >
          <ViewOptions.Content>
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
          </ViewOptions.Content>
        </ViewOptions.Popover>
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
        <Dialog.Body>
          <TextInput
            autoFocus
            aria-label="Issue title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full"
          />
        </Dialog.Body>
      </form>
    </Dialog>
  );
}
const SUB_ISSUE_DRAG = "application/x-better-jira-sub-issue";
const continues = (rows: { depth: number }[], index: number, level: number) => {
  for (const row of rows.slice(index + 1))
    if (row.depth <= level) return row.depth === level;
  return false;
};

function SubIssueRow({
  child,
  onDrop,
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
  /** Manual ordering: a sub-issue dragged onto this row lands before it, or `after` it. */
  onDrop?: (dragged: string, after: boolean) => void;
  depth: number;
  contextOnly: boolean;
  index: number;
  rows: { depth: number }[];
  display: SubIssueDisplay;
  boards: Boards;
  progress?: SubIssueCount;
  active: boolean;
  openMenu: (anchor: HTMLElement, point: { x: number; y: number }) => void;
}) {
  const [childrenMenu, setChildrenMenu] = useState<HTMLElement | null>(null);
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

  return (
    <div
      key={child.key}
      data-sub-issue={child.key}
      data-depth={depth}
      data-context-only={contextOnly || undefined}
      className={`group relative -ml-1.5 flex min-h-9 items-center gap-px rounded-lg pr-1 hover:bg-(--row-hover) ${active ? "bg-(--row-hover)" : ""}`}
      style={{ paddingLeft: 31 + depth * 24 }}
      // Linear drags a manually ordered sub-issue to its new place (R3-relations-D4).
      draggable={!!onDrop}
      onDragStart={onDrop && ((event) => {
        event.dataTransfer.setData(SUB_ISSUE_DRAG, child.key);
        event.dataTransfer.effectAllowed = "move";
      })}
      onDragOver={onDrop && ((event) => {
        if (event.dataTransfer.types.includes(SUB_ISSUE_DRAG)) event.preventDefault();
      })}
      onDrop={onDrop && ((event) => {
        const dragged = event.dataTransfer.getData(SUB_ISSUE_DRAG);
        if (!dragged) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        onDrop(dragged, event.clientY > box.top + box.height / 2);
      })}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu(event.currentTarget, {
          x: event.clientX,
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
        <EntityIdentifier className="px-1 text-fg-3">{child.key}</EntityIdentifier>
      )}
      {/* Text has no anchor variant; preserve the native issue link. */}
      <AppLink
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-[13px] font-medium text-fg"
        to={{ board: child.board, selected: child.key, panel: true, view: get().view }}
      >
        <span className="truncate">{child.summary}</span>
      </AppLink>
      {progress && <SubIssueProgressButton data-row-progress variant="row" completed={progress.done} total={progress.total} aria-label={`Open sub-issues of ${child.key}`} aria-expanded={!!childrenMenu} onClick={e => setChildrenMenu(e.currentTarget)} />}
      {childrenMenu && <ChildrenMenu parent={child} anchor={childrenMenu} close={() => setChildrenMenu(null)} />}

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
      {display.properties.includes("due") && child.due && <SubIssueDue issue={child} />}
      {/* Linear's sub-issue rows are its list rows: the same pull request (`mhn`, layout list) and link (`mt`) badges, in its order. */}
      {display.properties.includes("pullRequests") && !!child.prCount && <PullRequestBadge issue={child} layout="list" />}
      {display.properties.includes("links") && <LinkBadges issue={child} />}
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

/** A sub-issue row's due date: Linear's list rows lead it with the due icon, orange within a week and red on the day and after.
 *  Like Linear's due badge (`UJn`, startup-root: an action badge running `oK`), a click opens the due date picker, through
 *  PropertyPicker as every other row control. */
export function SubIssueDue({ issue }: { issue: Issue }) {
  return (
    <FieldMenuButton
      className={`flex shrink-0 items-center gap-1 ${button}`}
      title={`Due ${fullTime(`${issue.due}T00:00:00`)}`}
      aria-label={`Change due for ${issue.key}`}
      menu={PropertyPicker}
      menuProps={{ issue, field: "due" }}
    >
      <DueIcon due={issue.due!} resolved={issue.resolved} />
      <time dateTime={issue.due!}>{shortDate(issue.due!, undefined, true)}</time>
    </FieldMenuButton>
  );
}
