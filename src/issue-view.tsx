import { AutoResizingTextArea } from "./field";
import { LoadingState } from "./empty-state";
import { showNotification } from "./app-notifications";
/* oxlint-disable react/no-unstable-nested-components -- Comment heads and avatars are render callbacks supplied to the activity threads. */
import { FavoriteButton } from "./favorite-button";
import { statusById } from "./board-catalog";
import { jiraAvatar } from "./avatar-url";
import {
  lazy,
  memo,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { type Attachment } from "./attachment-media";
import { ReminderControl } from "./reminders";
import { CommentThreads, useCommentDraft, useDraftFiles } from "./comment-threads";
import { ImageCommentCard } from "./image-thread";
import { linkTitle } from "./issue-resource";
import {
  RELATION_ISSUE,
  activityEvents,
  type ActivityEvent,
  type ActivityRow,
  type PropertyActivity,
  type Relation,
} from "./issue-activity";
import { normalizeDocument } from "./document";
import { imageCommentIds } from "./media-edits";
import { Icon, PriorityIcon, RelationIcon, StatusIcon, TypeDot, hue } from "./icons";
import { ME, boardOf, get, useStore, isWatching, type Issue, type User, statusOf } from "./store";
import { issueURL, appURL } from "./issue-urls";
import { actions, addIssueFiles } from "./issue-actions";
import { loadFull } from "./server-data";
import { currentKey } from "./jira-sync";
import { flushLocalChanges } from "./local-database";
import { isLocalIssue } from "./local-edits";
import { navigate, ui } from "./app-navigation";
import { DESCRIPTION_CONFLICT } from "./jira-ops";
import { interruptedUploads } from "./jira-media";
import { navigationIssues, visibleOrder } from "./view-model";
import { PersonalIssueDetails } from "./personal-controls";
import { SubIssueOf } from "./sub-issues";
import { Avatar } from "./avatar";
import { DocumentBodyEditor, CommentComposer } from "./rich-editor-loader";
import { hotkeyOf, runShortcut } from "./shortcuts";
import { shortcutTitle } from "./keycap";
import { post, useCommand, focusNode } from "./commands";
import { InboxIssueActions } from "./inbox";
import { descriptionSession, type DescriptionPorts } from "./description-session";
import { shortDate } from "./due-date";
import { BoardBreadcrumbs } from "./app-chrome";
import { Button, IconButton } from "./button";
import { ContextMenu, type ActionEntry } from "./action-menu";
import { copyIssue } from "./issue-copy";
import { PropertyTrigger } from "./property-trigger";
import { LabelChip } from "./label-chip";
import { Text } from "./text";
const ImageViewer = lazy(() =>
  import("./image-viewer").then((module) => ({ default: module.ImageViewer })),
);

const openRelated = (target: Issue) =>
  navigate({ board: target.board, selected: target.key, panel: true, view: get().view });

/** Linear's wording (RAJ-52). `then` is the shorter form after ", then": "set to Medium", "moved to Done". Labels carry their 4px dot. */
function describeActivity(event: PropertyActivity, issue: Issue, then = false): ReactNode {
  const name = (value: unknown) =>
    value && typeof value === "object" && "name" in value
      ? String((value as { name: unknown }).name)
      : String(value);
  const status = (id: unknown) => statusById(boardOf(issue.key), id)?.name ?? String(id);
  const date = (value: unknown) =>
    new Date(`${value}T00:00`).toLocaleDateString("en", { month: "short", day: "numeric" });
  const { field, before, after } = event;
  if (field === "relation") {
    const relation = (after ?? before) as Relation,
      target = get().issues.get(relation.key);
    const verb = after
      ? ({
          related: "added related issue",
          blocked: "marked this issue as blocked by",
          blocking: "marked this issue as blocking",
          duplicate: "marked this issue as a duplicate of",
          duplicated: "marked this issue as duplicated by",
        }[relation.kind] ?? "added related issue")
      : `removed ${RELATION_ISSUE[relation.kind] ?? "related"} issue`;
    return (
      <>
        {verb}{" "}
        {target ? (
          <a
            href={appURL(target)}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              openRelated(target);
            }}
            className="hover:text-fg"
          >
            <b className="font-medium">{relation.key}</b> {target.summary}
          </a>
        ) : (
          <b className="font-medium">{relation.key}</b>
        )}
      </>
    );
  }
  if (field === "status")
    return then ? `moved to ${status(after)}` : `moved from ${status(before)} to ${status(after)}`;
  if (field === "labels") {
    const was = new Set((before as string[]) ?? []),
      now = new Set((after as string[]) ?? []),
      added = [...now].filter((l) => !was.has(l)),
      removed = [...was].filter((l) => !now.has(l));
    const list = (names: string[]) =>
      names.map((l, i) => (
        <span key={l}>
          {i ? ", " : ""}
          <span
            className="mr-1 inline-block size-1 rounded-full align-middle"
            style={{ background: hue(l) }}
          />
          {l}
        </span>
      ));
    return (
      <>
        {added.length > 0 && (
          <>
            added label{added.length > 1 ? "s" : ""} {list(added)}
          </>
        )}
        {added.length > 0 && removed.length > 0 && " and "}
        {removed.length > 0 && (
          <>
            removed label{removed.length > 1 ? "s" : ""} {list(removed)}
          </>
        )}
      </>
    );
  }
  const label = {
    priority: "priority",
    assignee: "assignee",
    due: "due date",
    parent: "parent issue",
    type: "issue type",
  }[field];
  if (after === null || after === "") return `removed ${label}`;
  if (field === "assignee")
    return then ? `assigned to ${name(after)}` : `assigned the issue to ${name(after)}`;
  return then
    ? `set to ${field === "due" ? date(after) : name(after)}`
    : `set ${label} to ${field === "due" ? date(after) : name(after)}`;
}
/** The row's icon in Linear (RAJ-52): the new status or priority, the label glyph, the assignee; a row of several changes shows the actor. */
function ActivityIcon({ row, issue }: { row: ActivityRow; issue: Issue }) {
  const last = row.chain.at(-1) ?? row.events[0]!;
  if (row.field === "relation")
    return <RelationIcon kind={((last.after ?? last.before) as Relation).kind} />;
  if (row.field === "status") {
    const status = statusById(boardOf(issue.key), last.after);
    if (status) return <StatusIcon status={status} />;
  }
  if (row.field === "priority")
    return <PriorityIcon name={(last.after as string | null) ?? undefined} />;
  if (row.field === "labels") return <Icon name="label" />;
  if (row.field === "type") return <TypeDot type={last.after as string} />;
  if (row.field === "due") return <Icon name="calendar" />;
  if (row.field === "assignee") return <Avatar user={last.after as User | null} size={14} />;
  return <Avatar user={row.actor} size={14} />;
}
/** Linear's compact Activity times: "just now", "6min ago", "11h ago", "1d ago", then the date. */
// Linear's exact-time label: "Sat Nov 7, 2026, 07:49:03" (24-hour, with seconds).
const fullTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })}`;
};
const ago = (iso: string, now = Date.now()) => {
  const m = Math.floor((now - Date.parse(iso)) / 60_000),
    date = new Date(iso);
  if (m < 1) return "just now";
  if (m < 60) return `${m}min ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  if (m < 43200) return `${Math.floor(m / 1440)}d ago`;
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
};

