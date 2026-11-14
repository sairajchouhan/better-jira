import { IssueHoverCard } from "@/client/features/issue/issue-hover-card";
import { ActivityEntry, ActivityPropertyRow, LinkedTarget } from "@/client/features/issue/activity-entry";
import { fullTime } from "@/client/features/issue/issue-dates";
import { type Issue } from "@/shared/issue-model";
import { useLocation } from "@tanstack/react-router";
import { pageURL } from "@/client/features/navigation/app-navigation";
import { activityTime as ago } from "@/client/features/issue/issue-dates";
import { DescriptionHistoryProvider } from "@/client/features/issue/description-history";
import { jiraUser, useIssueCreation } from "@/client/features/issue/use-issue-creation";
import { AutoResizingTextArea } from "@/client/components/field";
import { DocumentLoadingState } from "@/client/components/empty-state";
import { showNotification } from "@/client/state/app-notifications";
/* oxlint-disable react/no-unstable-nested-components -- Comment heads and avatars are render callbacks supplied to the activity threads. */
import { FavoriteButton } from "@/client/features/navigation/favorite-button";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { type Attachment } from "@/shared/attachment-media";
import { ReminderControl } from "@/client/features/reminders/reminders";
import { CommentThreads, useCommentDraft, useDraftFiles } from "@/client/features/comments/comment-threads";
import { ImageCommentCard } from "@/client/features/media/image-thread";
import { linkTitle } from "@/shared/issue-resource";
import { activityEvents, type ActivityEvent, type Relation } from "@/client/features/issue/issue-activity";
import { ActivityRun, type ActivityItem } from "@/client/features/issue/activity-entry";
import { summaryItems } from "@/client/features/issue/activity-collapse";
import { mergeHistory } from "@/client/features/issue/jira-history";
import { useIssueHistory } from "@/client/features/issue/use-issue-history";
import { normalizeDocument } from "@/shared/document";
import { imageCommentIds } from "@/client/features/media/media-edits";
import { DueIcon, Icon, PriorityIcon, StatusIcon, TypeDot, hue } from "@/client/components/icons";
import { ME, boardOf, get, useStore, isWatching, statusOf } from "@/client/state/store";
import { issueURL, jiraIssueURL } from "@/client/features/issue/issue-urls";
import { LINEAR_RELATIONS, relationSections } from "@/shared/relations";
import { AppLink } from "@/client/features/navigation/app-link";
import { actions, addIssueFiles } from "@/client/state/issue-actions";
import { loadFull } from "@/client/state/server-data";
import { currentKey, firstKey } from "@/client/state/jira-sync";
import { flushLocalChanges } from "@/client/state/local-database";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import { interruptedUploads } from "@/client/state/jira-media";
import { listPosition, navigationIssues, visibleOrder } from "@/shared/view-model";
import { epicLocked, epicName, epicOf } from "@/shared/epics";
import { PersonalIssueDetails } from "@/client/features/issue/personal-controls";
import { SubIssueOf } from "@/client/features/issue/sub-issues";
import { Avatar } from "@/client/components/avatar";
import { DocumentBodyEditor, CommentComposer } from "@/client/features/editor/rich-editor-loader";
import { hotkeyOf, runShortcut } from "@/client/features/navigation/shortcuts";
import { shortcutTitle } from "@/client/components/keycap";
import { post, useCommand, focusNode } from "@/client/features/navigation/commands";
import { InboxIssueActions, InboxIssueGroup } from "./inbox";
import { useCommentsSeen, useIssueVisit } from "@/client/features/inbox/issue-visit";
import { SplitPanel } from "@/client/features/issue/split-panel";
import { descriptionNotice, descriptionSession, type DescriptionPorts } from "@/client/features/issue/description-session";
import { shortDate } from "@/client/lib/due-date";
import { BoardBreadcrumbs } from "@/client/features/navigation/app-chrome";
import { Button, IconButton } from "@/client/components/button";
import { ContextMenu, type ActionEntry } from "@/client/components/action-menu";
import { copyIssue, copyIssueLink } from "@/client/features/issue/issue-copy";
import { PropertyTrigger } from "@/client/components/property-trigger";
import { LabelChip } from "@/client/components/label-chip";
import { Text } from "@/client/components/text";
import { EntityIdentifier } from "@/client/components/entity-identifier";
// Loaded with the page, as Linear's preview (PBe) is: a lazy viewer suspends, and React's Suspense throttle holds it ~300ms (BJ-233).
import { ImageViewer } from "@/client/features/media/image-viewer";

const related = (target: Issue) => ({ board: target.board, selected: target.key, panel: true, view: get().view });

// --- issue view: a full page, a side panel, or the inbox's pane; the route picks the frame ---

