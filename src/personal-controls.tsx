/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { SubIssues, statusOf } from "./sub-issues";
import { attachmentSplit } from "./issue-attachments";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { Adf } from "./adf";
import { FramedEditor } from "./rich-editor-loader";
import { MediaView } from "./media-loader";
import { normalizeDocument } from "./document";
import { Icon, PriorityIcon, StatusIcon, TypeDot, hue, type IconName } from "./icons";
import {
  canHaveChildren,
  canParent,
  childTypes,
  matchRank,
  needsParent,
  typeChoices,
} from "./issue-properties";
import { Avatar } from "./avatar";
import { Menu } from "./menu";
import { PickerRow, PropertyMenu } from "./property-menu";
import {
  actions,
  addBoard,
  addLocalFiles,
  beginCreate,
  useAssignableUsers,
  boardOf,
  get,
  issueURL,
  isLocalIssue,
  hasLocalJiraChanges,
  ME,
  navigate,
  set,
  toggleFavorite,
  ui,
  useStore,
  type Board,
  type Issue,
  type IssueDraft,
  type JiraOptions,
  type User,
} from "./store";
import { RELATION_ISSUE } from "./issue-activity";
import {
  buckets,
  newId,
  priorityRank,
  type Display,
  type Field,
  type Grouping,
} from "./view-model";
import { knownLabels, statusById, statuses } from "./board-catalog";
import { setDisplay, setOnlyRule, updateRule, useViewSettings } from "./view-settings";

const INPUT =
  "w-full rounded-md border border-line-2 bg-card px-3 py-2 text-fg outline-none focus:border-accent";
const BUTTON = "rounded-md px-3 py-1.5 text-fg-2 hover:bg-hover disabled:opacity-40";

export { MenuSurface as Modal } from "./menu-surface";
import { MenuSurface as Modal, issueAnchor } from "./menu-surface";
import { lazy, Suspense } from "react";
const DateInput = lazy(() =>
  import("./date-input").then((module) => ({ default: module.DateInput })),
);
import { IssueResources, ResourceForm, createIssueDocument } from "./issue-resources";
import { ReactionPicker, shortcode } from "./reactions";
import { PillSelect } from "./pill-select";
import { canRunShortcut, shortcutLabel, runShortcut } from "./shortcuts";
import { copyIcons, copyKinds, copyShortcuts, issueCopy, type CopyKind } from "./issue-copy";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { kept, post, useCommand } from "./commands";
import { reminderPresets, reminderTime } from "./reminder-display";
import { duePresets, shortDate } from "./due-date";