const author = (a: any): User | null =>
  a && { id: a.accountId, name: a.displayName, avatar: jiraAvatar(a.avatarUrls) };

// --- issue view: a full page, a side panel, or the inbox's pane; App picks the frame ---

const SIDE =
  "issue-detail flex flex-col bg-panel max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full";

/** The issue as a full page: breadcrumbs lead the header. `actions` are the inbox's notification actions when it opened there. */
export const IssuePage = memo(function IssuePage({
  issue,
  actions,
}: {
  issue: Issue;
  actions?: ReactNode;
}) {
  return (
    <div className="issue-detail flex min-w-0 flex-1 flex-col" data-mode="page">
      <IssueHeader issue={issue} switchTo="side" actions={actions}>
        <BoardBreadcrumbs board={boardOf(issue.key)!} issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} />
    </div>
  );
});
/** The issue beside the board, 520px wide. */
export const IssueSidePanel = memo(function IssueSidePanel({ issue }: { issue: Issue }) {
  return (
    <aside
      className={`${SIDE} w-[520px] max-w-full shrink-0 border-l border-line`}
      data-mode="side"
    >
      <IssueHeader issue={issue} switchTo="page">
        <IssueKey issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} />
    </aside>
  );
});
/** The issue filling the inbox's right pane, with the notification's snooze and delete. */
export const InboxIssuePane = memo(function InboxIssuePane({ issue }: { issue: Issue }) {
  return (
    <aside className={`${SIDE} min-w-0 flex-1`} data-mode="side">
      <IssueHeader issue={issue} switchTo="page" actions={<InboxIssueActions />}>
        <IssueKey issue={issue} />
      </IssueHeader>
      <IssueBody issue={issue} />
    </aside>
  );
});

function IssueKey({ issue }: { issue: Issue }) {
  return (
    <>
      <TypeDot type={issue.type} />
      <a
        className="tracking-[-0.24px] text-fg-2 hover:text-fg"
        href={issueURL(issue)}
        target="_blank"
        rel="noreferrer"
      >
        {issue.key}
      </a>
    </>
  );
}

