import { type Board, type Issue, type IssueDraft, type JiraOptions, type User } from "@/shared/issue-model";
import { EmptyState } from "@/client/components/empty-state";
import { typedResourceURL } from "@/shared/issue-resource";
import { alreadyLinked } from "@/shared/relations";
import { useStoredState, writeStored } from "@/client/state/stored-state";
import { adfToText } from "@/client/features/editor/adf";
import { showNotification } from "@/client/state/app-notifications";
import { Text } from "@/client/components/text";
import { IssuePeek } from "./issue-peek";
import { IssueDescriptionHistory } from "./description-history";
import { Tabs } from "@/client/components/tabs";
import { CountBadge } from "@/client/components/count-badge";
import { Shortcut, Keycap } from "@/client/components/keycap";
import { ConfirmDialog, Dialog } from "@/client/components/dialog";
import { TextInput, NO_AUTOFILL } from "@/client/components/field";
import { Button, IconButton } from "@/client/components/button";
import { createSubIssue, issueMenuEntries, type IssueMenuDialog } from "./issue-menu";
/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { SubIssues, statusOf } from "./sub-issues";
import { attachmentSplit } from "./issue-attachments";
import { SUMMARY_MAX, switchBoard } from "./composer-draft";
import { shortDate } from "@/client/lib/due-date";
import { useHotkey } from "@tanstack/react-hotkeys";
import { createContext, use, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ComposerEditor } from "@/client/features/editor/rich-editor-loader";
import { MediaView } from "@/client/features/media/media-loader";
import { normalizeDocument, documentHasMedia } from "@/shared/document";
import { Icon, PriorityIcon, RelationIcon, StatusIcon, TypeDot } from "@/client/components/icons";
import { Switch } from "@/client/components/switch";
import "./create-issue.css";
import {
  canHaveChildren,
  canParent,
  childTypes,
  matchRank,
  needsParent,
  typeChoices,
} from "@/shared/issue-properties";
import { Avatar } from "@/client/components/avatar";
import { Menu } from "@/client/components/menu";
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
import { usePeople, get, set, useStore } from "@/client/state/store";
import { actions, beginCreate } from "@/client/state/issue-actions";
import { addBoard } from "@/client/state/server-data";
import { addLocalFiles } from "@/client/state/local-database";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import {
  buckets,
  newId,
  type Display,
  type Field,
  type Grouping,
} from "@/shared/view-model";
import { clearPriorityRow, statuses, projectChoices } from "@/shared/board-catalog";
import { epicLocked, epicOf, epicPatch, isEpic } from "@/shared/epics";
import {
  setDisplay,
  setOnlyRule,
  updateRule,
  useViewSettings,
} from "@/client/features/views/view-settings";