/** The `/issue/KEY-1` route: the open issue as a page. Opened from the inbox, it carries the notification's actions and no
 *  board stepper: Linear's counter is the issue list's (`jf` in IssueList, its `siblingModels`), and its inbox header holds only
 *  `InboxActionControls`. */
export function IssueScreen() {
  const open = useStore((s) => (s.panel && s.selected && !s.document ? s.issues.get(s.selected) : undefined));
  const inbox = useStore((s) => s.inbox);
  if (!open) return null;
  return inbox ? (
    <IssuePage key={firstKey(open.key)} issue={open} actions={<InboxIssueActions />} />
  ) : (
    <IssuePage key={firstKey(open.key)} issue={open} navigation={<Stepper issueKey={open.key} />} />
  );
}

const closePanel = () => navigate({ panel: false });
const SIDE =
  "issue-detail flex flex-col bg-panel max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full";

/** The issue as a full page: breadcrumbs lead the header. `actions` are the inbox's notification actions when it opened there;
 *  `navigation` is the list stepper when it opened from one. */
export const IssuePage = memo(function IssuePage({
  issue,
  actions,
  navigation,
}: {
  issue: Issue;
  actions?: ReactNode;
  navigation?: ReactNode;
}) {
  return (
    <div className="issue-detail flex min-w-0 flex-1 flex-col" data-mode="page">
      <IssueHeader issue={issue} switchTo="side" actions={actions} navigation={navigation}>
        <BoardBreadcrumbs board={boardOf(issue.key)!} issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} />
    </div>
  );
});
/** The issue beside the board in Linear's resizable split panel. */
export const IssueSidePanel = memo(function IssueSidePanel({ issue }: { issue: Issue }) {
  return (
    <SplitPanel className={SIDE} data-mode="side" onClose={closePanel}>
      <IssueHeader issue={issue} switchTo="page" navigation={<Stepper issueKey={issue.key} />}>
        <IssueKey issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} />
    </SplitPanel>
  );
});
/** The issue filling the inbox's right pane, with the notification's snooze and delete and no board stepper (see
 *  `IssueScreen`). The notification's group leads the issue in the same scroller, so a long unfolded group never hides it. */
export const InboxIssuePane = memo(function InboxIssuePane({ issue }: { issue: Issue }) {
  return (
    <aside className={`${SIDE} min-w-0 flex-1`} data-mode="side">
      <IssueHeader issue={issue} switchTo="page" actions={<InboxIssueActions />}>
        <IssueKey issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} lead={<InboxIssueGroup />} />
    </aside>
  );
});

function IssueKey({ issue }: { issue: Issue }) {
  return (
    <>
      <TypeDot type={issue.type} />
      <a
        className="text-fg-2 hover:text-fg"
        href={issueURL(issue)}
        target="_blank"
        rel="noreferrer"
      >
        <EntityIdentifier>{issue.key}</EntityIdentifier>
      </a>
    </>
  );
}

/** The 44px bar: what leads it (`children`), favorite, Issue options, reminder, the frame's `actions`, its `navigation` (the
 *  list stepper), the switch to the other layout and close. */
function IssueHeader({
  issue,
  switchTo,
  actions,
  navigation,
  children,
}: {
  issue: Issue;
  switchTo: "page" | "side";
  actions?: ReactNode;
  navigation?: ReactNode;
  children: ReactNode;
}) {
  const optionsOpen = useStore((s) => s.overlay === "options");
  return (
    <div className="issue-detail-header flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-fg-3">
      {children}
      <FavoriteButton id={issue.key} noun="issue" className="shrink-0" />
      <IconButton
        id="issue-options"
        label="Issue options"
        variant="muted"
        aria-expanded={optionsOpen}
        onClick={() => ui.send({ type: "overlay.open", overlay: "options" })}
      >
        <Icon name="dots" />
      </IconButton>
      <ReminderControl issue={issue} />
      {actions}
      <span className="flex-1" />
      {navigation}
      <IconButton
        label={switchTo === "side" ? "Open in side panel" : "Open as full page"}
        variant="muted"
        onClick={() => navigate({ view: switchTo })}
      >
        <Icon name={switchTo === "side" ? "side" : "expand"} />
      </IconButton>
      <IconButton label="Close" shortcut="Escape" variant="muted" onClick={closePanel}>
        <Icon name="close" />
      </IconButton>
    </div>
  );
}

const COPY_ACTIONS = [
  ["copy-url", "Copy issue URL", "link"],
  ["copy-id", "Copy issue ID", "copy"],
  ["copy-branch", "Copy git branch name", "branch"],
] as const;
/** Every frame's body, one scroller: the copy toolbar, the frame's `lead` (the inbox's notification group), then title,
 *  properties and content in the detail grid. */
