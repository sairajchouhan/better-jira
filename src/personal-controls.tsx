import { EmptyState } from "./empty-state";
import { resourceURL } from "./issue-resource";
import { useStoredState, writeStored } from "./stored-state";
import { adfToText } from "./adf";
import { showNotification } from "./app-notifications";
import { Text } from "./text";
import { Tabs } from "./tabs";
import { CountBadge } from "./count-badge";
import { Shortcut, Keycap } from "./keycap";
import { Dialog } from "./dialog";
import { TextInput } from "./field";
import { Button, IconButton } from "./button";
import { createSubIssue, issueMenuEntries, type IssueMenuDialog } from "./issue-menu";
/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { SubIssues, statusOf } from "./sub-issues";
import { attachmentSplit } from "./issue-attachments";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Adf } from "./adf";
import { FramedEditor } from "./rich-editor-loader";
import { MediaView } from "./media-loader";
import { normalizeDocument, documentHasMedia } from "./document";
import { Icon, RelationIcon, StatusIcon } from "./icons";
import { PropertyTrigger } from "./property-trigger";
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
import {
  StatusMenu,
  AssigneeMenu,
  PriorityMenu,
  TypeMenu,
  LabelsMenu,
  ProjectMenu,
  MilestoneMenu,
  DueMenu,
} from "./property-menu";
import {
  actions,
  addBoard,
  addLocalFiles,
  beginCreate,
  usePeople,
  get,
  navigate,
  set,
  ui,
  useStore,
  type Board,
  type Issue,
  type IssueDraft,
  type JiraOptions,
  type User,
} from "./store";
import {
  buckets,
  newId,
  type Display,
  type Field,
  type Grouping,
} from "./view-model";
import { statuses, projectChoices } from "./board-catalog";
import {
  setDisplay,
  setOnlyRule,
  updateRule,
  useViewSettings,
} from "./view-settings";

export { MenuSurface as Modal } from "./menu-surface";
import { MenuSurface as Modal, issueAnchor } from "./menu-surface";
import { IssueResources, ResourceForm } from "./issue-resources";
import { ReactionPicker, ReactionPill } from "./reactions";
import { PropertyPill } from "./pill-select";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { kept, post, useCommand } from "./commands";

/** Linear keeps an unsent title and description when the composer closes; the next C brings them back. */
const unsent = { title: "", description: normalizeDocument("") };
type SavedComposerDraft = { id: string; title: string; fields: IssueDraft };
const parseComposerDrafts = (raw: unknown): SavedComposerDraft[] => Array.isArray(raw) ? raw.filter(d => d && typeof d.id === "string" && typeof d.title === "string" && d.fields && typeof d.fields === "object") : [];
/** Linear's composer relation chip ("1 blocked", startup-root `yZn`/`hZn`): it opens "Open blocked issues", the pending
 *  relation's issue under its heading, which opens the issue or, from its × button, drops the relation before creating. */
const PENDING_RELATION = {
  blocked: ["blocked", "Open blocked issues", "Blocked by"],
  blocking: ["blocking", "Open blocking issues", "Blocks"],
  related: ["related", "Open related issues", "Related"],
  parent: ["sub-issue", "Open sub-issues", "Sub-issues"],
} as const;
function PendingRelation({ related, remove }: { related: NonNullable<IssueDraft["related"]>; remove: () => void }) {
  const issue = useStore((s) => s.issues.get(related.key)),
    boards = useStore((s) => s.boards);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [chip, title, heading] = PENDING_RELATION[related.kind];
  return (
    <>
      <PropertyTrigger
        data-pending-relation
        variant="row"
        state="value"
        title={title}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <RelationIcon kind={related.kind} />1 {chip}
      </PropertyTrigger>
      {anchor && (
        <Modal label={title} anchor={anchor} close={() => setAnchor(null)} fit>
          <Menu style={{ width: 347 }}>
            <Menu.List>
              <Menu.Group heading={heading}>
                <Menu.Item
                  value={related.key}
                  icon={issue && <StatusIcon status={statusOf(boards, issue)} />}
                  hint={
                    <IconButton
                      type="button"
                      tabIndex={-1}
                      label="Remove relation"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAnchor(null);
                        remove();
                      }}
                    >
                      <Icon name="close" size={12} />
                    </IconButton>
                  }
                  onSelect={() => {
                    setAnchor(null);
                    if (issue) navigate({ board: issue.board, selected: issue.key, panel: true, view: get().view });
                  }}
                >
                  <span className="mr-2 text-[var(--menu-fg-3)]">{related.key}</span>
                  {issue?.summary}
                </Menu.Item>
              </Menu.Group>
            </Menu.List>
          </Menu>
        </Modal>
      )}
    </>
  );
}