/** The 44px bar: what leads it (`children`), favorite, Issue options, reminder, the frame's `actions`, the stepper, the switch
 *  to the other layout and close. */
function IssueHeader({
  issue,
  switchTo,
  actions,
  children,
}: {
  issue: Issue;
  switchTo: "page" | "side";
  actions?: ReactNode;
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
      <Stepper issueKey={issue.key} />
      <IconButton
        label={switchTo === "side" ? "Open in side panel" : "Open as full page"}
        variant="muted"
        onClick={() => navigate({ view: switchTo })}
      >
        <Icon name={switchTo === "side" ? "side" : "expand"} />
      </IconButton>
      <IconButton label="Close" shortcut="Escape" variant="muted" onClick={() => navigate({ panel: false })}>
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
/** Every frame's body: the copy toolbar, then title, properties and content in the detail grid. */
function IssueBody({ issue }: { issue: Issue }) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const propertiesHidden = useStore((s) => s.issuePropertiesHidden);
  return (
    <div className="issue-detail-body">
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

/** Linear shows position, then next and previous, within the current visible view. */
function Stepper({ issueKey }: { issueKey: string }) {
  const order = useStore((s) => visibleOrder(s, ME.id));
  const flat = useMemo(() => navigationIssues(order), [order]);
  const i = flat.findIndex((x) => x.key === issueKey);
  return (
    <div className="mr-1 flex items-center gap-0.5">
      {i >= 0 && (
        <span
          aria-label="Issue position"
          className="mr-2 whitespace-nowrap tabular-nums text-fg-3 max-sm:hidden"
        >
          {i + 1}
          <span className="text-fg-4"> / {flat.length}</span>
        </span>
      )}
      <IconButton
        label="Next"
        shortcut="J"
        alternate="ArrowDown"
        variant="muted"
        disabled={i < 0 || i >= flat.length - 1}
        onClick={() => runShortcut("down")}
      >
        <Icon name="down" />
      </IconButton>
      <IconButton label="Previous" shortcut="K" alternate="ArrowUp" variant="muted" disabled={i <= 0} onClick={() => runShortcut("up")}>
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
      className="rounded-md focus:bg-hover"
    />
  );
}

/** Linear's property list: unlabelled 13px/500 rows under section headings, no box and no Reporter/Created/Updated rows. */
const RELATION_SECTIONS = [
  ["blocked", "Blocked by"],
  ["blocking", "Blocking"],
  ["related", "Related"],
  ["duplicate", "Duplicate of"],
  ["duplicated", "Duplicated by"],
] as const;
/** A relation in the sidebar: its pill, a remove button on hover, and Linear's context menu (BJ-52): Change to…, Remove
 *  relation, Copy link. */
function RelationRow({
  issueKey,
  relatedKey,
  kind,
}: {
  issueKey: string;
  relatedKey: string;
  kind: (typeof RELATION_SECTIONS)[number][0];
}) {
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
        children: RELATION_SECTIONS.filter(([k]) => k !== kind).map(([to, name]) => ({
          name,
          run: () => actions.changeRelation(issueKey, relatedKey, kind, to),
        })),
      },
      { name: "Remove relation", icon: "close", run: remove },
    ];
    if (related)
      items.push({
        name: "Copy link",
        icon: "link",
        divider: true,
        run: () => void copyIssue("URL", related),
      });
    return items;
  };
  return (
    <ContextMenu label="Relation options" entries={entries}>
      <div
        data-relation={`${kind}:${relatedKey}`}
        className="group/relation flex max-w-full items-center gap-2"
      >
        <RelatedIssue issueKey={relatedKey} />
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
/** A related issue's pill: its status and title, or just its key when it isn't mirrored. */
function RelatedIssue({ issueKey }: { issueKey: string }) {
  const target = useStore((s) => s.issues.get(issueKey)),
    status = target && statusOf(target);
  return target ? (
    <a
      href={appURL(target)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openRelated(target);
      }}
      className="relation-pill"
    >
      <span>{status && <StatusIcon status={status} />}</span>
      <span className="truncate">{target.summary}</span>
    </a>
  ) : (
    <span className="relation-pill">
      <span />
      <span className="truncate">{issueKey}</span>
    </span>
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
function Properties({ issue }: { issue: Issue }) {
  const status = statusOf(issue);
  const writable = useStore((s) => s.writable);
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
            icon={<Icon name="calendar" />}
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
        {/* Jira can't move an issue between projects, so with Jira writes an issue already in Jira shows its project read-only (R2-issue-fields-D8). */}
        {!writable || isLocalIssue(issue.key) ? (
          <PropertyPill
            id="prop-project"
            overlay="project"
            state={issue.project ? "value" : "empty"}
            icon={<Icon name="layers" />}
          >
            {issue.project?.name ?? <Placeholder wide="Add to project" short="Project" />}
          </PropertyPill>
        ) : (
          <PropertyPill
            id="prop-project"
            title="Jira can't move an issue to another project"
            icon={<Icon name="layers" />}
          >
            {issue.project?.name ?? "No project"}
          </PropertyPill>
        )}
        {issue.milestones?.length ? (
          <PropertyPill id="prop-milestone" overlay="milestone" icon={<Icon name="calendar" />}>
            {issue.milestones.map((m) => m.name).join(", ")}
          </PropertyPill>
        ) : null}
      </PropertySection>
      {/* Linear (RAJ-52): a section per relation kind after Project, each related issue a 28px pill (its status and title) with a round remove button on hover. */}
      {RELATION_SECTIONS.map(([kind, heading]) => {
        const rows = (issue.relations ?? []).filter((r) => r.kind === kind);
        return rows.length ? (
          <PropertySection key={kind} name={heading}>
            {rows.map((r) => (
              <RelationRow key={r.key} issueKey={issue.key} relatedKey={r.key} kind={kind} />
            ))}
          </PropertySection>
        ) : null;
      })}
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
  refused: (key) => get().full.get(key)?.descriptionError === DESCRIPTION_CONFLICT,
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
  const refusal = f?.descriptionError,
    content = f ? (f.descriptionRejected ?? f.fields.description ?? "") : undefined;
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
  const held = conflict || refusal === DESCRIPTION_CONFLICT;
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
  const message = conflict
    ? "Jira's copy of this description changed. Your edits aren't saved."
    : refusal === DESCRIPTION_CONFLICT
      ? "Someone changed this description in Jira. Your version isn't saved."
      : refusal &&
        `Jira didn't save this description (${refusal.replace(/^description:\s*/i, "").replace(/\.$/, "")}). Edit it to try again, or use Jira's version.`;
  return (
    <section
      ref={section}
      className="issue-description mt-[22px] leading-[1.6] text-fg-2"
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
        ) : <LoadingState />
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
  const url = new URL(location.href);
  url.hash = id;
  return (
    <a
      href={url.href}
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
      <li id={`activity-${row.id}`} data-activity={row.field} className="activity-event">
        <span className="grid size-[14px] place-items-center">
          <ActivityIcon row={row} issue={issue} />
        </span>
        <span>
          <span className="font-medium">{row.actor.name}</span>{" "}
          {row.events.map((change, i) => (
            <span key={change.id}>
              {i ? " and " : ""}
              {describeActivity(change, issue)}
            </span>
          ))}
          {row.chain.map((change) => (
            <span key={change.id}>, then {describeActivity(change, issue, true)}</span>
          ))}{" "}
          ·
        </span>{" "}
        <Timestamp date={row.at} id={`activity-${row.id}`} />
      </li>
    );
  }
  const { resource } = event;
  return (
    <li id={`activity-${resource.id}`} data-activity="link" className="activity-event">
      <Avatar user={ME} size={14} />
      <span>
        <span className="font-medium">{ME.name}</span> linked{" "}
        <span className="inline-flex align-[-2px]">
          <Icon name="link" size={12} />
        </span>{" "}
        <a href={resource.url} target="_blank" rel="noreferrer" className="font-medium">
          {linkTitle(resource)}
        </a>{" "}
        ·
      </span>{" "}
      <Timestamp date={resource.created} id={`activity-${resource.id}`} />
    </li>
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
  if (!f) return null;
  const imageComments = imageCommentIds(issue.mediaEdits);
  return (
    <section className="issue-activity mt-4 border-t border-line pt-[18px]">
      {viewing && (
        <Suspense fallback={null}>
          <ImageViewer
            file={viewing.file}
            original={viewing.file}
            external={viewing.external}
            editable
            readReason=""
            issueKey={issue.key}
            close={() => setViewing(undefined)}
          />
        </Suspense>
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
      <ol className="space-y-3">
        <li id="issue-created" className="activity-event">
          <Avatar user={author(f.reporter)} size={14} />
          <span>
            <span className="font-medium">{f.reporter?.displayName}</span> created ·
          </span>{" "}
          <Timestamp date={f.created} id="issue-created" />
        </li>
        <CommentThreads
          issue={issue}
          comments={(f.comment?.comments ?? []).filter((c: any) => !imageComments.has(c.id))}
          avatar={(c) => <Avatar user={author(c.author)} size={18} />}
          me={<Avatar user={ME} size={18} />}
          timestamp={timestamp}
          events={activityEvents(issue).map((event) => ({
            at: event.at,
            node: (
              <ActivityEventItem key={event.id} event={event} issue={issue} viewImage={viewImage} />
            ),
          }))}
        />
      </ol>
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