function IssueBody({ issue, lead }: { issue: Issue; lead?: ReactNode }) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const propertiesHidden = useStore((s) => s.issuePropertiesHidden);
  // Reading the issue reads its notifications, as Linear's issue view does (B6); the inbox's pane reads by its own rule.
  const body = useRef<HTMLDivElement>(null);
  useIssueVisit(issue.key, issue.comments);
  useCommentsSeen(issue.key, body);
  return (
    <div ref={body} className="issue-detail-body" data-scroll-restoration-id="issue-body">
      <div role="toolbar" aria-label="Copy issue" className="issue-copy-toolbar">
        {COPY_ACTIONS.map(([action, label, icon]) => (
          <IconButton
            key={action}
            label={label}
            shortcut={hotkeyOf(action)}
            variant="muted"
            onClick={() => runShortcut(action)}
          >
            <Icon name={icon} />
          </IconButton>
        ))}
      </div>
      {lead}
      <div className="issue-detail-grid" data-properties-hidden={propertiesHidden || undefined}>
        <div className="issue-detail-title">
          <Title key={issue.key} issue={issue} />
          <SubIssueOf issue={issue} />
        </div>
        {!propertiesHidden && (
          <div className="issue-detail-properties">
            <Properties issue={issue} />
          </div>
        )}
        <div className="issue-detail-content">
          <Description issue={issue} />
          <PersonalIssueDetails issue={issue} />
          <Activity issue={issue} f={f} />
        </div>
      </div>
    </div>
  );
}

/** Linear shows position, then next and previous, within the current visible view, and nothing when the issue isn't in it or
 *  it holds only this issue (see `listPosition`). */
function Stepper({ issueKey }: { issueKey: string }) {
  const order = useStore((s) => visibleOrder(s, ME.id));
  const position = useMemo(() => listPosition(navigationIssues(order), issueKey), [order, issueKey]);
  if (!position) return null;
  const { index, total } = position;
  return (
    <div className="mr-1 flex items-center gap-0.5">
      <span aria-label="Issue position" className="mr-2 whitespace-nowrap tabular-nums text-fg-3 max-sm:hidden">
        {index + 1}
        <span className="text-fg-4"> / {total}</span>
      </span>
      <IconButton
        label="Next"
        shortcut="J"
        alternate="ArrowDown"
        variant="muted"
        disabled={index >= total - 1}
        onClick={() => runShortcut("down")}
      >
        <Icon name="down" />
      </IconButton>
      <IconButton label="Previous" shortcut="K" alternate="ArrowUp" variant="muted" disabled={index === 0} onClick={() => runShortcut("up")}>
        <Icon name="up" />
      </IconButton>
    </div>
  );
}

/** A Jira-side rename shows at once unless the title is being edited; leaving it saves only typed text. */
function Title({ issue }: { issue: Issue }) {
  const ref = useRef<HTMLTextAreaElement>(null),
    start = useRef("");
  const [draft, setDraft] = useState<string | null>(null);
  useCommand("focus-title", (key) => {
    if (key !== issue.key) return;
    const node = ref.current;
    if (!node) return;
    node.focus();
    // Linear puts the caret at the end, so typing appends (R2-issue-fields-D6).
    node.setSelectionRange(node.value.length, node.value.length);
    return true;
  });
  return (
    <AutoResizingTextArea
      appearance="heading"
      ref={ref}
      id="summary"
      aria-label="Issue title"
      key={issue.key}
      value={draft ?? issue.summary}
      onChange={e => setDraft(e.target.value)}
      rows={1}
      onFocus={(e) => { start.current = e.target.value; setDraft(e.target.value); }}
      onBlur={(e) => {
        // Only an edit saves: an unchanged field never writes back a title Jira has since replaced.
        if (e.target.value !== start.current) actions.summary(issue.key, e.target.value);
        // An empty title isn't saved: show the current one again.
        e.target.value = get().issues.get(issue.key)?.summary ?? issue.summary;
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.currentTarget.value = start.current;
          e.currentTarget.blur();
        }
      }}
      className="rounded-md"
    />
  );
}

/** A relation in the sidebar: its pill, a remove button on hover, and Linear's context menu (BJ-52): Change to…, Remove
 *  relation, Copy link. A Jira link kind Linear lacks changes to any of Linear's kinds. */