export { MenuSurface as Modal } from "@/client/components/menu-surface";
import { MenuSurface as Modal } from "@/client/components/menu-surface";
import { CommandTarget } from "@/client/components/command-menu";
import { IssueResources, ResourceForm } from "./issue-resources";
import { ReactionPicker, ReactionPill } from "@/client/features/comments/reactions";
import { PropertyPill } from "@/client/components/pill-select";
import { ActionMenu, joinGroups, type ActionEntry } from "@/client/components/action-menu";
import { kept, post, run as runCommand, useCommand } from "@/client/features/navigation/commands";

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
      <Button
        data-pending-relation
        variant="secondary"
        size="small"
        icon={<RelationIcon kind={related.kind} />}
        title={title}
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        1 {chip}
      </Button>
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
                        // The chip goes with the relation, so focus moves on to the next chip, as removing a relation
                        // pill does on the issue, instead of falling back out of the dialog to what opened it (R3-create-D8).
                        let next = anchor.nextElementSibling;
                        while (next && !(next instanceof HTMLButtonElement)) next = next.nextElementSibling;
                        setAnchor(null);
                        remove();
                        requestAnimationFrame(() => (next as HTMLElement | null)?.focus());
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
  // Not a <form>: Linear's composer submits only from ⌘↵ and Create issue. A form made Enter in any side field (a link,
  // a pending sub-issue) submit the issue, and nested the custom due date's form, whose Save reloaded the page (R3-create-D1, D3).
  const composerRef = useRef<HTMLDivElement>(null);
  // Where focus goes back to when the link field closes (Linear's Add link… dialog returns it to what opened it).
  const linkReturn = useRef<HTMLElement | null>(null);
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
    const { fromSelection, suggestedAssignees: _suggested, ...fields } = draft;
    const key = actions.create(
      title,
      {
        ...fields,
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
      if (fromSelection) runCommand("issue-from-selection", { id: fromSelection, key });
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
    target: composerRef,
    capture: true,
    ignoreInputs: false,
  });
  // Linear's composer actions run with focus in a field (`runWithInputFocus`): ⌃L Add link… (`cK`), ⌘⇧O Add sub-issue (`hJn`).
  const subIssuesAllowed = canHaveChildren(get(), { type, project });
  const [focusSub, setFocusSub] = useState(-1);
  const addSubIssue = () => {
    setFocusSub(draft.subIssues?.length ?? 0);
    setDraft((d) => ({ ...d, subIssues: [...(d.subIssues ?? []), ""] }));
  };
  const openLink = () => {
    linkReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLinkInput("");
  };
  const closeLink = () => {
    setLinkInput(null);
    requestAnimationFrame(() => (linkReturn.current?.isConnected ? linkReturn.current : titleRef.current)?.focus());
  };
  const addLink = () => {
    // A bare domain becomes https, as the issue's Add link does (Linear accepts `example.com/page`).
    const url = linkInput !== null && typedResourceURL(linkInput);
    if (!url) return;
    setDraft((d) => ({ ...d, resources: [...(d.resources ?? []), { id: crypto.randomUUID(), kind: "link", title: url, url, updated: new Date().toISOString() }] }));
    closeLink();
  };
  useHotkey("Control+L", openLink, { target: composerRef, capture: true, ignoreInputs: false });
  useHotkey("Mod+Shift+O", () => subIssuesAllowed && addSubIssue(), { target: composerRef, capture: true, ignoreInputs: false });
  if (draftsOpen) return <Dialog label="Saved drafts" close={() => setDraftsOpen(false)}>
    <Dialog.Header><Dialog.Title>Saved drafts</Dialog.Title><Dialog.Close /></Dialog.Header>
    <Dialog.Body>
      {saved.length ? saved.map(item => <div key={item.id} className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => { setDraft(item.fields); setTitle(item.title); setDescription(normalizeDocument(item.fields.descriptionDoc)); setAttachments(item.fields.attachments ?? []); setLabels(item.fields.labels?.join(", ") ?? ""); setSavedId(item.id); setDraftIndex(n => n + 1); setDraftsOpen(false); }}>Finish {item.title || "Untitled issue"}</Button>
        <IconButton label={`Delete draft ${item.title || "Untitled issue"}`} onClick={() => setSaved(saved.filter(d => d.id !== item.id))}><Icon name="trash" /></IconButton>
      </div>) : <EmptyState title="No saved drafts" />}
    </Dialog.Body>
  </Dialog>;
  // Linear's has-changes alert (`getHasChangesBehaviorOnCancel`): "Save to drafts?", Save, and Discard as the reject button.
  if (confirmClose) return <ConfirmDialog
    title="Save to drafts?"
    description="You can finish this issue later from your drafts."
    confirmLabel="Save"
    tone="primary"
    confirmDisabled={filesBusy}
    reject={{ label: "Discard", onReject: () => { if (savedId) setSaved(saved.filter(d => d.id !== savedId)); unsent.title = ""; unsent.description = normalizeDocument(""); closeNow(); } }}
    onConfirm={saveDraft}
    close={() => setConfirmClose(false)}
  />;
  const statusId = draft.status ?? board.columns[0]?.statuses[0]?.id ?? "";
  const status = statuses(board).find((s) => s.id === statusId);
  const labelList = labels
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  // The composer's project is its epic, the new issue's Jira parent; a sub-issue's follows its parent (shared/epics.ts).
  const draftEpic = parentIssue && isEpic(parentIssue) ? parentIssue : undefined;
  const epicPill = !epicLocked({ type }) && (!draft.parent || draftEpic);
  // Linear's "…" after the chips (More actions): what the modal can add besides properties.
  const extraActions: ActionEntry[] = [
    ...(subIssuesAllowed
      ? [{ name: "Add sub-issue", icon: "plus" as const, shortcut: "Mod+Shift+O", run: addSubIssue }]
      : []),
    { name: "Add link…", icon: "link", shortcut: "Control+L", run: openLink },
  ];
  // Linear's composer shows copied media in the description; the list holds only files the description doesn't show,
  // as the issue's attachment list does (attachmentSplit), so a copied comment image isn't drawn twice (R3-comments-D6).
  const listed = attachmentSplit({ attachments }, { description }).visible;
  return (
    <Dialog
      label="Create issue"
      close={close}
      width={expanded ? Math.max(640, window.innerWidth - 48) : 640}
    >
      <Attachments attachments={attachments} listed={listed} onChange={setAttachments} onBusy={setFilesBusy}>
      <div ref={composerRef} className="create-issue">
        {/* Linear's fast-create header (`Rr`, a `b8` row): 12px all round, the controls 12px clear of the breadcrumb. */}
        <div className="create-issue-header">
          <Text variant="mini" color="muted" wrap="truncate" className="flex flex-1 items-center gap-1.5">
            <PropertyPill
              label="Board"
              current={board.name}
              value={board.name}
              icon={<Icon name="board" size={14} />}
              menu={ComposerBoardMenu}
              menuProps={{ boards, value: board.id, onChange: (to: number) => setDraft((d) => switchBoard(d, board.id, to)) }}
            />
            <Icon name="chevron" size={10} />
            <Text variant="mini" color="inherit" className="text-fg">
              {initial.parent ? `Sub-issue of ${initial.parent}` : "New issue"}
            </Text>
          </Text>
          {/* `Hr.rightHandContainer`: 12px clear of the breadcrumb, 6px between controls. */}
          <div className="create-issue-header-actions">
          {saved.length > 0 && (
            <Button type="button" variant="borderless" size="small" onClick={() => setDraftsOpen(true)}>
              Saved drafts ({saved.length})
            </Button>
          )}
          <IconButton
            type="button"
            label={expanded ? "Collapse editor" : "Expand editor"}
            onClick={() => setExpanded(!expanded)}
            variant="borderless"
            size="medium"
          >
            <Icon name="expand" />
          </IconButton>
          <Dialog.Close />
          </div>
        </div>
        {/* Linear's body (`$.body`, 0 6px) around the issue editor (`$.issueEditor`, 0 12px): title and description 18px in. */}
        <div className="create-issue-body">
        {/* Linear's fast-create title (dQ, size regular): borderless, 18px semibold. */}
        <input
          {...NO_AUTOFILL}
          ref={titleRef}
          autoFocus
          aria-label="Issue title"
          className="create-issue-title"
          maxLength={SUMMARY_MAX}
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
        />
        <ComposerEditor
          key={draftIndex}
          id="create-description"
          placeholder="Add description…"
          initial={description}
          onChange={setDescription}
          attachments={attachments}
          expanded={expanded}
          tabLeaves
        />
        </div>
        {/* One row of chips, as Linear's: it scrolls sideways rather than wrapping. Its theme is the dialog's elevated once
            more, as Linear's chips paint (BJ-222, control-tokens.css). */}
        <div className="create-issue-properties" data-create-properties data-elevation="dialog-raised">
          {draft.related && (
            <PendingRelation related={draft.related} remove={() => setDraft(({ related: _related, ...rest }) => rest)} />
          )}
          <PropertyPill
            label="Status"
            current={status?.name ?? ""}
            value={status?.name ?? ""}
            icon={status && <StatusIcon status={status} />}
            menu={StatusMenu}
            menuProps={{
              board,
              value: statusId,
              onChange: (status: string) => setDraft({ ...draft, status }),
            }}
          />
          <PropertyPill
            label="Priority"
            current={draft.priority || (writable ? "Default priority" : "Normal")}
            value={draft.priority || (writable ? undefined : "Normal")}
            icon={<PriorityIcon name={draft.priority || (writable ? undefined : "Normal")} />}
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
            value={draft.assignee?.name}
            icon={<Avatar user={draft.assignee ?? null} size={14} />}
            menu={AssigneeMenu}
            menuProps={{
              board,
              value: draft.assignee ?? null,
              suggested: draft.suggestedAssignees,
              onChange: (assignee: User | null) =>
                setDraft({ ...draft, assignee }),
            }}
          />
          {epicPill && (
            <PropertyPill
              label="Project"
              current={draftEpic?.summary ?? "No project"}
              value={draftEpic?.summary}
              icon={<Icon name="layers" size={14} />}
              menu={ProjectMenu}
              menuProps={{
                board,
                project: project?.key,
                value: draftEpic?.key ?? null,
                onChange: (epic: string | null) => setDraft({ ...draft, ...epicPatch(epic) }),
              }}
            />
          )}
          <PropertyPill
            label="Labels"
            current={labels || "No labels"}
            value={labels || undefined}
            icon={<Icon name="label" size={14} />}
            menu={LabelsMenu}
            menuProps={{
              board,
              value: labelList,
              onChange: (value: string[]) => setLabels(value.join(", ")),
            }}
          />
          <PropertyPill
            label="Issue type"
            current={type}
            value={type}
            icon={<TypeDot type={type} />}
            menu={TypeMenu}
            menuProps={{
              board,
              value: type,
              choices: types,
              onChange: (type: string) => setDraft({ ...draft, type }),
            }}
          />
          <PropertyPill
            label="Milestone"
            current={draft.milestones?.[0]?.name ?? "No milestone"}
            value={draft.milestones?.[0]?.name}
            icon={<Icon name="flag" size={14} />}
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
            current={draft.due ? shortDate(draft.due, undefined, true) : "No due date"}
            value={draft.due ? shortDate(draft.due, undefined, true) : undefined}
            icon={<Icon name="calendar" size={14} />}
            menu={DueMenu}
            menuProps={{
              board,
              value: draft.due ?? null,
              onChange: (due: string | null) => setDraft({ ...draft, due }),
            }}
          />
          <ComposerMore entries={extraActions} />
        </div>
        <div className="create-issue-extras">
        {/* Text has no semantic danger color; keep the validation alert styling. */}
        {noParentType && (
          <p role="alert" className="mt-3 text-[12px] text-danger">
            {noParentType}
          </p>
        )}
        {draft.subIssues?.map((summary, index) => <div key={index} className="mt-2 flex items-center gap-2"><TextInput
          // A row added from More actions or ⌘⇧O takes focus, as Linear's new sub-issue editor does.
          autoFocus={index === focusSub}
          maxLength={SUMMARY_MAX}
          aria-label={`Pending sub-issue ${index + 1}`}
          value={summary}
          onChange={e => setDraft(d => ({ ...d, subIssues: d.subIssues?.map((title, i) => i === index ? e.target.value : title) }))}
          // Enter moves on to the next row, or starts one after a titled last row; it never submits the issue (R3-create-D3).
          onKeyDown={e => {
            if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            const next = composerRef.current?.querySelector<HTMLInputElement>(`[aria-label="Pending sub-issue ${index + 2}"]`);
            if (next) next.focus();
            else if (summary.trim()) addSubIssue();
          }}
          placeholder="Sub-issue title"
        /><IconButton type="button" label={`Remove pending sub-issue ${index + 1}`} onClick={() => setDraft(d => ({ ...d, subIssues: d.subIssues?.filter((_, i) => i !== index) }))}><Icon name="close" /></IconButton></div>)}
        {linkInput !== null && <div className="mt-2 flex items-center gap-2"><TextInput
          autoFocus
          aria-label="New issue link URL"
          value={linkInput}
          onChange={e => setLinkInput(e.target.value)}
          // Enter adds the link, as the Add link button (Linear's Add link… dialog confirms on Enter); never the issue (R3-create-D3).
          onKeyDown={e => {
            if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            addLink();
          }}
          placeholder="https://"
        /><Button type="button" variant="secondary" size="medium" disabled={!typedResourceURL(linkInput)} onClick={addLink}>Add link</Button><Button type="button" variant="borderless" size="medium" onClick={closeLink}>Cancel link</Button></div>}
        {draft.resources?.map(resource => <div key={resource.id} className="mt-2 flex items-center gap-2"><Text variant="mini">{resource.title}</Text><IconButton type="button" label={`Remove link ${resource.title}`} onClick={() => setDraft(d => ({ ...d, resources: d.resources?.filter(r => r.id !== resource.id) }))}><Icon name="close" /></IconButton></div>)}
        <Attachments.List />
        </div>
        {/* Linear's footer (`Si`): 0 12px 12px, the paperclip (secondary, medium) at the left 18px clear of Create more
            (small switch) and Create issue at the right. */}
        <div className="create-issue-footer">
          <span>
            <Attachments.Button />
          </span>
          <div className="flex items-center gap-3">
          <Text as="label" variant="mini" color="inherit" className="flex items-center gap-1.5" title="Create more issues">
            <Switch size="small" checked={more} onChange={(e) => setMore(e.target.checked)} />
            Create more
          </Text>
          {/* A plain button: the composer has no form to submit, so the click itself creates the issue. */}
          <Button
            type="button"
            onClick={submit}
            disabled={!title.trim() || filesBusy || !!noParentType}
            variant="primary"
            size="medium"
          >
            {initial.copy ? "Save copy" : "Create issue"}
          </Button>
          </div>
        </div>
      </div>
      </Attachments>
    </Dialog>
  );
}