export function CreateIssue() {
  const boards = useStore(s => s.boards);
  const currentBoard = useStore(s => s.board);
  const all = useStore((s) => s.issues);
  const initial = useStore((s) => s.draft);
  const [draft, setDraft] = useState<IssueDraft>(initial);
  const board = boards.find(b => b.id === (draft.board ?? currentBoard))!;
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
  const [expanded, setExpanded] = useState(false);
  useCommand("create-expanded", () => {
    setExpanded(true);
    return true;
  });
  const [attachments, setAttachments] = useState<Issue["attachments"]>(
    initial.attachments ?? [],
  );
  const [filesBusy, setFilesBusy] = useState(false);
  const account = useStore(s => s.namespace);
  const [saved, setSaved] = useStoredState<SavedComposerDraft[]>(`better-jira:composer-drafts:v1:${account}`, parseComposerDrafts, [], "Could not save drafts locally");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [linkInput, setLinkInput] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const issues = [...all.values()].filter((i) => i.board === board.id);
  const projects = projectChoices(issues);
  const options = useStore((s) => s.options),
    writable = useStore((s) => s.writable);
  // Create related › Parent issue: only a type one level above the source's in Jira's hierarchy can be its parent (a Task's is an Epic).
  const source =
      draft.related?.kind === "parent" ? all.get(draft.related.key) : undefined,
    jiraTypes = options.types?.[draft.project?.key ?? projects[0]?.key ?? ""];
  const sourceLevel = jiraTypes?.find(
    (t) => t.name === source?.type,
  )?.hierarchyLevel;
  const parentTypes =
    source && sourceLevel !== undefined
      ? jiraTypes!
          .filter((t) => t.hierarchyLevel === sourceLevel + 1)
          .map((t) => t.name)
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
    [
      ...new Set(["Task", ...issues.flatMap((i) => (i.type ? [i.type] : []))]),
    ].filter((type) => draft.parent || !needsParent(get(), { type, project }));
  const type =
    draft.type && types.includes(draft.type)
      ? draft.type
      : (types[0] ?? "Task");
  const closeNow = () => ui.send({ type: "overlay.close" });
  const hasContent = !!title.trim() || !!adfToText(description).trim() || !!attachments?.length || documentHasMedia(description) || !!draft.resources?.length || !!draft.subIssues?.some(t => t.trim());
  const close = () => hasContent && !initial.copy ? setConfirmClose(true) : closeNow();
  const saveDraft = () => {
    const id = savedId ?? crypto.randomUUID();
    const next = [...saved.filter(d => d.id !== id), { id, title, fields: { ...draft, board: board.id, type, title, descriptionDoc: description, attachments, labels: labels.split(",").map(l => l.trim()).filter(Boolean) } }];
    if (!writeStored(`better-jira:composer-drafts:v1:${account}`, next, "Could not save drafts locally")) return;
    setSaved(next);
    unsent.title = "";
    unsent.description = normalizeDocument("");
    closeNow();
  };
  // One id per draft, read from this render: a second submit before React re-renders (a double click) makes no second issue.
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Memo invalidation follows draft identity or relation inputs; render-local helpers would invalidate every render.
  const submission = useMemo(() => crypto.randomUUID(), [draftIndex]);
  const submit = () => {
    if (!title.trim() || filesBusy || noParentType || (draft.subIssues?.some(t => t.trim()) && !canHaveChildren(get(), { type, project }))) return;
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
      if (savedId) setSaved(saved.filter(d => d.id !== savedId));
      setSavedId(null);
      unsent.title = "";
      unsent.description = normalizeDocument("");
    }
    if (key && more) {
      setTitle("");
      setDescription(normalizeDocument(""));
      setDraftIndex((n) => n + 1);
      setAttachments([]);
      setDraft(d => ({ ...d, subIssues: [], resources: [] }));
      titleRef.current?.focus();
    }
  };
  useHotkey("Mod+Enter", () => submit(), {
    target: formRef,
    capture: true,
    ignoreInputs: false,
  });
  if (draftsOpen) return <Dialog label="Saved drafts" close={() => setDraftsOpen(false)}>
    <Dialog.Header><Dialog.Title>Saved drafts</Dialog.Title><Dialog.Close /></Dialog.Header>
    {saved.length ? saved.map(item => <div key={item.id} className="flex items-center gap-2">
      <Button onClick={() => { setDraft(item.fields); setTitle(item.title); setDescription(normalizeDocument(item.fields.descriptionDoc)); setAttachments(item.fields.attachments ?? []); setLabels(item.fields.labels?.join(", ") ?? ""); setSavedId(item.id); setDraftIndex(n => n + 1); setDraftsOpen(false); }}>Finish {item.title || "Untitled issue"}</Button>
      <IconButton label={`Delete draft ${item.title || "Untitled issue"}`} onClick={() => setSaved(saved.filter(d => d.id !== item.id))}><Icon name="trash" /></IconButton>
    </div>) : <EmptyState title="No saved drafts" />}
  </Dialog>;
  if (confirmClose) return <Dialog label="Save to drafts?" close={() => setConfirmClose(false)} width={360}>
    <Dialog.Title>Save to drafts?</Dialog.Title><Dialog.Description>You can finish this issue later from your drafts.</Dialog.Description>
    <Dialog.Footer>
      <Button variant="dangerous" onClick={() => { if (savedId) setSaved(saved.filter(d => d.id !== savedId)); unsent.title = ""; unsent.description = normalizeDocument(""); closeNow(); }}>Discard</Button>
      <Button onClick={() => setConfirmClose(false)}>Cancel</Button><Button variant="primary" onClick={saveDraft} disabled={filesBusy}>Save</Button>
    </Dialog.Footer>
  </Dialog>;
  return (
    <Dialog
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
        <Dialog.Header className="mb-3">
          <Text variant="mini" color="muted" wrap="truncate" className="flex-1">
            <PropertyPill label="Board" current={board.name} menu={ComposerBoardMenu} menuProps={{ boards, value: board.id, onChange: (board: number) => setDraft({ board }) }} /> ›{" "}
            {initial.parent ? `Sub-issue of ${initial.parent}` : "New issue"}
          </Text>
          <IconButton
            type="button"
            label={expanded ? "Collapse editor" : "Expand editor"}
            onClick={() => setExpanded(!expanded)}
            variant="borderless"
            size="medium"
          >
            <Icon name="expand" />
          </IconButton>
          <Button type="button" onClick={() => setDraftsOpen(true)}>Saved drafts ({saved.length})</Button>
          <Dialog.Close />
        </Dialog.Header>
        <TextInput
          ref={titleRef}
          autoFocus
          aria-label="Issue title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.metaKey &&
              !e.ctrlKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              document.getElementById("create-description")?.focus();
            }
          }}
          placeholder="Issue title"
          className="w-full mb-2"
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
          {draft.related && (
            <PendingRelation related={draft.related} remove={() => setDraft(({ related: _related, ...rest }) => rest)} />
          )}
          <PropertyPill
            label="Issue type"
            current={type}
            menu={TypeMenu}
            menuProps={{
              board,
              value: type,
              choices: types,
              onChange: (type: string) => setDraft({ ...draft, type }),
            }}
          />
          <PropertyPill
            label="Status"
            current={
              statuses(board).find(
                (s) =>
                  s.id === (draft.status ?? board.columns[0]?.statuses[0]?.id),
              )?.name ?? ""
            }
            menu={StatusMenu}
            menuProps={{
              board,
              value: draft.status ?? board.columns[0]?.statuses[0]?.id ?? "",
              onChange: (status: string) => setDraft({ ...draft, status }),
            }}
          />
          <PropertyPill
            label="Priority"
            current={
              draft.priority ?? (writable ? "Default priority" : "Normal")
            }
            menu={PriorityMenu}
            menuProps={{
              board,
              value: draft.priority ?? (writable ? "" : "Normal"),
              empty: writable ? "Default priority" : "No priority",
              onChange: (priority: string) => setDraft({ ...draft, priority }),
            }}
          />
          <PropertyPill
            label="Assignee"
            current={draft.assignee?.name ?? "Unassigned"}
            menu={AssigneeMenu}
            menuProps={{
              board,
              value: draft.assignee ?? null,
              onChange: (assignee: User | null) =>
                setDraft({ ...draft, assignee }),
            }}
          />
          <PropertyPill
            label="Project"
            current={
              draft.project === null && !writable
                ? "No project"
                : (project?.name ?? "No project")
            }
            menu={ProjectMenu}
            menuProps={{
              board,
              value: draft.project === null && !writable ? null : project,
              onChange: (project: Issue["project"]) =>
                setDraft({ ...draft, project, milestones: [] }),
            }}
          />
          <PropertyPill
            label="Milestone"
            current={draft.milestones?.[0]?.name ?? "No milestone"}
            menu={MilestoneMenu}
            menuProps={{
              board,
              project: project?.key,
              value: draft.milestones ?? [],
              onChange: (milestones: NonNullable<Issue["milestones"]>) =>
                setDraft({ ...draft, milestones }),
            }}
          />
          <PropertyPill
            label="Due date"
            current={draft.due ?? "No due date"}
            menu={DueMenu}
            menuProps={{
              board,
              value: draft.due ?? null,
              onChange: (due: string | null) => setDraft({ ...draft, due }),
            }}
          />
          <PropertyPill
            label="Labels"
            current={labels || "No labels"}
            menu={LabelsMenu}
            menuProps={{
              board,
              value: labels
                .split(",")
                .map((l) => l.trim())
                .filter(Boolean),
              onChange: (value: string[]) => setLabels(value.join(", ")),
            }}
          />
        </div>
        {/* Text has no semantic danger color; keep the validation alert styling. */}
        {noParentType && (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {noParentType}
          </p>
        )}
        <Button type="button" disabled={!canHaveChildren(get(), { type, project })} onClick={() => setDraft(d => ({ ...d, subIssues: [...(d.subIssues ?? []), ""] }))}>Add sub-issue</Button>
        {draft.subIssues?.map((summary, index) => <div key={index} className="flex items-center gap-2"><TextInput aria-label={`Pending sub-issue ${index + 1}`} value={summary} onChange={e => setDraft(d => ({ ...d, subIssues: d.subIssues?.map((title, i) => i === index ? e.target.value : title) }))} placeholder="Sub-issue title" /><IconButton type="button" label={`Remove pending sub-issue ${index + 1}`} onClick={() => setDraft(d => ({ ...d, subIssues: d.subIssues?.filter((_, i) => i !== index) }))}><Icon name="close" /></IconButton></div>)}
        <Button type="button" onClick={() => setLinkInput("")}>Add link…</Button>
        {linkInput !== null && <div className="flex items-center gap-2"><TextInput aria-label="New issue link URL" value={linkInput} onChange={e => setLinkInput(e.target.value)} placeholder="https://" /><Button type="button" disabled={!resourceURL(linkInput)} onClick={() => { const url = resourceURL(linkInput); if (!url) return; setDraft(d => ({ ...d, resources: [...(d.resources ?? []), { id: crypto.randomUUID(), kind: "link", title: url, url, updated: new Date().toISOString() }] })); setLinkInput(null); }}>Add link</Button><Button type="button" onClick={() => setLinkInput(null)}>Cancel link</Button></div>}
        {draft.resources?.map(resource => <div key={resource.id} className="flex items-center gap-2"><Text variant="mini">{resource.title}</Text><IconButton type="button" label={`Remove link ${resource.title}`} onClick={() => setDraft(d => ({ ...d, resources: d.resources?.filter(r => r.id !== resource.id) }))}><Icon name="close" /></IconButton></div>)}
        <Attachments
          attachments={attachments}
          onChange={setAttachments}
          onBusy={setFilesBusy}
        />
        <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
          <Text
            as="label"
            variant="mini"
            color="inherit"
            className="mr-auto flex items-center gap-2"
          >
            <input
              type="checkbox"
              checked={more}
              onChange={(e) => setMore(e.target.checked)}
            />
            Create more
          </Text>
          <Button type="button" onClick={saveDraft} disabled={!hasContent || filesBusy}>Save draft</Button>
          <Button
            type="button"
            onClick={close}
            variant="borderless"
            size="medium"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!title.trim() || filesBusy || !!noParentType}
            variant="primary"
            size="medium"
          >
            {initial.copy ? "Save copy" : "Create issue"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** The types `issue` can change to, for the type menu and Issue options. */
const issueTypes = (issue: Issue, options: JiraOptions, issues: Issue[]) =>
  typeChoices(
    issue.type,
    options.types?.[issue.project?.key ?? ""],
    issues.flatMap((i) =>
      i.board === issue.board && i.type && i.project?.key === issue.project?.key
        ? [i.type]
        : [],
    ),
  );
export type IssueField =
  | "status"
  | "assignee"
  | "priority"
  | "type"
  | "labels"
  | "project"
  | "milestone"
  | "due";
type IssueMenuProps = {
  issue: Issue;
  anchor: HTMLElement | null;
  close: () => void;
};
const issueFieldMenus = {
  status: IssueStatusMenu,
  assignee: IssueAssigneeMenu,
  priority: IssuePriorityMenu,
  type: IssueTypeMenu,
  labels: IssueLabelsMenu,
  project: IssueProjectMenu,
  milestone: IssueMilestoneMenu,
  due: IssueDueMenu,
};
/** Route before mounting the adapter so only the selected field subscribes. */
export function PropertyPicker({
  issue,
  field,
  anchor: trigger,
  close: done,
}: {
  issue: Issue;
  field: IssueField;
  anchor?: HTMLElement;
  close?: () => void;
}) {
  const [anchor] = useState(
    () =>
      trigger ??
      (field === "labels" &&
      document.activeElement instanceof HTMLElement &&
      document.activeElement.closest("[data-properties]")
        ? document.activeElement
        : issueAnchor(`prop-${field}`, issue.key)),
  );
  const FieldMenu = issueFieldMenus[field];
  return (
    <FieldMenu
      issue={issue}
      anchor={anchor}
      close={done ?? (() => ui.send({ type: "overlay.close" }))}
    />
  );
}

function IssueStatusMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  return (
    <StatusMenu
      {...props}
      value={issue.status}
      onChange={(status) => actions.status(issue.key, status)}
    />
  );
}

function IssueAssigneeMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  return (
    <AssigneeMenu
      {...props}
      value={issue.assignee ?? null}
      onChange={(assignee) => actions.assign(issue.key, assignee)}
    />
  );
}

function IssuePriorityMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <PriorityMenu
      {...props}
      value={issue.priority ?? ""}
      onChange={(priority) => patch({ priority: priority || undefined })}
    />
  );
}

function IssueTypeMenu({ issue, anchor, close }: IssueMenuProps) {
  const all = useStore((s) => s.issues);
  const options = useStore((s) => s.options);
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <TypeMenu
      {...props}
      value={issue.type ?? ""}
      choices={issueTypes(issue, options, [...all.values()])}
      onChange={(type) => {
        if (type !== issue.type) patch({ type });
      }}
    />
  );
}

function IssueLabelsMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <LabelsMenu
      {...props}
      value={issue.labels}
      onChange={(labels) => patch({ labels })}
    />
  );
}

function IssueProjectMenu({ issue, anchor, close }: IssueMenuProps) {
  const writable = useStore((s) => s.writable);
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <ProjectMenu
      {...props}
      value={issue.project}
      choices={writable ? (issue.project ? [issue.project] : []) : undefined}
      onChange={(project) => {
        if (project?.key !== issue.project?.key)
          patch({ project, milestones: [] });
      }}
    />
  );
}

function IssueMilestoneMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <MilestoneMenu
      {...props}
      project={issue.project?.key}
      value={issue.milestones ?? []}
      onChange={(milestones) => patch({ milestones })}
    />
  );
}

function IssueDueMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = undefined;
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <DueMenu
      {...props}
      value={issue.due ?? null}
      onChange={(due) => patch({ due })}
    />
  );
}

export function BoardDetails({
  board,
  issues,
}: {
  board: Board;
  issues: Issue[];
}) {
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
      <Tabs value={tab} onValueChange={(value) => setTab(value as Grouping)}>
        <Tabs.List aria-label="Board summary" className="mb-4">
          {tabs.map(([id, label]) => (
            <Tabs.Tab key={id} value={id}>
              {label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
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
            <Button
              key={group.id}
              aria-pressed={!!active}
              title={active ? "Clear filter" : undefined}
              onClick={() =>
                active
                  ? updateRule(board.id, active.id, null)
                  : setOnlyRule(board.id, {
                      id: newId(),
                      field,
                      op: "is",
                      values: [group.id],
                    })
              }
              variant="borderless"
              size="medium"
              className="mb-1 w-full justify-start gap-2"
            >
              <span className="flex-1 truncate">{group.name}</span>
              <CountBadge background="filled">{group.issues.length}</CountBadge>
            </Button>
          );
        })}
      {/* This sidebar empty hint is inline copy, not a viewport EmptyState. */}
      {!issues.length && (
        <Text as="p" variant="small" color="muted">
          No issues in this view.
        </Text>
      )}
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
      <IconButton
        label={`Options for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => {
          setKeyboard(e.detail === 0);
          setAnchor(anchor ? null : e.currentTarget);
        }}
        variant="borderless"
        size="small"
      >
        <Icon name="dots" />
      </IconButton>
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

/** Where an issue menu's "…" entries go: link, pull request and history open inside Issue options, the rest their own overlay. */
const openIssueDialog = (issue: Issue) => (kind: IssueMenuDialog) => {
  if (kind === "link" || kind === "pull-request" || kind === "history") {
    post("issue-options-start", kind);
    ui.send({ type: "overlay.open", overlay: "options", target: issue.key });
  } else if (kind !== "rename")
    ui.send({ type: "overlay.open", overlay: kind === "assignee" ? "assign" : kind, target: issue.key });
};
export function IssueOptions({ issue }: { issue: Issue }) {
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
  if (historyOpen)
    return (
      <Dialog label="Description history" close={close}>
        <Dialog.Title className="mb-3">Description history</Dialog.Title>
        <Text className="mb-3" as="p" variant="mini" color="muted">
          Your locally saved description revisions.
        </Text>
        {[...(issue.descriptionHistory ?? [])].reverse().map((entry, index) => (
          <div key={index} className="mb-3 rounded-md border border-line-2 p-3">
            <Text className="mb-2" as="div" variant="micro" color="muted">
              {new Date(entry.at).toLocaleString()}
            </Text>
            <div>
              {entry.document ? (
                <Adf node={entry.document} />
              ) : (
                <p className="whitespace-pre-wrap">
                  {entry.text || "Empty description"}
                </p>
              )}
            </div>
            <Button
              onClick={() => {
                actions.description(
                  issue.key,
                  entry.document ?? entry.text,
                  true,
                );
                close();
              }}
              variant="borderless"
              size="medium"
              className="mt-2"
            >
              Restore this description
            </Button>
          </div>
        ))}
        {!issue.descriptionHistory?.length && (
          <p>No local description changes yet.</p>
        )}
        <Button
          onClick={close}
          variant="borderless"
          size="medium"
          className="mt-3"
        >
          Close
        </Button>
      </Dialog>
    );
  if (linkOpen)
    return <ResourceForm issue={issue} kind={resourceKind} close={close} />;
  const entries = issueMenuEntries(issue, {
    close,
    presentation: point ? "row" : "detail",
    openDialog: openIssueDialog(issue),
  });
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
  const file = useRef<HTMLInputElement>(null),
    attach = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Text className="mt-3" as="div" variant="mini" color="inherit">
      {/* Native file selection is outside the text-field primitive family. */}
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
            setError(
              error instanceof Error
                ? error.message
                : "Could not save this file locally",
            );
          } finally {
            input.value = "";
            setBusy(false);
            onBusy?.(false);
          }
        }}
      />
      <Button
        ref={attach}
        type="button"
        disabled={busy}
        aria-label="Attach images, files, or videos"
        onClick={() => file.current?.click()}
        variant="borderless"
        size="medium"
      >
        {busy ? "Saving file…" : "+ Attach file"}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-fg-3">
          {error}
        </p>
      )}
      <AttachmentList attachments={attachments} onChange={onChange} attachButton={attach} />
    </Text>
  );
}

/** Attached files, each with a remove button that returns focus to the owner's attach button. */
function AttachmentList({
  attachments,
  onChange,
  issueKey,
  attachButton,
}: {
  attachments: NonNullable<Issue["attachments"]>;
  onChange: (files: NonNullable<Issue["attachments"]>) => void;
  issueKey?: string;
  attachButton: RefObject<HTMLButtonElement | null>;
}) {
  return attachments.map((a) => (
    <div key={a.id} className="relative mt-2">
      <MediaView
        node={{ type: "media", attrs: { id: a.id, type: "file" } }}
        issueKey={issueKey}
        attachments={attachments}
      />
      <IconButton
        type="button"
        label={`Remove attachment ${a.name}`}
        onClick={() => {
          onChange(attachments.filter((f) => f.id !== a.id));
          // Focus returns to the attach button, as after removing a resource, not to <body>.
          requestAnimationFrame(() => attachButton.current?.focus());
        }}
        variant="borderless"
        size="medium"
        className="absolute right-1 -top-2 z-10"
      >
        <Icon name="close" />
      </IconButton>
    </div>
  ));
}

export function PersonalIssueDetails({ issue }: { issue: Issue }) {
  const [reactionAnchor, setReactionAnchor] = useState<HTMLElement | null>(
    null,
  );
  const toggleReaction = (emoji: string) =>
    actions.patch(issue.key, {
      reactions: issue.reactions?.includes(emoji)
        ? issue.reactions.filter((r) => r !== emoji)
        : [...(issue.reactions ?? []), emoji],
    });
  const full = useStore((s) => s.full.get(issue.key));
  const attach = useRef<HTMLButtonElement>(null);
  const { visible, embedded } = attachmentSplit(issue, full?.fields);
  return (
    <Text className="mt-5 space-y-3" as="div" variant="mini" color="inherit">
      {/* Linear (RAJ-52): 26px below the last paragraph, 6px left of the text and 16px above the sub-issues header, reaction pills 8px apart, then the round add-reaction and attach buttons. */}
      {/* The pills keep Linear's chip geometry; add and attach are Jx (borderless/medium IconButton), 28px round. */}
      <div data-reactions className="-ml-1.5 flex flex-wrap items-center">
        <div className="flex flex-wrap items-center gap-2 empty:hidden [&:not(:empty)]:mr-2">
          {issue.reactions?.map((emoji) => (
            <ReactionPill key={emoji} emoji={emoji} onRemove={() => toggleReaction(emoji)} />
          ))}
        </div>
        <IconButton
          label="Add reaction"
          aria-expanded={!!reactionAnchor}
          onClick={(e) => setReactionAnchor(e.currentTarget)}
        >
          <Icon name="smile" size={14} />
        </IconButton>
        <IconButton
          ref={attach}
          label="Attach images, files, or videos"
          onClick={() =>
            document
              .getElementById("description")
              ?.closest(".rich-editor")
              ?.querySelector<HTMLInputElement>("input[type=file]")
              ?.click()
          }
        >
          <Icon name="paperclip" size={14} />
        </IconButton>
      </div>
      {reactionAnchor && (
        <ReactionPicker
          anchor={reactionAnchor}
          close={() => setReactionAnchor(null)}
          choose={toggleReaction}
        />
      )}
      {/* The paperclip above attaches through the description editor; this is only the list. */}
      <Text className="mt-3" as="div" variant="mini" color="inherit">
        <AttachmentList
          issueKey={issue.key}
          attachButton={attach}
          attachments={visible}
          onChange={(attachments) =>
            actions.patch(issue.key, {
              attachments: [...embedded, ...attachments],
            })
          }
        />
      </Text>

      <SubIssues key={issue.key} issue={issue} />
      <IssueResources issue={issue} />
    </Text>
  );
}

export function Subscribers({ issue }: { issue: Issue }) {
  const people = usePeople(issue.watchers);
  const watching = (user: User) =>
    !!issue.watchers?.some((u) => u.id === user.id);
  // Linear's subscribers menu: a multi-select people menu that stays open while you toggle.
  return (
    <Modal
      label="Change subscribers"
      anchorId="issue-subscribers"
      fit
      close={() => ui.send({ type: "overlay.close" })}
    >
      <Menu>
        <Menu.Input
          autoFocus
          aria-label="Change subscribers"
          placeholder="Change subscribers…"
        />
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
  duplicate: {
    placeholder: "Search for issue to mark as duplicate of…",
    enter: "Select",
  },
  parent: {
    placeholder: "Search for issue to set as a parent…",
    enter: "Set as parent",
  },
  child: {
    placeholder: "Search for issue to add as a sub-issue…",
    enter: "Add as sub-issue",
  },
};
const INVERSE: Record<string, string> = {
  blocked: "blocking",
  blocking: "blocked",
};
export function Relations({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [peek, setPeek] = useState(false);
  const kind = useStore((s) => s.relation);
  const close = () => ui.send({ type: "overlay.close" });
  const mark = MARK[kind] ?? MARK.related!;
  // Linear leaves out issues the new link would repeat or contradict; "Related issues" offers this issue's related ones first.
  // ponytail: "Recent" is most recently updated; Linear uses recently viewed.
  const linked = new Set(
    (issue.relations ?? [])
      .filter(
        (r) =>
          kind === "related" || r.kind === kind || r.kind === INVERSE[kind],
      )
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
      ranked(
        [...all.values()].filter((i) => fits(i) && !relatedIssues.includes(i)),
      ).slice(0, query ? 40 : 8),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Memo invalidation follows draft identity or relation inputs; render-local helpers would invalidate every render.
    [all, query, kind, issue],
  );
  // cmdk selects the first row as the query changes, so the group holding the best match goes first.
  const relatedFirst =
    !recent[0] ||
    (!!relatedIssues[0] &&
      matchRank(query, relatedIssues[0]) <= matchRank(query, recent[0]));
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
          beginCreate({
            related: { key: issue.key, kind: mark.draft! },
            project: issue.project,
          });
        }
      : kind === "child" && !query && canHaveChildren(get(), issue)
        ? () => {
            close();
            createSubIssue(issue);
          }
        : null;
  // Linear's command-menu footer (BJ-53): → Quick look peeks the highlighted issue beside the list, ← closes it, and
  // ⌥↵ More actions opens that issue's row menu. Both are this menu's own keys, like ↵, so they stay out of the registry.
  const candidate = all.get(selected.replace(/^related:/, ""));
  // Linear's onOpenNestedCommandMenu: the actions open over this menu, Esc comes back to it, and running one closes both.
  const [nested, setNested] = useState<{ issue: Issue; point?: { x: number; y: number } } | null>(null);
  const moreActions = (target: Issue) => {
    const rect = document.querySelector("[cmdk-item][data-selected=true]")?.getBoundingClientRect();
    setNested({ issue: target, point: rect ? { x: rect.right - 200, y: rect.top } : undefined });
  };
  const closingAll = (entries: ActionEntry[]): ActionEntry[] =>
    entries.map((entry) => ({
      ...entry,
      children: entry.children && closingAll(entry.children),
      run: entry.run && (() => (close(), entry.run!())),
    }));
  const row = (i: Issue, group: string) => (
    <Menu.Item
      key={`${group}${i.key}`}
      value={group === "related" ? `related:${i.key}` : i.key}
      onSelect={() => add(i)}
      icon={<StatusIcon status={statusOf(boards, i)} />}
    >
      <span className="mr-2 text-[var(--menu-fg-3)]">{i.key}</span>
      <span className="truncate text-[var(--menu-fg)]">{i.summary}</span>
    </Menu.Item>
  );
  const relatedGroup = relatedIssues.length > 0 && (
    <Menu.Group heading="Related issues">
      {relatedIssues.map((i) => row(i, "related"))}
    </Menu.Group>
  );
  return (
    <>
    {/* Command-style relations retain MenuSurface: Dialog has no command placement variant. */}
    <Modal label="Issue relations" close={close} command width={peek ? 720 + 415 : 720}>
      <Menu
        shouldFilter={false}
        value={selected}
        onValueChange={setSelected}
        data-kind={kind}
        className="flex min-h-0 flex-col"
        // Capture: the menu's own ArrowRight (open a submenu) and cmdk's Enter come after.
        onKeyDownCapture={(e) => {
          const input = e.target as HTMLInputElement;
          if (e.key === "Enter" && e.altKey && candidate) {
            e.preventDefault();
            moreActions(candidate);
          } else if (
            e.key === "ArrowRight" &&
            candidate &&
            !peek &&
            input.selectionStart === input.value?.length
          ) {
            e.preventDefault();
            setPeek(true);
          } else if (e.key === "ArrowLeft" && peek) {
            e.preventDefault();
            setPeek(false);
          }
        }}
      >
        <div className="px-1.5 pt-1.5">
          <Menu.Input
            autoFocus
            aria-label="Find related issue"
            placeholder={mark.placeholder.replace("{key}", issue.key)}
            className="h-10 w-full rounded-xl bg-transparent px-3 text-[13px] text-[var(--menu-fg)] outline-none placeholder:text-[var(--menu-placeholder)]"
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPeek(false);
            }}
          />
        </div>
        <div className="flex min-h-0">
        <div className="min-w-0 flex-1">
        <Menu.List>
          {relatedFirst && relatedGroup}
          {recent.length > 0 &&
            (kind === "parent" && !query ? (
              recent.map((i) => row(i, "recent"))
            ) : (
              <Menu.Group heading={query ? "Issues" : "Recent"}>
                {recent.map((i) => row(i, "recent"))}
              </Menu.Group>
            ))}
          {!relatedFirst && relatedGroup}
          {create && (
            <Menu.Group heading="Create">
              <Menu.Item value="create" onSelect={create}>
                <Icon name="plus" size={16} />
                <span className="flex-1 truncate text-[var(--menu-fg)]">
                  {kind === "child"
                    ? "Add sub-issue…"
                    : `${mark.create} ${issue.key}…`}
                </span>
                {kind === "child" && <Shortcut keys="Mod+Shift+O" />}
              </Menu.Item>
            </Menu.Group>
          )}
          <Menu.Empty>No matching issues</Menu.Empty>
        </Menu.List>
        </div>
        {peek && candidate && <IssuePeek issue={candidate} />}
        </div>
        <div className="mark-footer">
          <span>
            <Keycap size="small">↵</Keycap>
            {selected === "create" ? "Select" : mark.enter}
          </span>
          {candidate && (
            <div className="ml-auto flex">
              <Button variant="borderless" size="small" onClick={() => moreActions(candidate)}>
                <Shortcut keys="Alt+Enter" size="small" /> More actions
              </Button>
              {peek ? (
                <Button variant="borderless" size="small" onClick={() => setPeek(false)}>
                  <Shortcut keys="ArrowLeft" size="small" /> Close
                </Button>
              ) : (
                <Button variant="borderless" size="small" onClick={() => setPeek(true)}>
                  Quick look <Shortcut keys="ArrowRight" size="small" />
                </Button>
              )}
            </div>
          )}
        </div>
      </Menu>
    </Modal>
    {/* A sibling, not a child: the relations menu's capture-phase keys (⌥↵, →, ←) must not see the nested menu's. */}
    {nested && (
      <ActionMenu
        label="More actions"
        point={nested.point}
        close={() => setNested(null)}
        entries={closingAll(
          issueMenuEntries(nested.issue, { close, presentation: "row", openDialog: openIssueDialog(nested.issue) }),
        )}
      />
    )}
    </>
  );
}

/** Quick look in the relations menu: the highlighted issue at Linear's 415px peek width (VK.PEEK_WIDTH). */
function IssuePeek({ issue }: { issue: Issue }) {
  const boards = useStore((s) => s.boards);
  const status = statusOf(boards, issue);
  return (
    <aside
      aria-label="Quick look"
      className="w-[415px] shrink-0 overflow-y-auto border-l border-[var(--menu-line)] p-4"
    >
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <Text variant="mini" color="muted">
          {issue.key}
        </Text>
      </div>
      <Text as="h3" variant="regularPlus" className="mt-2">
        {issue.summary}
      </Text>
      <Text as="p" variant="small" color="muted" className="mt-1">
        {[status.name, issue.assignee?.name ?? "Unassigned", issue.priority ?? "No priority"].join(" · ")}
      </Text>
      {issue.description ? (
        <Text as="p" variant="small" className="mt-3 whitespace-pre-wrap">
          {issue.description}
        </Text>
      ) : null}
    </aside>
  );
}

/** Linear's "add team", for Jira boards: paste a board link or ID; the board mirrors and opens without a reload. */
export function AddBoard() {
  const [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const close = () => ui.send({ type: "overlay.close" });
  return (
    <Dialog label="Add board" close={close} width={440}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const { id, message } = await addBoard(value);
            close();
            navigate({ board: id, selected: null, panel: false });
            showNotification({ text: message });
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text as="label" variant="mini" color="inherit">
          Jira board link or ID
          <TextInput
            autoFocus
            aria-label="Jira board link or ID"
            placeholder="https://your-team.atlassian.net/jira/software/projects/KAN/boards/1"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full mt-2"
          />
        </Text>
        {/* Text has no semantic error color; keep the validation alert styling. */}
        {error ? (
          <p role="alert" className="mt-2 text-[12px] text-red-500">
            {error}
          </p>
        ) : (
          <Text className="mt-2" as="p" variant="mini" color="muted">
            Open the board in Jira and copy its address. Better-jira only reads
            it.
          </Text>
        )}
        <Dialog.Footer>
          <Button
            type="button"
            onClick={close}
            variant="borderless"
            size="medium"
          >
            Cancel
          </Button>
          <Button
            disabled={!value.trim() || busy}
            type="submit"
            variant="borderless"
            size="medium"
          >
            {busy ? "Adding…" : "Add board"}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}

function ComposerBoardMenu({ boards, value, onChange, anchor, close }: { boards: Board[]; value: number; onChange: (board: number) => void; anchor: HTMLElement | null; close: () => void }) {
 return <Modal label="Choose board" anchor={anchor} close={close} fit><Menu><Menu.Input autoFocus aria-label="Choose board" /><Menu.List>{boards.map(board => <Menu.Item key={board.id} value={board.name} checked={board.id === value} onSelect={() => { onChange(board.id); close(); }}>{board.name}</Menu.Item>)}</Menu.List></Menu></Modal>;
}