function RelationRow({ issueKey, relation }: { issueKey: string; relation: Relation }) {
  const { key: relatedKey, kind } = relation;
  const remove = () => {
    actions.relate(issueKey, relatedKey, kind, true);
    // Focus stays in the issue, as after removing a resource: the next relation, else Issue options.
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>("[data-relation] a") ??
        document.getElementById("issue-options")
      )?.focus(),
    );
  };
  const entries = (): ActionEntry[] => {
    const related = get().issues.get(relatedKey);
    const items: ActionEntry[] = [
      {
        name: "Change to…",
        icon: "flag",
        children: LINEAR_RELATIONS.filter(([k]) => k !== kind).map(([to, name]) => ({
          name,
          run: () => actions.changeRelation(issueKey, relatedKey, kind, to),
        })),
      },
      { name: "Remove relation", icon: "close", run: remove },
    ];
    items.push({
        name: "Copy link",
        icon: "link",
        divider: true,
        run: () => void (related ? copyIssue("URL", related) : copyIssueLink(jiraIssueURL(relatedKey))),
      });
    return items;
  };
  return (
    <ContextMenu label="Relation options" entries={entries}>
      <div
        data-relation={`${kind}:${relatedKey}`}
        className="group/relation flex max-w-full items-center gap-2"
      >
        <RelatedIssue relation={relation} />
        <IconButton
          label="Remove relation"
          variant="borderless"
          size="small"
          className="opacity-0 group-hover/relation:opacity-100 focus-visible:opacity-100"
          onClick={remove}
        >
          <Icon name="close" />
        </IconButton>
      </div>
    </ContextMenu>
  );
}
/** A related issue's pill, like Linear's (IssueDetailsPaneSidebar: status icon, then title). A mirrored issue opens here;
 *  one outside the mirrored boards shows the status and title Jira sent with the link and opens in Jira, the only place
 *  this app can show it (BJ-15). Without either, its key. */
function RelatedIssue({ relation }: { relation: Relation }) {
  const target = useStore((s) => s.issues.get(relation.key));
  if (target) {
    const status = statusOf(target);
    return (
      <IssueHoverCard relation={relation} issue={target} placement="left"><AppLink to={related(target)} className="relation-pill">
        <span>{status && <StatusIcon status={status} />}</span>
        <span className="truncate">{target.summary}</span>
      </AppLink></IssueHoverCard>
    );
  }
  const linked = relation.issue;
  return (
    <IssueHoverCard relation={relation} placement="left"><a
      href={jiraIssueURL(relation.key)}
      target="_blank"
      rel="noreferrer"
      className="relation-pill"
    >
      <span>{linked?.status && <StatusIcon status={linked.status} />}</span>
      <span className="truncate">{linked?.summary ?? relation.key}</span>
    </a></IssueHoverCard>
  );
}
type PropertyOverlay =
  "status" | "assign" | "priority" | "type" | "labels" | "project" | "milestone" | "due";
/** A read-only property (Jira can't change it): the trigger's text and icon box without the button. */
const READ_ONLY =
  "ml-px flex h-7 max-w-full items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-fg-2 [&>:first-child]:grid [&>:first-child]:size-4 [&>:first-child]:place-items-center";
/** Linear's DetailButton: with `overlay` it opens that menu, stays highlighted while it is open (Opus review 4), and its
 *  tooltip names the action and its key; without, it is read-only text. `children` is the value or placeholder. */
function PropertyPill({
  id,
  overlay,
  tip,
  title,
  state = "value",
  icon,
  children,
}: {
  id: string;
  overlay?: PropertyOverlay;
  tip?: string;
  title?: string;
  state?: "empty" | "value";
  icon: ReactNode;
  children: ReactNode;
}) {
  const open = useStore((s) => !!overlay && s.overlay === overlay);
  if (!overlay)
    return (
      <span id={id} title={title} className={READ_ONLY}>
        <span>{icon}</span>
        <span className="truncate">{children}</span>
      </span>
    );
  return (
    <PropertyTrigger
      id={id}
      state={state}
      aria-expanded={open}
      title={tip ? shortcutTitle(tip, hotkeyOf(overlay)) : undefined}
      onClick={() => ui.send({ type: "overlay.open", overlay })}
      className="ml-px"
    >
      <PropertyTrigger.Icon>{icon}</PropertyTrigger.Icon>
      <PropertyTrigger.Label>{children}</PropertyTrigger.Label>
    </PropertyTrigger>
  );
}
function PropertySection({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-1 [&+section]:mt-[33px]">
      <Text as="h3" variant="smallPlus" color="muted" className="mb-1.5 px-2">{name}</Text>
      {children}
    </section>
  );
}
/** A label wide enough for the side panel, shortened in a narrow one. */
const Placeholder = ({ wide, short }: { wide: string; short: string }) => (
  <>
    <span className="property-wide">{wide}</span>
    <span className="property-short">{short}</span>
  </>
);
/** Linear's project row, mapped to the issue's epic (shared/epics.ts): a standard issue picks it; an epic (its own project) and a
 *  sub-issue (its parent's) show it read-only, with why. The Jira project is never changed here. */