/** Linear keeps an unsent title and description when the composer closes; the next C brings them back. */
const unsent = { title: "", description: normalizeDocument("") };
export function CreateIssue() {
  const board = useStore((s) => s.boards.find((b) => b.id === s.board))!;
  const all = useStore((s) => s.issues);
  const initial = useStore((s) => s.draft);
  const [draft, setDraft] = useState<IssueDraft>(initial);
  const [title, setTitle] = useState(initial.title ?? unsent.title);
  const [description, setDescription] = useState(() =>
    normalizeDocument(initial.descriptionDoc ?? unsent.description),
  );
  useEffect(() => {
    // A copy isn't a draft of your own: cancelling it leaves the next composer as it was.
    if (initial.copy) return;
    unsent.title = title;
    unsent.description = description;
  }, [title, description, initial.copy]);
  const [draftIndex, setDraftIndex] = useState(0);
  const [labels, setLabels] = useState(initial.labels?.join(", ") ?? "");
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState(get().createExpanded);
  useEffect(() => {
    set({ createExpanded: false });
  }, []);
  const [attachments, setAttachments] = useState<Issue["attachments"]>(initial.attachments ?? []);
  const [filesBusy, setFilesBusy] = useState(false);
  const [dateValid, setDateValid] = useState(true);
  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const issues = [...all.values()].filter((i) => i.board === board.id);
  const users = useAssignableUsers();
  const projects = [
    ...new Map(
      issues.flatMap((i) => (i.project ? [[i.project.key, i.project] as const] : [])),
    ).values(),
  ];
  const options = useStore((s) => s.options),
    writable = useStore((s) => s.writable);
  const priorities = [
    ...new Set([
      ...(writable ? [] : ["Normal"]),
      ...options.priorities.map((p) => p.name),
      ...issues.flatMap((i) => (i.priority ? [i.priority] : [])),
    ]),
  ];
  // Create related › Parent issue: only a type one level above the source's in Jira's hierarchy can be its parent (a Task's is an Epic).
  const source = draft.related?.kind === "parent" ? all.get(draft.related.key) : undefined,
    jiraTypes = options.types?.[draft.project?.key ?? projects[0]?.key ?? ""];
  const sourceLevel = jiraTypes?.find((t) => t.name === source?.type)?.hierarchyLevel;
  const parentTypes =
    source && sourceLevel !== undefined
      ? jiraTypes!.filter((t) => t.hierarchyLevel === sourceLevel + 1).map((t) => t.name)
      : undefined;
  const project = draft.project ?? projects[0],
    parentIssue = draft.parent ? all.get(draft.parent) : undefined;
  const noParentType =
    parentTypes?.length === 0
      ? `Jira has no issue type above ${source!.type}, so ${source!.key} can't have a parent.`
      : parentIssue && !canHaveChildren(get(), parentIssue)
        ? `Jira has no issue type below ${parentIssue.type}, so ${parentIssue.key} can't have sub-issues.`
        : "";
  // A sub-issue takes a type one level below its parent; any other new issue can't be a Subtask, which needs a parent.
  const types =
    parentTypes ??
    (parentIssue && childTypes(get(), parentIssue)) ??
    [...new Set(["Task", ...issues.flatMap((i) => (i.type ? [i.type] : []))])].filter(
      (type) => draft.parent || !needsParent(get(), { type, project }),
    );
  const type = draft.type && types.includes(draft.type) ? draft.type : (types[0] ?? "Task");
  const milestones = [
    ...new Map([
      ...(options.versions[draft.project?.key ?? projects[0]?.key ?? ""] ?? []).map(
        (m) => [m.id, m] as const,
      ),
      ...issues
        .filter((i) => i.project?.key === (draft.project?.key ?? projects[0]?.key))
        .flatMap((i) => (i.milestones ?? []).map((m) => [m.id, m] as const)),
    ]).values(),
  ];
  const close = () => ui.send({ type: "overlay.close" });
  // One id per draft, read from this render: a second submit before React re-renders (a double click) makes no second issue.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Memo invalidation follows draft identity or relation inputs; render-local helpers would invalidate every render.
  const submission = useMemo(() => crypto.randomUUID(), [draftIndex]);
  const submit = () => {
    if (!title.trim() || filesBusy || !dateValid || noParentType) return;
    const key = actions.create(
      title,
      {
        ...draft,
        submission,
        type,
        ...(draft.priority === "" ? { priority: undefined } : {}),
        descriptionDoc: description,
        attachments,
        labels: [
          ...new Set(
            labels
              .split(",")
              .map((l) => l.trim())
              .filter(Boolean),
          ),
        ],
      },
      more,
    );
    if (key) {
      unsent.title = "";
      unsent.description = normalizeDocument("");
    }
    if (key && more) {
      setTitle("");
      setDescription(normalizeDocument(""));
      setDraftIndex((n) => n + 1);
      setAttachments([]);
      titleRef.current?.focus();
    }
  };
  useHotkey("Mod+Enter", () => submit(), { target: formRef, capture: true, ignoreInputs: false });
  return (
    <Modal
      label="Create issue"
      close={close}
      width={expanded ? Math.max(640, window.innerWidth - 48) : 640}
    >
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="mb-3 flex items-center gap-2 text-[12px] text-fg-3">
          <span className="flex-1 truncate">
            {board.name} › {initial.parent ? `Sub-issue of ${initial.parent}` : "New issue"}
          </span>
          <button
            type="button"
            aria-label={expanded ? "Collapse editor" : "Expand editor"}
            onClick={() => setExpanded(!expanded)}
            className={BUTTON}
          >
            <Icon name="expand" />
          </button>
          <button type="button" aria-label="Close" onClick={close} className={BUTTON}>
            <Icon name="close" />
          </button>
        </div>
        <input
          ref={titleRef}
          autoFocus
          aria-label="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              document.getElementById("create-description")?.focus();
            }
          }}
          placeholder="Issue title"
          className="mb-2 w-full bg-transparent py-1 text-[18px] font-medium text-fg outline-none"
        />
        <FramedEditor
          key={draftIndex}
          id="create-description"
          initial={description}
          onChange={setDescription}
          attachments={attachments}
          expanded={expanded}
          tabLeaves
        />
        <div className="flex flex-wrap gap-2">
          <PillSelect
            label="Issue type"
            value={type}
            options={types.map((t) => [t, t] as const)}
            onChange={(type) => setDraft({ ...draft, type })}
          />
          <PillSelect
            label="Status"
            value={draft.status ?? board.columns[0]?.statuses[0]?.id ?? ""}
            options={statuses(board).map((st) => [st.id, st.name] as const)}
            onChange={(status) => setDraft({ ...draft, status })}
          />
          <PillSelect
            label="Priority"
            value={draft.priority ?? (writable ? "" : "Normal")}
            options={[
              ["", writable ? "Default priority" : "No priority"],
              ...[...priorities]
                .sort((a, b) => priorityRank(a) - priorityRank(b))
                .map((p) => [p, p] as const),
            ]}
            onChange={(priority) => setDraft({ ...draft, priority })}
          />
          <PillSelect
            label="Assignee"
            value={draft.assignee?.id ?? ""}
            options={[["", "Unassigned"], ...users.map((u) => [u.id, u.name] as const)]}
            onChange={(id) =>
              setDraft({ ...draft, assignee: users.find((u) => u.id === id) ?? null })
            }
          />
          <PillSelect
            label="Project"
            value={draft.project === null && !writable ? "" : (project?.key ?? "")}
            // Every Jira issue needs a project.
            options={[
              ...(writable ? [] : [["", "No project"] as const]),
              ...projects.map((p) => [p.key, p.name] as const),
            ]}
            onChange={(key) =>
              setDraft({
                ...draft,
                project: projects.find((p) => p.key === key) ?? null,
                milestones: [],
              })
            }
          />
          <PillSelect
            label="Milestone"
            value={draft.milestones?.[0]?.id ?? ""}
            options={[["", "No milestone"], ...milestones.map((m) => [m.id, m.name] as const)]}
            onChange={(id) =>
              setDraft({ ...draft, milestones: milestones.filter((m) => m.id === id) })
            }
          />
          <details className="w-full text-[12px] text-fg-3">
            <summary className="cursor-default py-1">
              Due date{draft.due ? `: ${draft.due}` : ""}
            </summary>
            <Suspense fallback={<p>Loading dates…</p>}>
              <DateInput
                value={draft.due ?? ""}
                onChange={(due) => setDraft({ ...draft, due: due || null })}
                onValidity={setDateValid}
              />
            </Suspense>
          </details>
        </div>
        <input
          aria-label="Labels, comma separated"
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          placeholder="Labels, separated by commas"
          className={`${INPUT} mt-3 text-[12px]`}
        />
        {noParentType && (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {noParentType}
          </p>
        )}
        <Attachments attachments={attachments} onChange={setAttachments} onBusy={setFilesBusy} />
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <label className="mr-auto flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={more} onChange={(e) => setMore(e.target.checked)} />
            Create more
          </label>
          <button type="button" onClick={close} className={BUTTON}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() || filesBusy || !dateValid || !!noParentType}
            className="rounded-md bg-accent px-3 py-1.5 text-white disabled:opacity-40"
          >
            {initial.copy ? "Save copy" : "Create issue"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Choice = { id: string; name: string };
/** The types `issue` can change to, for the type menu and Issue options. */
const issueTypes = (issue: Issue, options: JiraOptions, issues: Issue[]) =>
  typeChoices(
    issue.type,
    options.types?.[issue.project?.key ?? ""],
    issues.flatMap((i) => (i.type && i.project?.key === issue.project?.key ? [i.type] : [])),
  );
export function PropertyPicker({
  issue,
  field,
}: {
  issue: Issue;
  field: "priority" | "type" | "labels" | "project" | "milestone" | "due";
}) {
  const all = useStore((s) => s.issues);
  const issues = [...all.values()].filter((i) => i.board === issue.board);
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(issue.due ?? "");
  const [dateValid, setDateValid] = useState(true);
  // Issue options › Due date › Custom… opens the date form; Shift+D opens Linear's due menu first.
  const [custom, setCustom] = useState(() => kept("issue-options-start") === "due");
  // The typed-date parser (chrono) loads with the due menu, off the main bundle, like the reminder parser.
  const [parseDue, setParseDue] = useState<typeof import("./due-parse").parseDueDate>();
  useEffect(() => {
    if (field !== "due") return;
    let active = true;
    void import("./due-parse").then(({ parseDueDate }) => active && setParseDue(() => parseDueDate));
    return () => {
      active = false;
    };
  }, [field]);
  useCommand("issue-options-start", (start) => {
    if (start !== "due") return;
    setCustom(true);
    return true;
  });
  // Linear lists the issue's labels first, then the rest after a divider; the order holds while the menu is open.
  const options = useStore((s) => s.options),
    writable = useStore((s) => s.writable);
  const [order] = useState(() => {
    const rest = knownLabels(issues, options.labels).filter(
      (l) => !issue.labels.includes(l),
    );
    return { checked: [...issue.labels], rest };
  });
  // The label menu opens beside the chip or button that was clicked, else beside the add button (Linear, RAJ-52).
  const [trigger] = useState(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement.closest("[data-properties]")
      ? document.activeElement
      : issueAnchor("prop-labels", issue.key),
  );
  const close = () => ui.send({ type: "overlay.close" });
  const label = {
    priority: "Set priority",
    type: "Change issue type",
    labels: "Change labels",
    project: "Change project",
    milestone: "Set milestone",
    due: "Due date",
  }[field];
  if (field === "due" && !custom) {
    // Linear (RAJ-61): a click or Enter applies at once; typed text like "24h" or "Feb 9" offers that date.
    const parsed = parseDue?.(query) ?? null,
      apply = (due: string | null) => {
        actions.patch(issue.key, { due });
        close();
      };
    return (
      <PropertyMenu
        label={label}
        placeholder="Try: 24h, 7 days, Feb 9"
        hotkey={shortcutLabel("due")}
        anchor={issueAnchor("prop-due", issue.key)}
        close={close}
        query={query}
        onQuery={setQuery}
      >
        {parsed && (
          <PickerRow
            value={`Due ${query}`}
            keywords={[query]}
            icon={<Icon name="calendar" />}
            hint={shortDate(parsed)}
            onSelect={() => apply(parsed)}
          >
            Due
          </PickerRow>
        )}
        <PickerRow value="Custom…" icon={<Icon name="calendar" />} onSelect={() => setCustom(true)}>
          Custom…
        </PickerRow>
        {duePresets().map((preset) => (
          <PickerRow
            key={preset.name}
            value={preset.name}
            icon={<Icon name="calendar" />}
            current={issue.due === preset.due}
            hint={shortDate(preset.due)}
            onSelect={() => apply(preset.due)}
          >
            {preset.name}
          </PickerRow>
        ))}
        {issue.due && (
          <PickerRow
            value="Remove due date"
            icon={<Icon name="close" />}
            onSelect={() => apply(null)}
          >
            Remove due date
          </PickerRow>
        )}
      </PropertyMenu>
    );
  }
  if (field === "due")
    return (
      <Modal label={label} close={close} anchor={issueAnchor("prop-due", issue.key)} width={360}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!dateValid) return;
            actions.patch(issue.key, { due: date || null });
            close();
          }}
        >
          <div className="mb-3">
            <Suspense fallback={<p>Loading dates…</p>}>
              <DateInput autoFocus value={date} onChange={setDate} onValidity={setDateValid} />
            </Suspense>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={BUTTON}
              onClick={() => {
                actions.patch(issue.key, { due: null });
                close();
              }}
            >
              Remove due date
            </button>
            <button className={BUTTON} type="submit" disabled={!dateValid}>
              Save
            </button>
          </div>
        </form>
      </Modal>
    );
  if (field === "labels") {
    // Linear (RAJ-52): a row click or Enter toggles the label and closes; Space or the row's checkbox toggles and keeps the menu open.
    const toggle = (name: string) => {
      const now = get().issues.get(issue.key)?.labels ?? [];
      actions.patch(issue.key, {
        labels: now.includes(name) ? now.filter((l) => l !== name) : [...now, name],
      });
    };
    const row = (name: string) => {
      const on = issue.labels.includes(name);
      return (
        <Menu.Item
          key={name}
          value={name}
          data-label={name}
          checkbox={on}
          checkboxLabel={`${on ? "Remove" : "Add"} label ${name}`}
          onCheckboxClick={() => toggle(name)}
          icon={<span className="size-[9px] rounded-full" style={{ background: hue(name) }} />}
          onSelect={() => {
            toggle(name);
            close();
          }}
        >
          {name}
        </Menu.Item>
      );
    };
    // Jira labels can't contain spaces: a new label joins its words with hyphens (R2-issue-fields-D5).
    const created = query.trim().replace(/\s+/g, "-");
    const exact = [...order.checked, ...order.rest].some(
      (l) => l.toLowerCase() === created.toLowerCase(),
    );
    return (
      <PropertyMenu
        label={label}
        placeholder={issue.labels.length ? "Change or add labels…" : "Add labels…"}
        hotkey="L"
        anchor={trigger}
        side={trigger?.closest("[data-properties]") ? "left" : undefined}
        close={close}
        query={query}
        onQuery={setQuery}
        onKeyDown={(event) => {
          if (event.key !== " " || query) return;
          const name = event.currentTarget.querySelector<HTMLElement>(
            "[cmdk-item][data-selected=true]",
          )?.dataset.label;
          if (name) {
            event.preventDefault();
            toggle(name);
          }
        }}
      >
        {order.checked.map(row)}
        {order.checked.length > 0 && order.rest.length > 0 && <Menu.Divider />}
        {order.checked.length > 0 && order.rest.length > 0 ? (
          <Menu.Group heading="Workspace labels">{order.rest.map(row)}</Menu.Group>
        ) : (
          order.rest.map(row)
        )}
        {query.trim() && !exact && (
          <Menu.Item
            value={`Create ${query}`}
            icon={<Icon name="plus" size={14} />}
            // Like Enter on an existing label: apply it and close, so the menu never shows a list without it.
            onSelect={() => {
              toggle(created);
              close();
            }}
          >
            Create new label: "{created}"
          </Menu.Item>
        )}
      </PropertyMenu>
    );
  }
  let choices: Choice[] = [];
  // Jira can't clear a priority, so with Jira writes the menu offers only Jira's priorities.
  if (field === "priority")
    choices = [
      ...(writable ? [] : [{ id: "", name: "No priority" }]),
      ...[
        ...new Set([
          ...options.priorities.map((p) => p.name),
          ...issues.flatMap((i) => (i.priority ? [i.priority] : [])),
        ]),
      ]
        .sort((a, b) => priorityRank(a) - priorityRank(b))
        .map((p) => ({ id: p, name: p })),
    ];
  if (field === "type")
    choices = issueTypes(issue, options, issues).map((t) => ({ id: t, name: t }));
  // Jira's API can't move an issue to another project or out of one, so with Jira writes the menu shows only its own.
  if (field === "project")
    choices = writable
      ? issue.project
        ? [{ id: issue.project.key, name: issue.project.name }]
        : []
      : [
          { id: "", name: "No project" },
          ...new Map(
            issues.flatMap((i) =>
              i.project
                ? [[i.project.key, { id: i.project.key, name: i.project.name }] as const]
                : [],
            ),
          ).values(),
        ];
  if (field === "milestone")
    choices = [
      { id: "", name: "No milestone" },
      ...new Map([
        ...(options.versions[issue.project?.key ?? ""] ?? []).map((m) => [m.id, m] as const),
        ...issues
          .filter((i) => i.project?.key === issue.project?.key)
          .flatMap((i) => (i.milestones ?? []).map((m) => [m.id, m] as const)),
      ]).values(),
    ];
  const selected = (id: string) =>
    field === "priority"
      ? (issue.priority ?? "") === id
      : field === "type"
        ? issue.type === id
        : field === "project"
          ? (issue.project?.key ?? "") === id
          : (issue.milestones?.[0]?.id ?? "") === id;
  const choose = (c: Choice) => {
    if (field === "priority") actions.patch(issue.key, { priority: c.id || undefined });
    if (field === "type" && c.id !== issue.type) actions.patch(issue.key, { type: c.id });
    if (field === "project" && c.id !== (issue.project?.key ?? ""))
      actions.patch(issue.key, {
        project: issues.find((i) => i.project?.key === c.id)?.project ?? null,
        milestones: [],
      });
    if (field === "milestone") actions.patch(issue.key, { milestones: c.id ? [c] : [] });
    close();
  };
  return (
    <PropertyMenu
      label={label}
      placeholder={
        field === "priority"
          ? "Change priority to…"
          : field === "type"
            ? "Change issue type to…"
            : `${label}…`
      }
      hotkey={field === "priority" || field === "type" ? shortcutLabel(field) : undefined}
      anchor={issueAnchor(`prop-${field}`, issue.key)}
      close={close}
      current={choices.find((c) => selected(c.id))?.name}
    >
      {choices.map((c, i) => (
        <PickerRow
          key={c.id}
          value={c.name}
          icon={
            field === "priority" ? (
              <PriorityIcon name={c.id || undefined} />
            ) : field === "type" ? (
              <TypeDot type={c.id} />
            ) : field === "project" ? (
              <Icon name="layers" />
            ) : (
              <Icon name="calendar" />
            )
          }
          current={selected(c.id)}
          number={field === "priority" ? i : undefined}
          onSelect={() => choose(c)}
        >
          {c.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}

export function BoardDetails({ board, issues }: { board: Board; issues: Issue[] }) {
  const [tab, setTab] = useState<Grouping>("assignee");
  const { filters } = useViewSettings(board.id);
  const tabs: [Grouping, string][] = [
    ["assignee", "Assignees"],
    ["label", "Labels"],
    ["priority", "Priority"],
    ["project", "Projects"],
  ];
  return (
    <aside
      aria-label="Board details"
      className="w-[300px] shrink-0 overflow-y-auto border-l border-line p-3"
    >
      <div role="tablist" aria-label="Board summary" className="mb-4 flex gap-1">
        {tabs.map(([id, label]) => (
          <button
            role="tab"
            key={id}
            aria-selected={id === tab}
            onClick={() => setTab(id)}
            className={`rounded-md px-2 py-1.5 text-[11px] ${id === tab ? "bg-sel" : "text-fg-3 hover:bg-hover"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {buckets(issues, tab, board, issues)
        .filter((g) => g.issues.length)
        .map((group) => {
          const field: Field = tab === "label" ? "labels" : (tab as Field);
          // Like Linear, a bucket filters the view, and clicking it again clears that filter.
          const active = filters.children.find(
            (c) =>
              "field" in c &&
              c.field === field &&
              c.op === "is" &&
              c.values.length === 1 &&
              c.values[0] === group.id,
          );
          return (
            <button
              key={group.id}
              aria-pressed={!!active}
              title={active ? "Clear filter" : undefined}
              onClick={() =>
                active
                  ? updateRule(board.id, active.id, null)
                  : setOnlyRule(board.id, { id: newId(), field, op: "is", values: [group.id] })
              }
              className={`mb-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[12px] hover:bg-hover ${active ? "bg-sel text-fg" : ""}`}
            >
              <span className="flex-1 truncate">{group.name}</span>
              <span className="rounded-md bg-sel px-2 tabular-nums">{group.issues.length}</span>
            </button>
          );
        })}
      {!issues.length && <p className="text-fg-3">No issues in this view.</p>}
    </aside>
  );
}

export function GroupMenu({
  name,
  hide,
  issues,
  completed,
  display,
}: {
  name: string;
  hide: () => void;
  issues: Issue[];
  completed: boolean;
  display: Display;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const entries: ActionEntry[] = [
    ...(issues.length
      ? [
          {
            name: "Select all in column",
            run: () =>
              set({
                columnSelection: new Set(issues.map((issue) => issue.key)),
              }),
          },
        ]
      : []),
    { name: "Hide column", run: hide },
    ...(completed
      ? [
          {
            name: "Order completed by recency",
            selected: display.completedRecency,
            divider: true,
            run: () =>
              setDisplay(get().board, {
                completedRecency: !display.completedRecency,
              }),
          },
        ]
      : []),
  ];
  return (
    <div className="ml-auto">
      <button
        aria-label={`Options for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => {
          setKeyboard(e.detail === 0);
          setAnchor(anchor ? null : e.currentTarget);
        }}
        className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover"
      >
        <Icon name="dots" />
      </button>
      {anchor && (
        <ActionMenu
          label={`Column ${name}`}
          anchor={anchor}
          entries={entries}
          highlight={keyboard}
          close={() => setAnchor(null)}
        />
      )}
    </div>
  );
}

export function IssueOptions({ issue }: { issue: Issue }) {
  const full = useStore((s) => s.full.get(issue.key)),
    parent = useStore((s) => (issue.parent ? s.issues.get(issue.parent) : undefined));
  const close = () => ui.send({ type: "overlay.close" });
  const point = useStore((s) => s.issueOptionsPoint),
    [view, setView] = useState(() => kept("issue-options-start"));
  useCommand("issue-options-start", (start) => {
    if (start === "reminder" || start === "due") return;
    setView(start);
    return true;
  });
  const historyOpen = view === "history";
  const linkOpen = view === "link" || view === "pull-request";
  const resourceKind = view === "pull-request" ? "pull-request" : "link";
  const copy = async (kind: CopyKind) => {
    const status =
      statusById(boardOf(issue.key), issue.status)?.name ?? issue.status;
    try {
      await navigator.clipboard.writeText(
        issueCopy(kind, issue, full, issueURL(issue), status, ME.name),
      );
      set({ perf: `Copied ${kind}` });
    } catch {
      set({ perf: "Could not access the clipboard" });
    }
    close();
  };
  if (historyOpen)
    return (
      <Modal label="Description history" close={close}>
        <h3 className="mb-3 font-medium">Description history</h3>
        <p className="mb-3 text-[12px] text-fg-3">Your locally saved description revisions.</p>
        {[...(issue.descriptionHistory ?? [])].reverse().map((entry, index) => (
          <div key={index} className="mb-3 rounded-md border border-line-2 p-3">
            <div className="mb-2 text-[11px] text-fg-3">{new Date(entry.at).toLocaleString()}</div>
            <div>
              {entry.document ? (
                <Adf node={entry.document} />
              ) : (
                <p className="whitespace-pre-wrap">{entry.text || "Empty description"}</p>
              )}
            </div>
            <button
              className={`${BUTTON} mt-2`}
              onClick={() => {
                actions.description(issue.key, entry.document ?? entry.text, true);
                close();
              }}
            >
              Restore this description
            </button>
          </div>
        ))}
        {!issue.descriptionHistory?.length && <p>No local description changes yet.</p>}
        <button onClick={close} className={`${BUTTON} mt-3`}>
          Close
        </button>
      </Modal>
    );
  if (linkOpen) return <ResourceForm issue={issue} kind={resourceKind} close={close} />;
  const favorite = get().favorites.includes(issue.key),
    keys = (id: string) => shortcutLabel(id) || undefined;
  const open = (overlay: "due" | "reminder" | "relations") =>
    ui.send({ type: "overlay.open", overlay });
  const related = (kind: NonNullable<IssueDraft["related"]>["kind"]) => {
    close();
    beginCreate({ related: { key: issue.key, kind }, project: issue.project });
  };
  const mark = (kind: string) => {
    set({ relationKind: kind });
    open("relations");
  };
  const reopen = (view: "link" | "pull-request" | "history") => {
    post("issue-options-start", view);
    ui.send({ type: "overlay.open", overlay: "options" });
  };
  // A right-click on a card or list row (Linear's row menu) leads with the property pickers its shortcuts open, acting on the selected issue.
  const picker = (name: string, icon: IconName, id: string): ActionEntry => ({
    name,
    icon,
    shortcut: keys(id),
    run: () => runShortcut(id, issue.key),
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
        shortcut: preset.label,
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
      children: issueTypes(issue, get().options, [...get().issues.values()]).map((type) => ({
        name: type,
        run: () => {
          if (type !== issue.type) actions.patch(issue.key, { type });
          close();
        },
      })),
    },
    { name: "Add link…", icon: "link", shortcut: keys("link"), run: () => reopen("link") },
    { name: "Add pull request…", icon: "branch", run: () => reopen("pull-request") },
    { name: "Add document…", icon: "file", run: () => createIssueDocument(issue) },
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
                  requestAnimationFrame(() => runShortcut("sub-issue"));
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
        { name: "Sub-issue of…", shortcut: keys("parent-set"), run: () => mark("parent") },
        { name: "Related to…", shortcut: keys("related"), run: () => mark("related") },
        { name: "Blocked by…", shortcut: keys("blocked"), run: () => mark("blocked") },
        { name: "Blocking…", shortcut: keys("blocking"), run: () => mark("blocking") },
        { name: "Duplicate of…", shortcut: keys("duplicate"), run: () => mark("duplicate") },
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
        run: () => void copy(kind),
      })),
    },
    { name: "Make a copy…", icon: "copy", run: () => actions.duplicate(issue.key) },
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
      children: [
        ...reminderPresets().map((preset) => ({
          name: preset.label,
          shortcut: reminderTime(preset.at),
          run: () => {
            actions.remind(issue.key, preset.at);
            close();
          },
        })),
        {
          name: "Custom…",
          run: () => {
            post("issue-options-start", "reminder");
            open("reminder");
          },
        },
      ],
    },
    { name: "Show description history", icon: "undo", divider: true, run: () => reopen("history") },
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
    .map(([id, name]) => ({ name, shortcut: keys(id), run: () => runShortcut(id, issue.key) }));
  const entries: ActionEntry[] = point
    ? [
        picker("Status", "status", "status"),
        picker("Priority", "priority", "priority"),
        picker("Assignee", "user", "assign"),
        due,
        picker("Labels", "label", "labels"),
        { name: "More properties", icon: "square-dots", children: properties },
        ...actionsAfter,
        ...(moves.length
          ? [{ name: "Move", icon: "chevron" as const, divider: true, children: moves }]
          : []),
        remove,
      ]
    : [due, ...properties, ...actionsAfter, remove];
  return (
    <ActionMenu
      anchor={point ? undefined : document.getElementById("issue-options")}
      point={point ?? undefined}
      entries={entries}
      label="Issue options"
      close={close}
    />
  );
}

/** The create form's attachments: an attach button that saves chosen files locally, then the list. */
export function Attachments({
  attachments = [],
  onChange,
  onBusy,
}: {
  attachments: Issue["attachments"];
  onChange: (files: NonNullable<Issue["attachments"]>) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="mt-3 text-[12px]">
      <input
        ref={file}
        type="file"
        multiple
        aria-label="Choose attachments"
        className="hidden"
        onChange={async (e) => {
          const input = e.currentTarget,
            selected = [...(input.files ?? [])];
          setBusy(true);
          onBusy?.(true);
          setError("");
          try {
            const files = await addLocalFiles(selected);
            onChange([...attachments, ...files]);
          } catch (error) {
            setError(error instanceof Error ? error.message : "Could not save this file locally");
          } finally {
            input.value = "";
            setBusy(false);
            onBusy?.(false);
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        aria-label="Attach images, files, or videos"
        onClick={() => file.current?.click()}
        className="text-fg-3 hover:text-fg disabled:opacity-40"
      >
        {busy ? "Saving file…" : "+ Attach file"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-fg-3">
          {error}
        </p>
      )}
      <AttachmentList attachments={attachments} onChange={onChange} />
    </div>
  );
}

/** Attached files, each with a remove button that returns focus to the nearest attach button. */
function AttachmentList({
  attachments,
  onChange,
  issueKey,
}: {
  attachments: NonNullable<Issue["attachments"]>;
  onChange: (files: NonNullable<Issue["attachments"]>) => void;
  issueKey?: string;
}) {
  return attachments.map((a) => (
    <div key={a.id} className="relative mt-2">
      <MediaView
        node={{ type: "media", attrs: { id: a.id, type: "file" } }}
        issueKey={issueKey}
        attachments={attachments}
      />
      <button
        type="button"
        aria-label={`Remove attachment ${a.name}`}
        className="absolute right-1 -top-2 z-10 rounded bg-card p-1"
        onClick={(e) => {
          const scope = e.currentTarget.closest('[role="dialog"]') ?? document;
          onChange(attachments.filter((f) => f.id !== a.id));
          // Focus returns to the attach button, as after removing a resource, not to <body>.
          requestAnimationFrame(() =>
            scope
              .querySelector<HTMLElement>('[aria-label="Attach images, files, or videos"]')
              ?.focus(),
          );
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  ));
}

export function PersonalIssueDetails({ issue }: { issue: Issue }) {
  const [reactionAnchor, setReactionAnchor] = useState<HTMLElement | null>(null);
  const toggleReaction = (emoji: string) =>
    actions.patch(issue.key, {
      reactions: issue.reactions?.includes(emoji)
        ? issue.reactions.filter((r) => r !== emoji)
        : [...(issue.reactions ?? []), emoji],
    });
  const full = useStore((s) => s.full.get(issue.key));
  const { visible, embedded } = attachmentSplit(issue, full?.fields);
  return (
    <div className="mt-5 space-y-3 text-[12px]">
      {/* Linear (RAJ-52): 26px below the last paragraph, 6px left of the text and 16px above the sub-issues header, reaction pills 8px apart, then the round add-reaction and attach buttons. */}
      <div data-reactions className="-ml-1.5 flex flex-wrap items-center">
        <div className="flex flex-wrap items-center gap-2 empty:hidden [&:not(:empty)]:mr-2">
          {issue.reactions?.map((emoji) => (
            <button
              key={emoji}
              aria-label={`Remove ${emoji} reaction`}
              aria-pressed="true"
              title={`You reacted with :${shortcode(emoji)}:`}
              onClick={() => toggleReaction(emoji)}
              className="reaction-pill"
            >
              <span>{emoji}</span>
              <span>1</span>
            </button>
          ))}
        </div>
        <button
          aria-label="Add reaction"
          title="Add reaction"
          onClick={(e) => setReactionAnchor(e.currentTarget)}
          className="round-action"
        >
          <Icon name="smile" size={14} />
        </button>
        <button
          type="button"
          aria-label="Attach images, files, or videos"
          title="Attach images, files, or videos"
          className="round-action"
          onClick={() =>
            document
              .getElementById("description")
              ?.closest(".rich-editor")
              ?.querySelector<HTMLInputElement>("input[type=file]")
              ?.click()
          }
        >
          <Icon name="paperclip" size={14} />
        </button>
      </div>
      {reactionAnchor && (
        <ReactionPicker
          anchor={reactionAnchor}
          close={() => setReactionAnchor(null)}
          choose={toggleReaction}
        />
      )}
      {/* The paperclip above attaches through the description editor; this is only the list. */}
      <div className="mt-3 text-[12px]">
        <AttachmentList
          issueKey={issue.key}
          attachments={visible}
          onChange={(attachments) =>
            actions.patch(issue.key, { attachments: [...embedded, ...attachments] })
          }
        />
      </div>

      <SubIssues key={issue.key} issue={issue} />
      <IssueResources issue={issue} />
    </div>
  );
}

export function Subscribers({ issue }: { issue: Issue }) {
  const issues = useStore((s) => s.issues);
  const people = [
    ...new Map(
      [
        ME,
        ...(issue.watchers ?? []),
        ...[...issues.values()].flatMap((i) =>
          [i.assignee, i.creator, ...(i.watchers ?? [])].filter(
            (u): u is NonNullable<typeof u> => !!u,
          ),
        ),
      ].map((user) => [user.id, user]),
    ).values(),
  ];
  const watching = (user: User) => !!issue.watchers?.some((u) => u.id === user.id);
  // Linear's subscribers menu: a multi-select people menu that stays open while you toggle.
  return (
    <Modal
      label="Change subscribers"
      anchorId="issue-subscribers"
      fit
      close={() => ui.send({ type: "overlay.close" })}
    >
      <Menu>
        <Menu.Input autoFocus aria-label="Change subscribers" placeholder="Change subscribers…" />
        <Menu.List maxHeight="40vh">
          <Menu.Empty>No people found</Menu.Empty>
          {people.map((user) => (
            <Menu.Item
              key={user.id}
              value={`${user.name} ${user.id}`}
              checkbox={watching(user)}
              icon={<Avatar user={user} size={16} />}
              hint={issue.assignee?.id === user.id ? "Assignee" : undefined}
              onSelect={() =>
                actions.patch(issue.key, {
                  watchers: watching(user)
                    ? (issue.watchers ?? []).filter((u) => u.id !== user.id)
                    : [...(issue.watchers ?? []), user],
                })
              }
            >
              {user.name}
            </Menu.Item>
          ))}
        </Menu.List>
      </Menu>
    </Modal>
  );
}

/** `close` lets a row menu open this for another issue (a sub-issue) without the global overlay. */
/** Linear's "Mark as" command menu (RAJ-52): the kind comes from the menu item, so there is no type picker; its placeholder, Create row and Enter hint follow the kind. */
const MARK: Record<
  string,
  {
    placeholder: string;
    enter: string;
    create?: string;
    draft?: "related" | "blocked" | "blocking";
  }
> = {
  related: {
    placeholder: "Search for issue to reference…",
    enter: "Mark as related",
    create: "Create new issue related to",
    draft: "related",
  },
  blocked: {
    placeholder: "Search for issue to mark blocked by…",
    enter: "Mark as blocked by",
    create: "Create new issue blocking",
    draft: "blocking",
  },
  blocking: {
    placeholder: "Search for issue to mark as blocked by {key}…",
    enter: "Mark as blocking",
    create: "Create new issue blocked by",
    draft: "blocked",
  },
  duplicate: { placeholder: "Search for issue to mark as duplicate of…", enter: "Select" },
  parent: { placeholder: "Search for issue to set as a parent…", enter: "Set as parent" },
  child: { placeholder: "Search for issue to add as a sub-issue…", enter: "Add as sub-issue" },
};
const INVERSE: Record<string, string> = { blocked: "blocking", blocking: "blocked" };
export function Relations({ issue, close: done }: { issue: Issue; close?: () => void }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState("");
  const kind = get().relationKind;
  const close = done ?? (() => ui.send({ type: "overlay.close" }));
  const mark = MARK[kind] ?? MARK.related!;
  // Linear leaves out issues the new link would repeat or contradict; "Related issues" offers this issue's related ones first.
  // ponytail: "Recent" is most recently updated; Linear uses recently viewed. "More actions" (⌥↵) and "Quick look" (→) are not built.
  const linked = new Set(
    (issue.relations ?? [])
      .filter((r) => kind === "related" || r.kind === kind || r.kind === INVERSE[kind])
      .map((r) => r.key),
  );
  if (kind === "parent" || kind === "child")
    for (const i of all.values())
      if (i.parent === issue.key || i.key === issue.parent) linked.add(i.key);
  // Jira takes a parent only one hierarchy level up in the same project; best match first, so Enter never picks a partial match over an exact one.
  const fits = (i: Issue) =>
    i.key !== issue.key &&
    !linked.has(i.key) &&
    matchRank(query, i) >= 0 &&
    (kind === "parent"
      ? canParent(get(), i, issue)
      : kind === "child"
        ? canParent(get(), issue, i)
        : true);
  const ranked = (list: Issue[]) =>
    list
      .map((i) => [matchRank(query, i), i] as const)
      .sort(([a, x], [b, y]) => a - b || y.updated.localeCompare(x.updated))
      .map(([, i]) => i);
  const relatedIssues = ["blocked", "blocking", "duplicate"].includes(kind)
    ? ranked(
        (issue.relations ?? [])
          .filter((r) => r.kind === "related")
          .map((r) => all.get(r.key))
          .filter((i): i is Issue => !!i && fits(i)),
      )
    : [];
  const recent = useMemo(
    () =>
      ranked([...all.values()].filter((i) => fits(i) && !relatedIssues.includes(i))).slice(
        0,
        query ? 40 : 8,
      ),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Memo invalidation follows draft identity or relation inputs; render-local helpers would invalidate every render.
    [all, query, kind, issue],
  );
  // cmdk selects the first row as the query changes, so the group holding the best match goes first.
  const relatedFirst =
    !recent[0] ||
    (!!relatedIssues[0] && matchRank(query, relatedIssues[0]) <= matchRank(query, recent[0]));
  const add = (target: Issue) => {
    if (kind === "parent") {
      let ancestor: Issue | undefined = target;
      const seen = new Set([issue.key]);
      while (ancestor) {
        if (seen.has(ancestor.key)) {
          set({ perf: "A parent cannot be its own descendant" });
          return;
        }
        seen.add(ancestor.key);
        ancestor = ancestor.parent ? all.get(ancestor.parent) : undefined;
      }
      actions.patch(issue.key, { parent: target.key });
    } else if (kind === "child") {
      for (
        let ancestor: Issue | undefined = issue;
        ancestor;
        ancestor = ancestor.parent ? all.get(ancestor.parent) : undefined
      )
        if (ancestor.key === target.key) {
          set({ perf: "A parent cannot be its own descendant" });
          return;
        }
      actions.patch(target.key, { parent: issue.key });
    } else actions.relate(issue.key, target.key, kind);
    close();
  };
  const create =
    mark.create && !query
      ? () => {
          close();
          beginCreate({ related: { key: issue.key, kind: mark.draft! }, project: issue.project });
        }
      : kind === "child" && !query && canHaveChildren(get(), issue)
        ? () => {
            close();
            requestAnimationFrame(() => runShortcut("sub-issue"));
          }
        : null;
  const row = (i: Issue, group: string) => (
    <Command.Item
      key={`${group}${i.key}`}
      value={group === "related" ? `related:${i.key}` : i.key}
      onSelect={() => add(i)}
      className="mark-row"
    >
      <span className="grid size-4 place-items-center">
        <StatusIcon status={statusOf(boards, i)} />
      </span>
      <span className="text-[var(--menu-fg-3)]">{i.key}</span>
      <span className="truncate text-[var(--menu-fg)]">{i.summary}</span>
    </Command.Item>
  );
  const relatedGroup = relatedIssues.length > 0 && (
    <Command.Group heading="Related issues">
      {relatedIssues.map((i) => row(i, "related"))}
    </Command.Group>
  );
  return (
    <Modal label="Issue relations" close={close} command width={720}>
      <Command
        shouldFilter={false}
        loop
        value={selected}
        onValueChange={setSelected}
        data-kind={kind}
        className="flex min-h-0 flex-col"
      >
        <div className="px-1.5 pt-1.5">
          <Command.Input
            autoFocus
            aria-label="Find related issue"
            placeholder={mark.placeholder.replace("{key}", issue.key)}
            className="h-10 w-full rounded-xl bg-transparent px-3 text-[13px] text-[var(--menu-fg)] outline-none placeholder:text-[var(--menu-placeholder)]"
            value={query}
            onValueChange={setQuery}
          />
        </div>
        <Command.List className="mark-list min-h-0 flex-1 overflow-y-auto p-1.5">
          {relatedFirst && relatedGroup}
          {recent.length > 0 &&
            (kind === "parent" && !query ? (
              recent.map((i) => row(i, "recent"))
            ) : (
              <Command.Group heading={query ? "Issues" : "Recent"}>
                {recent.map((i) => row(i, "recent"))}
              </Command.Group>
            ))}
          {!relatedFirst && relatedGroup}
          {create && (
            <Command.Group heading="Create">
              <Command.Item value="create" onSelect={create} className="mark-row">
                <Icon name="plus" size={16} />
                <span className="flex-1 truncate text-[var(--menu-fg)]">
                  {kind === "child" ? "Add sub-issue…" : `${mark.create} ${issue.key}…`}
                </span>
                {kind === "child" && <kbd>{shortcutLabel("sub-issue")}</kbd>}
              </Command.Item>
            </Command.Group>
          )}
          <Command.Empty className="px-3 py-3 text-[13px] text-fg-3">
            No matching issues
          </Command.Empty>
        </Command.List>
        <div className="mark-footer">
          <span>
            <kbd>↵</kbd>
            {selected === "create" ? "Select" : mark.enter}
          </span>
        </div>
      </Command>
    </Modal>
  );
}

/** Linear's "add team", for Jira boards: paste a board link or ID; the board mirrors and opens without a reload. */
export function AddBoard() {
  const [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const close = () => ui.send({ type: "overlay.close" });
  return (
    <Modal label="Add board" close={close} width={440}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const { id, message } = await addBoard(value);
            close();
            navigate({ board: id, selected: null, panel: false });
            ui.send({ type: "toast.show", text: message });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-[12px]">
          Jira board link or ID
          <input
            autoFocus
            aria-label="Jira board link or ID"
            placeholder="https://your-team.atlassian.net/jira/software/projects/KAN/boards/1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`${INPUT} mt-2`}
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-[12px] text-red-500">
            {error}
          </p>
        ) : (
          <p className="mt-2 text-[12px] text-fg-3">
            Open the board in Jira and copy its address. Better-jira only reads it.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BUTTON} onClick={close}>
            Cancel
          </button>
          <button disabled={!value.trim() || busy} className={BUTTON}>
            {busy ? "Adding…" : "Add board"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
