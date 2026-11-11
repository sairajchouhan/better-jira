/* oxlint-disable react/no-unstable-nested-components -- The timestamp renderer is a render callback supplied to the activity view. */
import { FavoriteButton } from "./favorite-button";
import { statusById } from "./board-catalog";
import { jiraAvatar } from "./avatar-url";
import {
  Fragment,
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
import { CommentThreads, useDraftFiles, useRejectedComment } from "./comment-threads";
import { ImageCommentCard } from "./image-thread";
import { IssueDocument } from "./issue-resources";
import { linkTitle } from "./issue-resource";
import {
  RELATION_ISSUE,
  activityRows,
  type ActivityRow,
  type PropertyActivity,
  type Relation,
} from "./issue-activity";
import { normalizeDocument } from "./document";
import { imageCommentIds } from "./media-edits";
import { Icon, PriorityIcon, RelationIcon, StatusIcon, TypeDot, hue } from "./icons";
import {
  ME,
  actions,
  addIssueFiles,
  boardOf,
  get,
  loadFull,
  navigate,
  ui,
  useStore,
  flushLocalChanges,
  issueURL,
  isLocalIssue,
  isWatching,
  appURL,
  type Issue,
  type User,
  currentKey,
  statusOf,
} from "./store";
import { DESCRIPTION_CONFLICT } from "./jira-ops";
import { interruptedUploads } from "./jira-media";
import { navigationIssues, visibleOrder } from "./view-model";
import { PersonalIssueDetails } from "./personal-controls";
import { SubIssueOf } from "./sub-issues";
import { Avatar } from "./avatar";
import { DocumentBodyEditor, CommentComposer } from "./rich-editor-loader";
import { runShortcut, shortcutLabel } from "./shortcuts";
import { useCommand, focusNode } from "./commands";
import { InboxIssueActions } from "./inbox";
import { descriptionSession, type DescriptionPorts } from "./description-session";
import { shortDate } from "./due-date";
import { BoardBreadcrumbs } from "./app-chrome";
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

// --- issue view: side panel or full page ---

const ICON_BTN =
  "grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg";

export const IssueView = memo(function IssueView({
  issue,
  page,
  fill,
}: {
  issue: Issue;
  page: boolean;
  fill?: boolean;
}) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const optionsOpen = useStore((s) => s.overlay === "options");
  const propertiesHidden = useStore((s) => s.issuePropertiesHidden);
  const document = useStore((s) => s.document);
  const inbox = useStore((s) => s.inbox);
  if (document) return <IssueDocument issue={issue} id={document} />;
  const bar = (
    <div className="issue-detail-header flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-fg-3">
      {page ? (
        <BoardBreadcrumbs board={boardOf(issue.key)!} issue={issue} />
      ) : (
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
      )}
      <FavoriteButton id={issue.key} noun="issue" size={16} className={ICON_BTN} />
      <button
        id="issue-options"
        aria-label="Issue options"
        aria-expanded={optionsOpen}
        onClick={() => ui.send({ type: "overlay.open", overlay: "options" })}
        className={`${ICON_BTN} aria-expanded:bg-hover aria-expanded:text-fg`}
      >
        <Icon name="dots" />
      </button>
      <ReminderControl issue={issue} />
      {inbox && <InboxIssueActions />}
      <span className="flex-1" />
      <Stepper issueKey={issue.key} />
      <button
        title={page ? "Open in side panel" : "Open as full page"}
        onClick={() => navigate({ view: page ? "side" : "page" })}
        className={ICON_BTN}
      >
        <Icon name={page ? "side" : "expand"} />
      </button>
      <button title="Close (esc)" onClick={() => navigate({ panel: false })} className={ICON_BTN}>
        <Icon name="close" />
      </button>
    </div>
  );

  const body = (
    <>
      {bar}
      <div className="issue-detail-body">
        <div role="toolbar" aria-label="Copy issue" className="issue-copy-toolbar">
          {(
            [
              ["copy-url", "Copy issue URL", "link"],
              ["copy-id", "Copy issue ID", "copy"],
              ["copy-branch", "Copy git branch name", "branch"],
            ] as const
          ).map(([action, label, icon]) => (
            <button
              key={action}
              aria-label={label}
              title={`${label} (${shortcutLabel(action)})`}
              onClick={() => runShortcut(action)}
              className={ICON_BTN}
            >
              <Icon name={icon} />
            </button>
          ))}
        </div>
        <div className="issue-detail-grid" data-properties-hidden={propertiesHidden || undefined}>
          <div className="issue-detail-title">
            <Title
              issue={issue}
              className="text-[24px] !leading-[32px] tracking-[-0.16px] [font-variation-settings:'opsz'_32]"
            />
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
    </>
  );
  return page ? (
    <div className="issue-detail flex min-w-0 flex-1 flex-col" data-mode="page">
      {body}
    </div>
  ) : (
    <aside
      className={`issue-detail flex ${fill ? "min-w-0 flex-1" : "w-[520px] max-w-full shrink-0 border-l border-line"} flex-col bg-panel max-md:absolute max-md:inset-0 max-md:z-20 max-md:w-full`}
      data-mode="side"
    >
      {body}
    </aside>
  );
});

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
      <button
        disabled={i < 0 || i >= flat.length - 1}
        title="Next (J / ↓)"
        onClick={() => runShortcut("down")}
        className={`${ICON_BTN} disabled:opacity-30`}
      >
        <Icon name="down" />
      </button>
      <button
        disabled={i <= 0}
        title="Previous (K / ↑)"
        onClick={() => runShortcut("up")}
        className={`${ICON_BTN} disabled:opacity-30`}
      >
        <Icon name="up" />
      </button>
    </div>
  );
}