function ProjectProperty({ issue }: { issue: Issue }) {
  const epic = useStore((s) => epicOf(issue, (key) => s.issues.get(key)));
  const name = useStore((s) => (epic ? epicName(epic, (key) => s.issues.get(key)) : undefined));
  const locked = epicLocked(issue);
  return locked ? (
    <PropertyPill id="prop-project" title={locked} icon={<Icon name="layers" />}>
      {name ?? "No project"}
    </PropertyPill>
  ) : (
    <PropertyPill
      id="prop-project"
      overlay="project"
      tip={epic ? "Move to project" : "Add to project"}
      state={epic ? "value" : "empty"}
      icon={<Icon name="layers" />}
    >
      {name ?? <Placeholder wide="Add to project" short="Project" />}
    </PropertyPill>
  );
}
function Properties({ issue }: { issue: Issue }) {
  const status = statusOf(issue);
  return (
    <div data-properties className="text-[13px] font-medium">
      <PropertySection name="Properties">
        <PropertyPill
          id="prop-status"
          overlay="status"
          tip="Change status"
          icon={status && <StatusIcon status={status} />}
        >
          {status?.name}
        </PropertyPill>
        <PropertyPill
          id="prop-priority"
          overlay="priority"
          tip={issue.priority ? "Change priority" : "Set priority"}
          state={issue.priority ? "value" : "empty"}
          icon={<PriorityIcon name={issue.priority} />}
        >
          {issue.priority ?? <Placeholder wide="Set priority" short="Priority" />}
        </PropertyPill>
        <PropertyPill
          id="prop-assignee"
          overlay="assign"
          tip="Assign to"
          state={issue.assignee ? "value" : "empty"}
          icon={<Avatar user={issue.assignee} size={16} />}
        >
          {issue.assignee?.name ?? "Unassigned"}
        </PropertyPill>
        <PropertyPill
          id="prop-type"
          overlay="type"
          tip="Change issue type"
          state={issue.type ? "value" : "empty"}
          icon={<TypeDot type={issue.type} />}
        >
          {issue.type ?? "Issue type"}
        </PropertyPill>
        {issue.due && (
          <PropertyPill
            id="prop-due"
            overlay="due"
            tip="Change due date"
            icon={<DueIcon due={issue.due} resolved={issue.resolved} />}
          >
            {shortDate(issue.due, undefined, true)}
          </PropertyPill>
        )}
      </PropertySection>
      {/* Linear (RAJ-52): one 25px chip per label, its dot and name, then a round + button; clicking either opens the label menu beside it. */}
      <PropertySection name="Labels">
        {issue.labels.length ? (
          <div className="flex min-h-7 max-w-full flex-wrap gap-1.5 pt-0.5 pl-[1.5px]">
            {issue.labels.map((label) => (
              <LabelChip
                key={label}
                as="button"
                data-label-chip
                onClick={() => ui.send({ type: "overlay.open", overlay: "labels" })}
              >
                <LabelChip.Dot color={hue(label)!} />
                <LabelChip.Text>{label}</LabelChip.Text>
              </LabelChip>
            ))}
            <IconButton
              label="Add label"
              size="small"
              id="prop-labels"
              onClick={() => ui.send({ type: "overlay.open", overlay: "labels" })}
              appearance="label"
            >
              <Icon name="plus" size={14} />
            </IconButton>
          </div>
        ) : (
          <PropertyPill
            id="prop-labels"
            overlay="labels"
            tip="Add labels"
            state="empty"
            icon={<Icon name="label" />}
          >
            <Placeholder wide="Add label" short="Labels" />
          </PropertyPill>
        )}
      </PropertySection>
      <PropertySection name="Project">
        <ProjectProperty issue={issue} />
        {issue.milestones?.length ? (
          <PropertyPill id="prop-milestone" overlay="milestone" icon={<Icon name="calendar" />}>
            {issue.milestones.map((m) => m.name).join(", ")}
          </PropertyPill>
        ) : null}
      </PropertySection>
      {/* Linear (RAJ-52): a section per relation kind after Project, each related issue a 28px pill (its status and title) with a round remove button on hover. */}
      {/* Linear's sections in its order, then any other Jira link kind under Jira's own phrase ("Is caused by"). */}
      {relationSections(issue.relations ?? []).map(({ kind, heading, rows }) => (
        <PropertySection key={kind} name={heading}>
          {rows.map((r) => (
            <RelationRow key={r.key} issueKey={issue.key} relation={r} />
          ))}
        </PropertySection>
      ))}
    </div>
  );
}

const descriptionPorts: DescriptionPorts = {
  storage: {
    getItem: (name) => localStorage.getItem(name),
    setItem: (name, value) => localStorage.setItem(name, value),
    removeItem: (name) => localStorage.removeItem(name),
  },
  read: (key) => get().full.get(key)?.fields.description,
  refused: (key) => {
    const f = get().full.get(key);
    return descriptionNotice(false, !!f?.descriptionRejected, f?.descriptionError).held;
  },
  write: (key, doc) => actions.description(key, doc),
  discard: (key, unsaved) => actions.discardDescription(key, unsaved),
  persist: flushLocalChanges,
  currentKey,
};