/** Linear's "…" after the composer chips (More actions, secondary small): what the modal adds besides properties. */
function ComposerMore({ entries }: { entries: ActionEntry[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        label="More actions"
        variant="secondary"
        size="small"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <Icon name="dots" />
      </IconButton>
      {anchor && <ActionMenu label="More actions" anchor={anchor} entries={entries} close={() => setAnchor(null)} />}
    </>
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
/** The open issue's property button a picker opens beside: the focused label chip for labels, else its `prop-<field>` row.
 *  Any other target (a shortcut over a board card, list row or sub-issue row) has none, and Linear opens its command menu. */
function propertyButton(field: IssueField, key: string): HTMLElement | null {
  const s = get();
  if (!s.panel || s.document || s.selected !== key) return null;
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const button =
    (field === "labels" && focused?.closest("[data-properties]") ? focused : null) ??
    document.getElementById(`prop-${field}`);
  return button?.getClientRects().length ? button : null;
}
/** Route before mounting the adapter so only the selected field subscribes. Beside `anchor` (a property button that opened it) or
 *  the open issue's property button; otherwise Linear's command menu on the issue (ISSUE-11). */
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
  const [anchor] = useState(() => trigger ?? propertyButton(field, issue.key));
  const FieldMenu = issueFieldMenus[field];
  const menu = (
    <FieldMenu
      issue={issue}
      anchor={anchor}
      close={done ?? (() => ui.send({ type: "overlay.close" }))}
    />
  );
  return anchor ? menu : <CommandTarget issue={issue}>{menu}</CommandTarget>;
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
  const writable = useStore((s) => s.writable);
  const props = { board, anchor, close };
  const patch = (value: Partial<Issue>) => actions.patch(issue.key, value);
  return (
    <PriorityMenu
      {...props}
      empty={clearPriorityRow(writable)}
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

/** The issue's project is its epic, set through its Jira parent; its Jira project never changes (shared/epics.ts). */
function IssueProjectMenu({ issue, anchor, close }: IssueMenuProps) {
  const board = useStore((s) => s.boards.find((b) => b.id === issue.board));
  const epic = useStore((s) => epicOf(issue, (key) => s.issues.get(key)));
  return (
    <ProjectMenu
      board={board}
      anchor={anchor}
      close={close}
      project={issue.project?.key}
      value={epic ?? null}
      onChange={(next) => {
        // Defence in depth: the triggers hide for an epic or a sub-issue, and Jira would refuse the parent anyway.
        if (!epicLocked(issue) && next !== (epic ?? null)) actions.patch(issue.key, epicPatch(next));
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

/**
 * A board column's or list group's menu, one builder for the header's ⋯ and its right-click.
 * Board column (Linear's IssueList `qu`, whose `actions` and `contextualActions` are one list): Select all in column (when it has
 * issues), Hide column, ┄ Order completed by recency (completed groups, `vo`).
 * List group (useListContextualActions `h`): Collapse/Expand, Collapse all/Expand all (ListCell `toggleAllGroupsAction`),
 * ┄ Select all in group, Hide group, ┄ Order completed by recency. Select all is left out while the group is collapsed.
 */
export function groupMenuEntries({
  unit,
  issues,
  hide,
  completed,
  display,
  collapse,
}: {
  unit: "column" | "group";
  issues: Issue[];
  hide: () => void;
  completed: boolean;
  display: Display;
  /** List groups only: the group's own toggle and the toggle for every group. */
  collapse?: { collapsed: boolean; allCollapsed: boolean; toggle: () => void; toggleAll: () => void };
}): ActionEntry[] {
  const selectable = issues.length > 0 && !collapse?.collapsed;
  return joinGroups(
    collapse
      ? [
          { name: collapse.collapsed ? "Expand" : "Collapse", run: collapse.toggle },
          { name: collapse.allCollapsed ? "Expand all" : "Collapse all", run: collapse.toggleAll },
        ]
      : [],
    [
      ...(selectable
        ? [{ name: `Select all in ${unit}`, run: () => set({ columnSelection: new Set(issues.map((issue) => issue.key)) }) }]
        : []),
      { name: `Hide ${unit}`, run: hide },
    ],
    completed
      ? [
          {
            name: "Order completed by recency",
            selected: display.completedRecency,
            run: () => setDisplay(get().board, { completedRecency: !display.completedRecency }),
          },
        ]
      : [],
  );
}

/** A column header's ⋯; `entries` is read when it opens, as the header's right-click reads it. */
export function GroupMenu({ name, entries }: { name: string; entries: () => ActionEntry[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="ml-auto">
      <IconButton
        label={`Options for ${name}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => {
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
          entries={entries()}
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
  // One dialog for both ways in, as Linear's (`Xz` → `sJt`): Jira's versions and this app's kept revisions together.
  if (historyOpen) return <IssueDescriptionHistory issue={issue} close={close} />;
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

const AttachmentsContext = createContext<{
  attachments: NonNullable<Issue["attachments"]>;
  listed: NonNullable<Issue["attachments"]>;
  onChange: (files: NonNullable<Issue["attachments"]>) => void;
  pick: () => void;
  busy: boolean;
  error: string;
  attach: RefObject<HTMLButtonElement | null>;
} | null>(null);
const useAttachments = () => {
  const context = use(AttachmentsContext);
  if (!context) throw new Error("Attachments parts need an <Attachments> around them.");
  return context;
};

/** The create form's attachments: chosen files are saved locally. The provider owns the file input and its state; the form
 *  places `Attachments.Button` (Linear's paperclip) and `Attachments.List` where its layout wants them. */
function AttachmentsRoot({
  attachments = [],
  listed,
  onChange,
  onBusy,
  children,
}: {
  attachments: Issue["attachments"];
  /** The files the list shows, when the owner draws some of them elsewhere (copied media in the description). */
  listed?: NonNullable<Issue["attachments"]>;
  onChange: (files: NonNullable<Issue["attachments"]>) => void;
  onBusy?: (busy: boolean) => void;
  children: ReactNode;
}) {
  const file = useRef<HTMLInputElement>(null),
    attach = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <AttachmentsContext value={{ attachments, listed: listed ?? attachments, onChange, busy, error, attach, pick: () => file.current?.click() }}>
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
      {children}
    </AttachmentsContext>
  );
}
function AttachButton() {
  const { pick, busy, attach } = useAttachments();
  return (
    <IconButton
      ref={attach}
      label="Attach images, files, or videos"
      tooltip={busy ? "Saving file…" : undefined}
      disabled={busy}
      variant="secondary"
      size="medium"
      onClick={pick}
    >
      <Icon name="paperclip" />
    </IconButton>
  );
}
function AttachmentsBody() {
  const { attachments, listed, onChange, error, attach } = useAttachments();
  // Removing from the shown list keeps the files drawn elsewhere.
  const hidden = attachments.filter((a) => !listed.includes(a));
  return (
    <Text as="div" variant="mini" color="inherit">
      {error && (
        <p role="alert" className="mt-2 text-fg-3">
          {error}
        </p>
      )}
      <AttachmentList attachments={listed} onChange={(files) => onChange([...hidden, ...files])} attachButton={attach} />
    </Text>
  );
}
export const Attachments = Object.assign(AttachmentsRoot, { Button: AttachButton, List: AttachmentsBody });

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
    <Text className="mt-2.5 space-y-3" as="div" variant="mini" color="inherit">
      {/* Linear (RAJ-52): 26px below the last paragraph (the description surface's 16px bottom padding, then 10px), 6px left of the text and 16px above the sub-issues header, reaction pills 8px apart, then the round add-reaction and attach buttons. */}
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
/** Linear's mark-as pickers list 3 recent issues (startup-root sX = 3, and 3 for duplicate). */
const MARK_RECENT = new Set(["related", "blocked", "blocking", "duplicate"]);
export function Relations({ issue }: { issue: Issue }) {
  const all = useStore((s) => s.issues),
    boards = useStore((s) => s.boards);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [peek, setPeek] = useState(false);
  const kind = useStore((s) => s.relation);
  const close = () => ui.send({ type: "overlay.close" });
  const mark = MARK[kind] ?? MARK.related!;
  // Linear's mark-as pickers (startup-root mI): an issue the link would repeat stays out of the 3 recent ones, and a search
  // lists it disabled with the reason (R3-relations-D6). "Related issues" offers this issue's related ones first.
  // ponytail: "Recent" is most recently updated; Linear uses recently viewed.
  const disabled = alreadyLinked(issue.relations, kind);
  const linked = new Set<string>();
  if (kind === "parent" || kind === "child")
    for (const i of all.values())
      if (i.parent === issue.key || i.key === issue.parent) linked.add(i.key);
  // Jira takes a parent only one hierarchy level up in the same project; best match first, so Enter never picks a partial match over an exact one.
  const fits = (i: Issue) =>
    i.key !== issue.key &&
    !linked.has(i.key) &&
    (!!query || !disabled.has(i.key)) &&
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
      ).slice(0, query ? 40 : MARK_RECENT.has(kind) ? 3 : 8),
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
      disabled={disabled.has(i.key)}
      hint={disabled.get(i.key)}
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
        {peek && candidate && <IssuePeek issue={candidate} className="border-l border-[var(--menu-line)]" />}
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
        <Dialog.Body>
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
        </Dialog.Body>
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