/** A Jira-side rename shows at once unless the title is being edited (Linear keeps a focused draft); leaving it saves only typed text. */
function Title({ issue, className }: { issue: Issue; className: string }) {
  const ref = useRef<HTMLTextAreaElement>(null),
    start = useRef("");
  useCommand("focus-title", () => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    // Linear puts the caret at the end, so typing appends (R2-issue-fields-D6).
    node.setSelectionRange(node.value.length, node.value.length);
    return true;
  });
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = issue.summary;
  }, [issue.summary]);
  return (
    <textarea
      ref={ref}
      id="summary"
      aria-label="Issue title"
      key={issue.key}
      defaultValue={issue.summary}
      rows={1}
      onFocus={(e) => (start.current = e.target.value)}
      onBlur={(e) => {
        // Only an edit saves: an unchanged field never writes back a title Jira has since replaced.
        if (e.target.value !== start.current) actions.summary(issue.key, e.target.value);
        // An empty title isn't saved: show the current one again.
        e.target.value = get().issues.get(issue.key)?.summary ?? issue.summary;
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
      className={`block w-full resize-none rounded-md bg-transparent font-semibold leading-snug text-fg outline-none [field-sizing:content] focus:bg-hover ${className}`}
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
function Properties({ issue }: { issue: Issue }) {
  const status = statusOf(issue);
  // Like Linear, a pill stays highlighted while its menu is open (Opus review 4).
  const open = useStore((s) => s.overlay);
  const writable = useStore((s) => s.writable);
  // Linear: content-width 28px pills 4px apart, icon in a 16px box 6px in, and a tooltip naming the action and its key (no project tooltip).
  const btn = (
    id: string,
    overlay: "status" | "assign" | "priority" | "type" | "labels" | "project" | "milestone" | "due",
    tip: string,
    body: ReactNode,
  ) => (
    <button
      id={id}
      aria-expanded={open === overlay}
      title={tip ? `${tip} (${shortcutLabel(overlay)})` : undefined}
      onClick={() => ui.send({ type: "overlay.open", overlay })}
      className="ml-px flex h-7 max-w-full items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-left text-fg-2 hover:bg-hover hover:text-fg aria-expanded:bg-hover aria-expanded:text-fg [&>svg]:shrink-0 [&>:first-child]:grid [&>:first-child]:size-4 [&>:first-child]:place-items-center"
    >
      {body}
    </button>
  );
  const section = (name: string, rows: ReactNode) => (
    <section className="flex flex-col items-start gap-1 [&+section]:mt-[33px]">
      <h3 className="mb-1.5 px-2 text-[13px] leading-[normal] font-medium text-fg-3">{name}</h3>
      {rows}
    </section>
  );
  return (
    <div data-properties className="text-[13px] font-medium">
      {section(
        "Properties",
        <>
          {btn(
            "prop-status",
            "status",
            "Change status",
            <>
              <span>{status && <StatusIcon status={status} />}</span>
              <span className="truncate">{status?.name}</span>
            </>,
          )}
          {btn(
            "prop-priority",
            "priority",
            issue.priority ? "Change priority" : "Set priority",
            <>
              <span>
                <PriorityIcon name={issue.priority} />
              </span>
              {issue.priority ?? (
                <>
                  <span className="property-wide">Set priority</span>
                  <span className="property-short">Priority</span>
                </>
              )}
            </>,
          )}
          {btn(
            "prop-assignee",
            "assign",
            "Assign to",
            <>
              <span>
                <Avatar user={issue.assignee} size={16} />
              </span>
              <span className="truncate">{issue.assignee?.name ?? "Unassigned"}</span>
            </>,
          )}
          {btn(
            "prop-type",
            "type",
            "Change issue type",
            <>
              <span>
                <TypeDot type={issue.type} />
              </span>
              <span className={`truncate ${issue.type ? "" : "text-fg-3"}`}>
                {issue.type ?? "Issue type"}
              </span>
            </>,
          )}
          {issue.due &&
            btn(
              "prop-due",
              "due",
              "Change due date",
              <>
                <span>
                  <Icon name="calendar" />
                </span>
                <span className={issue.due ? "" : "text-fg-3"}>
                  {issue.due ? shortDate(issue.due, undefined, true) : "Set due date"}
                </span>
              </>,
            )}
        </>,
      )}
      {/* Linear (RAJ-52): one 25px chip per label, its dot and name, then a round + button; clicking either opens the label menu beside it. */}
      {section(
        "Labels",
        issue.labels.length ? (
          <div className="flex min-h-7 max-w-full flex-wrap gap-1.5 pt-0.5 pl-[1.5px]">
            {issue.labels.map((label) => (
              <button
                key={label}
                data-label-chip
                onClick={() => ui.send({ type: "overlay.open", overlay: "labels" })}
                className="label-chip"
              >
                <span
                  className="size-[9px] shrink-0 rounded-full"
                  style={{ background: hue(label) }}
                />
                <span className="truncate">{label}</span>
              </button>
            ))}
            <button
              id="prop-labels"
              aria-label="Add label"
              onClick={() => ui.send({ type: "overlay.open", overlay: "labels" })}
              className="label-add"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
        ) : (
          btn(
            "prop-labels",
            "labels",
            "Add labels",
            <>
              <span>
                <Icon name="label" />
              </span>
              <span className="truncate text-fg-3">
                <span className="property-wide">Add label</span>
                <span className="property-short">Labels</span>
              </span>
            </>,
          )
        ),
      )}
      {section(
        "Project",
        <>
          {/* Jira can't move an issue between projects, so with Jira writes an issue already in Jira shows its project read-only (R2-issue-fields-D8). */}
          {!writable || isLocalIssue(issue.key) ? (
            btn(
              "prop-project",
              "project",
              "",
              <>
                <span>
                  <Icon name="layers" />
                </span>
                <span className="truncate">
                  {issue.project?.name ?? (
                    <>
                      <span className="property-wide">Add to project</span>
                      <span className="property-short">Project</span>
                    </>
                  )}
                </span>
              </>,
            )
          ) : (
            <span
              id="prop-project"
              title="Jira can't move an issue to another project"
              className="ml-px flex h-7 max-w-full items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-fg-2 [&>:first-child]:grid [&>:first-child]:size-4 [&>:first-child]:place-items-center"
            >
              <span>
                <Icon name="layers" />
              </span>
              <span className="truncate">{issue.project?.name ?? "No project"}</span>
            </span>
          )}
          {issue.milestones?.length
            ? btn(
                "prop-milestone",
                "milestone",
                "",
                <>
                  <span>
                    <Icon name="calendar" />
                  </span>
                  <span className={`truncate ${issue.milestones?.length ? "" : "text-fg-3"}`}>
                    {issue.milestones?.map((m) => m.name).join(", ") || "Set milestone"}
                  </span>
                </>,
              )
            : null}
        </>,
      )}
      {/* Linear (RAJ-52): a section per relation kind after Project, each related issue a 28px pill (its status and title) with a round remove button on hover. */}
      {RELATION_SECTIONS.map(([kind, heading]) => {
        const rows = (issue.relations ?? []).filter((r) => r.kind === kind);
        return rows.length ? (
          <Fragment key={kind}>
            {section(
              heading,
              rows.map((r) => (
                <div
                  key={r.key}
                  data-relation={`${kind}:${r.key}`}
                  className="group/relation flex max-w-full items-center gap-2"
                >
                  <RelatedIssue issueKey={r.key} />
                  <button
                    aria-label="Remove relation"
                    onClick={() => {
                      actions.relate(issue.key, r.key, kind, true);
                      // Focus stays in the issue, as after removing a resource: the next relation, else Issue options.
                      requestAnimationFrame(() =>
                        (
                          document.querySelector<HTMLElement>("[data-relation] a") ??
                          document.getElementById("issue-options")
                        )?.focus(),
                      );
                    }}
                    className="relation-remove"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              )),
            )}
          </Fragment>
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
  const focus = useStore((s) => s.editDesc);
  const f = useStore((s) => s.full.get(issue.key));
  const error = useStore((s) => s.fullErrors.get(issue.key));
  // A description Jira refused stays in the editor (beside Jira's copy in the store) until a version is picked or it is edited.
  const refusal = f?.descriptionError,
    content = f ? (f.descriptionRejected ?? f.fields.description ?? "") : undefined;
  const stored = content !== undefined ? JSON.stringify(normalizeDocument(content)) : "";
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
      ui.send({ type: "description.edit" });
  }, [stored, focused, snapshot, session]);
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
    ui.send({ type: "description.edit" });
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
      ui.send({
        type: "toast.show",
        text: `${names.join(", ")} ${names.length > 1 ? "weren't" : "wasn't"} placed`,
        detail:
          "The page reloaded during the upload. Check the issue's attachments in Jira, then attach it again.",
      });
  }, [issue.key]);
  useEffect(() => () => session.flush(), [session]);
  // Done only once focus has held for a frame: opening the issue can remount this editor right after the first
  // focus, and the remounted one must still see the request.
  useEffect(() => {
    if (!focus || !f) return;
    let tries = 0,
      frame = 0;
    const go = () => {
      const editor = document.getElementById("description");
      if (editor && editor === document.activeElement && tries > 3)
        return ui.send({ type: "description.editDone" });
      editor?.focus();
      if (tries++ < 60) frame = requestAnimationFrame(go);
      else ui.send({ type: "description.editDone" });
    };
    go();
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Prefetch and draft recovery follow selection/load transitions, not render-local arrays or refreshed full issue objects.
  }, [focus, !!f]);
  const message = conflict
    ? "Jira's copy of this description changed. Your edits aren't saved."
    : refusal === DESCRIPTION_CONFLICT
      ? "Someone changed this description in Jira. Your version isn't saved."
      : refusal &&
        `Jira didn't save this description (${refusal.replace(/^description:\s*/i, "").replace(/\.$/, "")}). Edit it to try again, or use Jira's version.`;
  return (
    <section
      ref={section}
      className="mt-[22px] leading-[1.6] text-fg-2"
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
          <button className="rounded px-2 py-0.5 hover:bg-hover" onClick={() => resolve(false)}>
            Use Jira's version
          </button>
          {held && (
            <button
              className="rounded bg-accent px-2 py-0.5 text-white"
              onClick={() => resolve(true)}
            >
              Keep mine
            </button>
          )}
        </div>
      )}
      {!f ? (
        <p role="status" className="text-fg-4">
          {error ? (
            <>
              {error}.{" "}
              <button onClick={() => void loadFull(issue.key)} className="text-accent">
                Retry
              </button>
            </>
          ) : (
            "Loading…"
          )}
        </p>
      ) : (
        <DocumentBodyEditor
          key={revision}
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

function Activity({ issue, f }: { issue: Issue; f: any }) {
  const [composer, setComposer] = useState(0),
    composerFiles = useDraftFiles(issue.key);
  const subscribersRef = useRef<HTMLButtonElement>(null),
    commentRef = useRef<HTMLDivElement>(null);
  useCommand("focus-subscribers", () => focusNode(subscribersRef.current));
  useCommand("focus-comment", () =>
    focusNode(commentRef.current?.querySelector<HTMLElement>("#comment")),
  );
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
  const draftKey = `better-jira:comment-draft:${get().namespace}:${issue.key}`;
  const [draft, setDraft] = useState(() => {
    try {
      return normalizeDocument(JSON.parse(localStorage.getItem(draftKey) ?? '""'));
    } catch {
      return normalizeDocument("");
    }
  });
  // A comment Jira refused comes back here with the caret in it (R2-comments-D4).
  const [restored, setRestored] = useState(0);
  useRejectedComment(issue.key, [undefined], draftKey, (body) => {
    setDraft(body);
    setRestored((n) => n + 1);
  });
  const timestamp = (date: string, id: string) => {
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
        <h3 className="mr-auto text-[15px] leading-[23px] font-semibold text-fg">Activity</h3>
        <button
          aria-label={subscribed ? "Unsubscribe from issue" : "Subscribe to issue"}
          title={`${subscribed ? "Unsubscribe" : "Subscribe"} (${shortcutLabel("subscribe")})`}
          onClick={() => runShortcut("subscribe")}
          className="text-[13px] text-fg-3 hover:text-fg"
        >
          {subscribed ? "Unsubscribe" : "Subscribe"}
        </button>
        <button
          ref={subscribersRef}
          id="issue-subscribers"
          aria-label="Change subscribers"
          title={`Change subscribers (${shortcutLabel("subscribers")})`}
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
          {timestamp(f.created, "issue-created")}
        </li>
        <CommentThreads
          issue={issue}
          comments={(f.comment?.comments ?? []).filter((c: any) => !imageComments.has(c.id))}
          avatar={(c) => <Avatar user={author(c.author)} size={18} />}
          me={<Avatar user={ME} size={18} />}
          timestamp={timestamp}
          events={[
            ...Object.entries(issue.mediaEdits ?? {})
              .filter(([, edit]) => edit.comments?.length)
              .map(([mediaId, edit]) => ({
                at: edit.comments![0]!.at,
                node: (
                  <ImageCommentCard
                    key={mediaId}
                    comments={edit.comments!}
                    src={issue.attachments?.find((file) => file.id === mediaId)?.url || edit.src}
                    author={ME.name}
                    me={<Avatar user={ME} size={18} />}
                    head={(c) => (
                      <>
                        <Avatar user={ME} size={18} />
                        <span className="font-medium text-fg">{c.author}</span>
                        {timestamp(c.at, `image-comment-${c.id}`)}
                      </>
                    )}
                    save={(comments) =>
                      actions.mediaEdit(issue.key, mediaId, { ...edit, comments })
                    }
                    view={() => {
                      const frame = document.querySelector<HTMLElement>(
                        `[data-media-id="${CSS.escape(mediaId)}"]`,
                      );
                      if (!frame) {
                        const file = issue.attachments?.find((file) => file.id === mediaId);
                        const url = file?.url || edit.src;
                        if (url)
                          setViewing({
                            file: file ?? {
                              id: mediaId,
                              name: "Image",
                              type: "image/png",
                              size: 0,
                              url,
                            },
                            external: !file,
                          });
                        return;
                      }
                      frame.scrollIntoView({ block: "center" });
                      frame.dispatchEvent(new Event("show-image-comments"));
                    }}
                  />
                ),
              })),
            ...activityRows(issue.activity ?? []).map((row) => ({
              at: row.at,
              node: (
                <li
                  key={row.id}
                  id={`activity-${row.id}`}
                  data-activity={row.field}
                  className="activity-event"
                >
                  <span className="grid size-[14px] place-items-center">
                    <ActivityIcon row={row} issue={issue} />
                  </span>
                  <span>
                    <span className="font-medium">{row.actor.name}</span>{" "}
                    {row.events.map((event, i) => (
                      <span key={event.id}>
                        {i ? " and " : ""}
                        {describeActivity(event, issue)}
                      </span>
                    ))}
                    {row.chain.map((event) => (
                      <span key={event.id}>, then {describeActivity(event, issue, true)}</span>
                    ))}{" "}
                    ·
                  </span>{" "}
                  {timestamp(row.at, `activity-${row.id}`)}
                </li>
              ),
            })),
            // Linear lists a link while it is attached and drops the row once it is removed (RAJ-52, 2026-11-07).
            ...(issue.resources ?? [])
              .filter((resource) => resource.kind === "link" && resource.created)
              .map((resource) => ({
                at: resource.created!,
                node: (
                  <li
                    key={resource.id}
                    id={`activity-${resource.id}`}
                    data-activity="link"
                    className="activity-event"
                  >
                    <Avatar user={ME} size={14} />
                    <span>
                      <span className="font-medium">{ME.name}</span> linked{" "}
                      <span className="inline-flex align-[-2px]">
                        <Icon name="link" size={12} />
                      </span>{" "}
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium"
                      >
                        {linkTitle(resource)}
                      </a>{" "}
                      ·
                    </span>{" "}
                    {timestamp(resource.created!, `activity-${resource.id}`)}
                  </li>
                ),
              })),
          ]}
        />
      </ol>
      <div ref={commentRef} className="mt-[14px]">
        {/* A new key clears the box after sending; autoFocus keeps the caret in it. */}
        <CommentComposer
          key={`${composer}:${restored}`}
          initial={composer && !restored ? "" : draft}
          id="comment"
          scope={`${issue.key}:comment`}
          onLateMedia={(merge) => {
            try {
              localStorage.setItem(
                draftKey,
                JSON.stringify(merge(JSON.parse(localStorage.getItem(draftKey) ?? '""'))),
              );
            } catch {
              /* the file stays in the issue attachments */
            }
          }}
          issueKey={issue.key}
          attachments={issue.attachments}
          onFiles={composerFiles.onFiles}
          label="Leave a comment…"
          placeholder="Leave a comment…"
          autoFocus={composer > 0 || restored > 0}
          saveLabel="Submit comment"
          onChange={(doc) => {
            composerFiles.changed(doc);
            try {
              localStorage.setItem(draftKey, JSON.stringify(doc));
            } catch {
              /* The open composer still retains its draft. */
            }
          }}
          onSave={(doc) => {
            if (actions.comment(issue.key, doc)) {
              composerFiles.sent(doc);
              try {
                localStorage.removeItem(draftKey);
              } catch {}
              setComposer((n) => n + 1);
              setRestored(0);
            }
          }}
        />
      </div>
    </section>
  );
}

// --- overlays: palette, pickers next to their property, create ---