/** Edited in place like Linear: changes save 600ms after typing stops and on blur, so a reload never loses them. */
function Description({ issue }: { issue: Issue }) {
  const [focusRevision, setFocusRevision] = useState<number | null>(null);
  const focusObserver = useRef<MutationObserver | null>(null);
  useEffect(() => () => focusObserver.current?.disconnect(), []);
  useCommand("edit-description", (key) => {
    if (key !== issue.key) return;
    const editor = section.current?.querySelector<HTMLElement>("#description");
    setFocusRevision(session.getSnapshot().revision);
    focusObserver.current?.disconnect();
    if (editor) editor.focus();
    else if (section.current) {
      const observer = new MutationObserver(() => {
        if (focusNode(section.current?.querySelector<HTMLElement>("#description"))) observer.disconnect();
      });
      observer.observe(section.current, { childList: true, subtree: true });
      focusObserver.current = observer;
    }
    return true;
  });
  const f = useStore((s) => s.full.get(issue.key));
  const error = useStore((s) => s.fullErrors.get(issue.key));
  // A description Jira refused stays in the editor (beside Jira's copy in the store) until a version is picked or it is edited.
  const content = f ? (f.descriptionRejected ?? f.fields.description ?? "") : undefined;
  // Normalizing and serializing the whole document is only redone when Jira's copy (or the refused one) changes.
  const stored = useMemo(
    () => (content !== undefined ? JSON.stringify(normalizeDocument(content)) : ""),
    [content],
  );
  const section = useRef<HTMLElement>(null),
    [focused, setFocused] = useState(false);
  const [session] = useState(() =>
    descriptionSession({ key: issue.key, namespace: get().namespace, stored }, descriptionPorts),
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot),
    { revision, draft, conflict } = snapshot;
  // Jira's text changed under unsaved typing; or Jira refused the save because someone else changed it. Saves wait until the person picks a version.
  const { held, message } = descriptionNotice(conflict, !!f?.descriptionRejected, f?.descriptionError);
  // Re-observed on focus changes too: a focused editor keeps its own text until it blurs.
  useEffect(() => {
    if (session.observe(stored, !!section.current?.contains(document.activeElement)))
      post("edit-description", issue.key);
  }, [stored, focused, snapshot, session, issue.key]);
  useEffect(() => {
    const restore = (event: Event) => {
      if ((event as CustomEvent<string>).detail === issue.key) session.restored();
    };
    addEventListener("jira-restored", restore);
    return () => removeEventListener("jira-restored", restore);
  }, [issue.key, session]);
  const resolve = (keep: boolean) => {
    session.resolve(keep);
    // Back to the editor, not the page: typing must not run board shortcuts (R2-D5).
    post("edit-description", issue.key);
  };
  const loaded = !!f;
  useEffect(() => {
    if (loaded) session.recover(stored);
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Draft recovery follows the load transition, not each refreshed description.
  }, [loaded, session]);
  // Files that were uploading when the page reloaded reached Jira's attachments, if anything, but not the text (R2-D9).
  useEffect(() => {
    const names = interruptedUploads(issue.key);
    if (names.length)
      showNotification({
        text: `${names.join(", ")} ${names.length > 1 ? "weren't" : "wasn't"} placed`,
        detail:
          "The page reloaded during the upload. Check the issue's attachments in Jira, then attach it again.",
      });
  }, [issue.key]);
  useEffect(() => () => session.flush(), [session]);
  return (
    <section
      ref={section}
      className="issue-description mt-[14px] leading-[1.6] text-fg-2"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {message && (
        <div
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-line-2 bg-card px-3 py-2 text-[13px]"
        >
          <span className="mr-auto">{message}</span>
          <Button variant="secondary" size="small" onClick={() => resolve(false)}>
            Use Jira's version
          </Button>
          {held && (
            <Button size="small" onClick={() => resolve(true)}>
              Keep mine
            </Button>
          )}
        </div>
      )}
      {!f ? (
        error ? (
          <Text as="p" role="status" variant="small" color="faint">
            {error}.{" "}
            <Button variant="link" size="small" onClick={() => void loadFull(issue.key)}>
              Retry
            </Button>
          </Text>
        ) : <DocumentLoadingState />
      ) : (
        <DocumentBodyEditor
          key={revision}
          autoFocus={focusRevision === revision}
          id="description"
          scope={`${issue.key}:description`}
          onLateMedia={session.lateMedia}
          initial={draft ?? content}
          onFiles={(files) => addIssueFiles(issue.key, files)}
          issueKey={issue.key}
          attachments={issue.attachments}
          placeholder="Add description…"
          onChange={session.edit}
          onBlur={session.flush}
        />
      )}
    </section>
  );
}

/** A timestamp that links to its own Activity entry: the compact time, the exact time as its tooltip. */
function Timestamp({ date, id }: { date: string; id: string }) {
  useLocation({ select: (location) => location.href });
  const url = pageURL(id);
  return (
    <a
      href={url}
      title={fullTime(date)}
      aria-label={fullTime(date)}
      data-tip="above"
      className="hover:text-fg-2 focus-visible:outline-offset-[-1px]"
    >
      <time dateTime={date}>{ago(date)}</time>
    </a>
  );
}
const timestamp = (date: string, id: string) => <Timestamp date={date} id={id} />;

/** One Activity entry other than a comment thread: an image's comment thread, a property row or an attached link. */
function ActivityEventItem({
  event,
  issue,
  viewImage,
}: {
  event: ActivityEvent;
  issue: Issue;
  viewImage: (mediaId: string, src: string | undefined) => void;
}) {
  if (event.kind === "image-thread") {
    const src = issue.attachments?.find((file) => file.id === event.id)?.url || event.edit.src;
    return (
      <ImageCommentCard
        comments={event.edit.comments}
        src={src}
        author={ME.name}
        me={<Avatar user={ME} size={18} />}
        head={(c) => (
          <>
            <Avatar user={ME} size={18} />
            <span className="font-medium text-fg">{c.author}</span>
            <Timestamp date={c.at} id={`image-comment-${c.id}`} />
          </>
        )}
        save={(comments) => actions.mediaEdit(issue.key, event.id, { ...event.edit, comments })}
        view={() => viewImage(event.id, event.edit.src)}
      />
    );
  }
  if (event.kind === "property") {
    const { row } = event;
    return (
      <ActivityPropertyRow row={row} issue={issue}>
        <Timestamp date={row.at} id={`activity-${row.id}`} />
      </ActivityPropertyRow>
    );
  }
  const { resource } = event;
  return (
    <ActivityEntry
      id={`activity-${resource.id}`}
      data-activity="link"
      icon={<Avatar user={ME} size={14} />}
      time={<Timestamp date={resource.created} id={`activity-${resource.id}`} />}
    >
      <span className="font-medium">{ME.name}</span> linked <LinkedTarget title={linkTitle(resource)} url={resource.url} />
    </ActivityEntry>
  );
}

function Activity({ issue, f }: { issue: Issue; f: any }) {
  const composerFiles = useDraftFiles(issue.key),
    draft = useCommentDraft(issue.key);
  const subscribersRef = useRef<HTMLButtonElement>(null),
    commentRef = useRef<HTMLDivElement>(null);
  useCommand("change-subscribers", (key) => {
    if (key !== issue.key || !focusNode(subscribersRef.current)) return;
    // Opened after the focus, so the menu anchors on the button and hands focus back to it.
    ui.send({ type: "overlay.open", overlay: "subscribers" });
    return true;
  });
  const commentFocus = useRef<MutationObserver | null>(null);
  useEffect(() => () => commentFocus.current?.disconnect(), []);
  useCommand("focus-comment", (key) => {
    if (key !== issue.key || !commentRef.current) return;
    commentFocus.current?.disconnect();
    if (focusNode(commentRef.current.querySelector<HTMLElement>("#comment"))) return true;
    // The lazy editor owns its DOM after it loads; observe that mount rather than polling frames.
    const observer = new MutationObserver(() => {
      if (focusNode(commentRef.current?.querySelector<HTMLElement>("#comment"))) observer.disconnect();
    });
    observer.observe(commentRef.current, { childList: true, subtree: true });
    commentFocus.current = observer;
    return true;
  });
  const followedAnchor = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!f || !location.hash) return;
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (target && target !== followedAnchor.current) {
        target.scrollIntoView({ block: "center" });
        followedAnchor.current = target;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [f]);
  const subscribed = isWatching(issue);
  /** An image comment whose image was removed from the description opens the image on its own. */
  const [viewing, setViewing] = useState<{ file: Attachment; external: boolean }>();
  const viewImage = (mediaId: string, src: string | undefined) => {
    const frame = document.querySelector<HTMLElement>(`[data-media-id="${CSS.escape(mediaId)}"]`);
    if (frame) {
      frame.scrollIntoView({ block: "center" });
      frame.dispatchEvent(new Event("show-image-comments"));
      return;
    }
    const file = issue.attachments?.find((file) => file.id === mediaId);
    const url = file?.url || src;
    if (url)
      setViewing({
        file: file ?? { id: mediaId, name: "Image", type: "image/png", size: 0, url },
        external: !file,
      });
  };
  // Jira's whole history arrives after the details (BJ-13); until then the Activity shows this app's own edits.
  const history = useIssueHistory(issue.key, f?.updated);
  const comments: any[] | undefined = f?.comment?.comments;
  const activity = useMemo(() => mergeHistory(issue.activity ?? [], history), [issue.activity, history]);
  const events = useMemo(
    () =>
      activityEvents(
        { ...issue, activity },
        // Linear groups only adjacent history entries, so a comment thread between two changes keeps them apart.
        (comments ?? []).flatMap((comment) => (comment.parentId ? [] : [comment.created])),
        ME,
      ),
    [issue, activity, comments],
  );
  // Linear's Activity starts with "created"; it opens the first run, so a long history folds after it.
  const creation = useIssueCreation(issue, f);
  const items: ActivityItem[] = creation
    ? [
        {
          at: creation.at,
          anchor: "issue-created",
          summary: [],
          node: (
            <ActivityEntry
              key="issue-created"
              id="issue-created"
              icon={<Avatar user={creation.actor} size={14} />}
              time={<Timestamp date={creation.at} id="issue-created" />}
            >
              <span className="font-medium">{creation.actor?.name}</span> created
            </ActivityEntry>
          ),
        },
        ...events.map((event) => ({
          at: event.at,
          anchor: `activity-${event.id}`,
          summary:
            event.kind === "property"
              ? summaryItems([...event.row.events, ...event.row.chain])
              : event.kind === "link"
                ? [{ action: "added" as const, value: "links", weight: 2 as const }]
                : [],
          node: <ActivityEventItem key={event.id} event={event} issue={issue} viewImage={viewImage} />,
        })),
      ]
    : [];
  if (!f) return null;
  const imageComments = imageCommentIds(issue.mediaEdits);
  return (
    <section className="issue-activity mt-4 border-t border-line pt-[18px]">
      {viewing && (
        <ImageViewer
          file={viewing.file}
          original={viewing.file}
          external={viewing.external}
          editable
          readReason=""
          issueKey={issue.key}
          close={() => setViewing(undefined)}
        />
      )}
      <div className="mb-[14px] flex h-8 items-center gap-3">
        <Text as="h3" variant="regularPlus" className="mr-auto">
          Activity
        </Text>
        <Button
          variant="muted"
          size="medium"
          aria-label={subscribed ? "Unsubscribe from issue" : "Subscribe to issue"}
          tooltip={subscribed ? "Unsubscribe" : "Subscribe"}
          shortcut={hotkeyOf("subscribe")}
          onClick={() => runShortcut("subscribe")}
        >
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </Button>
        {/* Not IconButton: an avatar stack (Linear's avatar group), not one icon. */}
        <button
          ref={subscribersRef}
          id="issue-subscribers"
          aria-label="Change subscribers"
          title={shortcutTitle("Change subscribers", hotkeyOf("subscribers"))}
          onClick={() => ui.send({ type: "overlay.open", overlay: "subscribers" })}
          className="flex min-w-6 items-center -space-x-1 rounded-full"
        >
          {issue.watchers?.length ? (
            issue.watchers.slice(0, 3).map((user) => <Avatar key={user.id} user={user} size={20} />)
          ) : (
            <Icon name="user" />
          )}
        </button>
      </div>
      <DescriptionHistoryProvider
        issueKey={issue.key}
        events={activity}
        created={creation}
        revisions={issue.descriptionHistory}
      >
        <ol className="space-y-3">
          <CommentThreads
            issue={issue}
            comments={(f.comment?.comments ?? []).filter((c: any) => !imageComments.has(c.id))}
            avatar={(c) => <Avatar user={jiraUser(c.author)} size={18} />}
            me={<Avatar user={ME} size={18} />}
            timestamp={timestamp}
            events={items}
            run={(run, place) => <ActivityRun key={run[0]!.anchor} events={run} place={place} />}
          />
        </ol>
      </DescriptionHistoryProvider>
      <div ref={commentRef} className="mt-[14px]">
        {/* A new key clears the box after sending; autoFocus keeps the caret in it. */}
        <CommentComposer
          key={draft.key}
          initial={draft.initial}
          id="comment"
          scope={`${issue.key}:comment`}
          onLateMedia={draft.update}
          issueKey={issue.key}
          attachments={issue.attachments}
          onFiles={composerFiles.onFiles}
          label="Leave a comment…"
          placeholder="Leave a comment…"
          autoFocus={draft.autoFocus}
          saveLabel="Submit comment"
          onChange={(doc) => {
            composerFiles.changed(doc);
            draft.save(doc);
          }}
          onSave={(doc) => {
            if (actions.comment(issue.key, doc)) {
              composerFiles.sent(doc);
              draft.sent();
            }
          }}
        />
      </div>
    </section>
  );
}

// --- overlays: palette, pickers next to their property, create ---
