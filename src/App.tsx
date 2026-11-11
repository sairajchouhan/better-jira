import { navigationChoices } from "./quick-navigation";
import { useEffectiveMine, useActiveView, useSavedViews, useOverlayFilters, createViewDraft, editViewDraft, duplicateViewDraft, saveOverlayToView } from "./saved-views";
import { statusById } from "./board-catalog";
import { clearFilters, hideGroup, setScope, showGroup, toggleCollapsed, useEffectiveSettings, useViewSettings } from "./view-settings";
import { openViewEditor, ViewMenu, ViewContextMenu, ViewEditorPage, ViewDeleteDialog } from "./view-editor";
import { canMergeOverlay } from "./saved-view-model";
import { createToolbarView } from "./view-toolbar-actions";
import { ViewsDirectory, ViewDetails, ViewFavorites, SavedViewIcon, ResultsFeedback } from "./views-navigation";
/* oxlint-disable react/immutability -- Session callbacks and mutable imperative models are intentionally owned outside React state. */
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
/* oxlint-disable react/no-unstable-nested-components -- The timestamp renderer is a render callback supplied to the activity view. */
import { jiraAvatar } from "./avatar-url";
import "@fontsource-variable/inter/opsz.css";
import "./index.css";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import {
  Fragment,
  lazy,
  memo,
  startTransition,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Attachment } from "./attachment-media";
const ImageViewer = lazy(() =>
  import("./image-viewer").then((module) => ({ default: module.ImageViewer })),
);
import { ReminderPicker, ReminderControl, ReminderDelivery } from "./reminders";
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
import { adfToText, normalizeDocument, type AdfDocument } from "./document";
import { commentCount, imageCommentIds } from "./media-edits";
import { Icon, Label, PriorityIcon, RelationIcon, StatusIcon, TypeDot, hue } from "./icons";
import {
  ME,
  actions,
  addIssueFiles,
  boardOf,
  get,
  load,
  loadFull,
  navigate,
  set,
  timed,
  ui,
  useStore,
  dismissRecoveryNotice,
  openSavedView,
  openAllIssues as openBoardIssues,
  beginCreate,
  useAssignableUsers,
  downloadLocalBackup,
  flushLocalChanges,
  issueURL,
  isLocalIssue,
  isWatching,
  appURL,
  retryLocalStorage,
  dismissWriteError,
  toggleFavorite,
  undoEdit,
  redoEdit,
  type Board,
  type Issue,
  type User,
  currentKey,
  firstKey,
} from "./store";
import { DESCRIPTION_CONFLICT } from "./jira-ops";
import { interruptedUploads } from "./jira-media";

import { BoardControls, FilterChips } from "./view-controls";
import {
  buckets,
  columnInScope,
  draftForGroup,
  rankBetween,
  listRows,
  navigationIssues,
  selectIssues,
  defaultPreferences,
  filterCount,
  statusDuration,
  type Bucket,
  type Display,
  type Property,
} from "./view-model";
import {
  AddBoard,
  BoardDetails,
  CreateIssue,
  GroupMenu,
  IssueOptions,
  Modal,
  PersonalIssueDetails,
  PropertyPicker,
  Relations,
  Subscribers,
} from "./personal-controls";
import { SubIssueOf } from "./sub-issues";
import { Avatar } from "./avatar";
import { Tooltips } from "./tooltip";
import { RichEditor } from "./rich-editor-loader";
import { matchRank } from "./search-rank";
import {
  HelpMenu,
  ShortcutHelp,
  runShortcut,
  shortcutApplies,
  shortcutLabel,
  shortcuts,
  useLinearHotkeys,
} from "./shortcuts";
import { Confirm, issueAnchor } from "./menu-surface";
import { InboxIssueActions, InboxList, InboxPane, undoInboxToast, useInboxBadge } from "./inbox";
import { PickerRow, PropertyMenu } from "./property-menu";
import { createActor } from "xstate";
import { autosaveMachine, inspector } from "./machines";
import { shortDate } from "./due-date";

/** The active board's visible columns, for keyboard navigation and the issue page's ↑ ↓ stepping. */
const nav = { cols: [] as Issue[][] };
const flatNav = () => navigationIssues(nav.cols);

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
const statusOf = (i: Issue) => statusById(boardOf(i.key), i.status);

/** The keyboard map re-registers on every store change; its own component keeps that from re-rendering App. */
function Hotkeys() {
  useLinearHotkeys(() => nav.cols);
  return null;
}
export function App() {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const document = useStore((s) => s.document);
  const overlay = useStore((s) => s.overlay);
  const open = useStore((s) => (s.panel && s.selected ? s.issues.get(s.selected) : undefined));
  // A menu opened by a shortcut over a sub-issue row changes that row's issue.
  const target = useStore((s) => s.target ?? s.selected);
  const current = useStore((s) => (target ? s.issues.get(target) : undefined));
  const loadError = useStore((s) => s.loadError);
  const inbox = useStore((s) => s.inbox);
  const viewsPage = useStore((s) => s.viewsPage);
  const visited = useRef(new Set<number>());
  visited.current.add(boardId);

  useEffect(() => void load(), []);

  if (!boards.length)
    return (
      <div className="p-6 text-fg-3">
        {loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            <p className="mt-1">Retrying automatically…</p>
            <button className="mt-3 rounded bg-sel px-3 py-2 text-fg" onClick={() => void load()}>
              Retry now
            </button>
          </div>
        ) : (
          "Loading your Jira mirror…"
        )}
      </div>
    );
  const page = !!open && (view === "page" || !!document);

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Hotkeys />
      <div className="flex min-h-0 flex-1">
        <Sidebar boards={boards} />
        <Tooltips />
        <main
          tabIndex={-1}
          className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)"
        >
          {!page && !inbox && !viewsPage && <BoardHeader />}
          <div className="flex min-h-0 flex-1">
            {/* Retain visited boards for scroll restoration; do not render unopened boards. */}
            {boards
              .filter((b) => visited.current.has(b.id))
              .map((b) => (
                <BoardView
                  key={b.id}
                  board={b}
                  active={b.id === boardId}
                  shown={!page && !inbox && !viewsPage && b.id === boardId}
                  selected={selected}
                />
              ))}
            {viewsPage && <ViewsDirectory />}
            {inbox && !page && <InboxList />}
            {open ? (
              <IssueView key={firstKey(open.key)} issue={open} page={page} fill={inbox} />
            ) : (
              inbox && <InboxPane />
            )}
          </div>
        </main>
      </div>
      <ReminderDelivery />
      <StorageNotice />
      <StatusBar />
      <Toast />
      {(overlay === "palette" || overlay === "search") && (
        <Palette searchOnly={overlay === "search"} />
      )}
      {overlay === "shortcuts" && <ShortcutHelp />}
      {overlay === "add-board" && <AddBoard />}
      {overlay === "help" && <HelpMenu />}
      {(overlay === "favorites" || overlay === "views" || overlay === "boards") && (
        <QuickNavigation kind={overlay} />
      )}
      {overlay === "assign" && target && <AssignPicker issueKey={target} />}
      {overlay === "status" && target && <StatusPicker issueKey={target} />}
      {overlay === "create" && <CreateIssue />}
      {current &&
        (overlay === "priority" ||
          overlay === "type" ||
          overlay === "labels" ||
          overlay === "project" ||
          overlay === "milestone" ||
          overlay === "due") && <PropertyPicker issue={current} field={overlay} />}
      {current && overlay === "options" && <IssueOptions issue={current} />}
      {current && overlay === "reminder" && <ReminderPicker issue={current} />}
      {current && overlay === "relations" && <Relations issue={current} />}
      {current && overlay === "subscribers" && <Subscribers issue={current} />}
      <DeleteConfirm />
    </div>
  );
}

// Memoised: an overlay opening (⌘K) re-renders App, and must not re-render every board.
const BoardView = memo(function BoardView({
  board,
  active,
  shown,
  selected,
}: {
  board: Board;
  active: boolean;
  shown: boolean;
  selected: string | null;
}) {
  const issues = useStore((s) => s.issues);
  const activeView = useActiveView();
  const overlay = useOverlayFilters();
  const mine = useEffectiveMine();
  const query = useStore((s) => s.query);
  const details = useStore((s) => s.details);
  const panel = useStore((s) => s.panel);
  const prefs = useEffectiveSettings(board.id);
  const d = prefs.display;
  const [expanded, setExpanded] = useState<string[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(true);
  // Opening a board or switching layout paints the first screenful of cards at once and the rest in a transition:
  // mounting ~90 cards in one task took 100–200 ms (QA D95, D96).
  const [filled, setFilled] = useState("");
  const cap = filled === d.layout ? Infinity : d.layout === "list" ? 30 : 10;
  useEffect(() => {
    if (filled !== d.layout) startTransition(() => setFilled(d.layout));
  }, [filled, d.layout]);
  let listBudget = cap;
  const take = (rows: number) => {
    const limit = Math.max(0, listBudget);
    listBudget -= rows;
    return limit;
  };
  const all = useMemo(() => [...issues.values()], [issues]);
  const visible = useMemo(
    () => selectIssues(all, board, prefs, mine, query, ME.id),
    [all, board, prefs, mine, query],
  );
  const universe = useMemo(() => all.filter((i) => i.board === board.id), [all, board]);
  const columns = useMemo(
    () =>
      buckets(visible, d.columns, board, universe, d.groupDescending).filter(
        (c) =>
          d.columns !== "status" ||
          columnInScope(
            board.columns.find((x) => x.name === c.id),
            prefs.scope,
          ),
      ),
    [visible, d, board, universe, prefs.scope],
  );
  const hiddenIds = prefs.hidden[d.columns] ?? [];
  const collapsed = prefs.collapsed[d.columns] ?? [];
  const hidden = columns.filter(
    (c) =>
      hiddenIds.includes(c.id) || (!d.emptyGroups && !c.issues.length && !expanded.includes(c.id)),
  );
  const show = columns.filter((c) => !hidden.includes(c));
  const rows = useMemo(() => buckets(visible, d.rows, board, visible), [visible, d.rows, board]);
  const navColumns =
    d.layout === "list"
      ? [
          show
            .filter((c) => !collapsed.includes(c.id))
            .flatMap((c) =>
              buckets(c.issues, d.rows, board, c.issues).flatMap((r) =>
                listRows(r.issues, universe, d.subIssues ? d.nested : "none").map(
                  (row) => row.issue,
                ),
              ),
            ),
        ]
      : show.map((c) => rows.flatMap((r) => c.issues.filter((i) => r.issues.includes(i))));
  if (active) nav.cols = navColumns.map((c) => [...new Map(c.map((i) => [i.key, i])).values()]);
  useEffect(() => setExpanded([]), [d.emptyGroups, d.columns]);
  useEffect(() => {
    if (!active || !selected) return;
    if (!get().fullErrors.get(selected)) loadFull(selected);
    const flat = navColumns.flat();
    const i = flat.findIndex((x) => x.key === selected);
    if (i >= 0)
      for (const offset of [-2, -1, 1, 2]) {
        const near = flat[i + offset];
        if (near) loadFull(near.key);
      }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Prefetch and draft recovery follow selection/load transitions, not render-local arrays or refreshed full issue objects.
  }, [active, selected, visible]);

  const hide = (id: string) =>
    hideGroup(board.id, id);
  const reveal = (id: string) => {
    showGroup(board.id, id);
    setExpanded([...expanded, id]);
  };
  const collapse = (id: string) => toggleCollapsed(board.id, [id]);
  const createIn = (bucket: Bucket, row?: Bucket) =>
    beginCreate({
      ...draftForGroup(d.columns, bucket.id, board, universe, prefs.scope),
      ...(row ? draftForGroup(d.rows, row.id, board, universe, prefs.scope) : {}),
    });
  const baseline = selectIssues(all, board, { ...prefs, filters: activeView && activeView.board === board.id ? activeView.filters : defaultPreferences().filters }, activeView?.mine ?? false, "", ME.id).length;
  const clearAll = () => {
    clearFilters(board.id);
    ui.send({ type: "query.set", query: "" });
    ui.send({ type: "mine.set", mine: activeView?.mine ?? false });
    set({ findInView: false });
  };
  return (
    <div className={`${shown ? "flex" : "hidden"} min-w-0 min-h-0 flex-1`}>
      <div className="relative flex min-w-0 min-h-0 flex-1 flex-col" data-layout={d.layout}>
        {!visible.length && <ResultsFeedback count={0} baseline={baseline} view={activeView} temporary={!!overlay.children.length || !!query || (mine && !activeView?.mine)} clear={clearAll} />}
        {d.layout === "list" ? (
          <div className="flex-1 overflow-auto py-1">
            {show.map((c) => (
              <section key={c.id} className="mb-2">
                <GroupHeading
                  bucket={c}
                  collapsed={collapsed.includes(c.id)}
                  toggle={() => collapse(c.id)}
                  create={() => createIn(c)}
                />
                {!collapsed.includes(c.id) &&
                  buckets(c.issues, d.rows, board, c.issues)
                    .filter((r) => r.issues.length)
                    .map((r) => (
                      <div key={r.id}>
                        {d.rows !== "none" && (
                          <div className="border-b border-line bg-col px-8 py-2 text-[12px] text-fg-3">
                            {r.name} <span className="ml-2">{r.issues.length}</span>
                          </div>
                        )}
                        <IssueList
                          limit={take(r.issues.length)}
                          issues={r.issues}
                          universe={universe}
                          display={d}
                          selected={selected}
                        />
                      </div>
                    ))}
              </section>
            ))}
            {/* Linear's list footer scrolls with the rows, right after the last one. */}
            {visible.length > 0 && <ResultsFeedback count={visible.length} baseline={baseline} view={activeView} temporary={!!overlay.children.length || !!query || (mine && !activeView?.mine)} clear={clearAll} />}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 overflow-auto px-2 pt-1">
              {d.rows !== "none" && (
                <div className="sticky top-0 z-10 flex w-max gap-4 bg-panel">
                  {show.map((col) => (
                    <div key={col.id} className="w-[340px] shrink-0 rounded-t-[5px] bg-(--col-top)">
                      <ColumnHeading
                        bucket={col}
                        count={col.issues.length}
                        display={d}
                        hide={() => hide(col.id)}
                        create={() => createIn(col)}
                      />
                    </div>
                  ))}
                </div>
              )}
              {rows
                .filter((r) => d.rows === "none" || r.issues.length)
                .map((row) => (
                  <div
                    key={row.id}
                    className={d.rows === "none" ? "flex h-full min-h-0 gap-4" : "mb-4 w-max"}
                  >
                    {/* The lane spans the board's full width, so its title can stay pinned left while the board scrolls. */}
                    {d.rows !== "none" && (
                      <div className="sticky left-0 mb-2 flex w-fit items-center gap-2 px-2 py-2 text-fg-3">
                        <span>{row.name}</span>
                        <span>{row.issues.length}</span>
                        {show[0] && (
                          <button
                            aria-label={`New issue in ${row.name}`}
                            onClick={() => createIn(show[0]!, row)}
                            className={COL_BTN}
                          >
                            <Icon name="plus" />
                          </button>
                        )}
                      </div>
                    )}
                    <div className={d.rows === "none" ? "contents" : "flex gap-4"}>
                      {show.map((col) => (
                        <ColumnView
                          key={col.id}
                          limit={cap}
                          bucket={col}
                          issues={
                            d.rows === "none"
                              ? col.issues
                              : col.issues.filter((i) => row.issues.includes(i))
                          }
                          selected={selected}
                          display={d}
                          scroll={d.rows === "none"}
                          header={d.rows === "none"}
                          hide={() => hide(col.id)}
                          create={() => createIn(col, d.rows === "none" ? undefined : row)}
                          onDrop={(key, before) =>
                            actions.drop(
                              key,
                              board.id,
                              [
                                { by: d.columns, id: col.id },
                                ...(d.rows !== "none" ? [{ by: d.rows, id: row.id }] : []),
                              ],
                              d.ordering === "manual"
                                ? dropRank(
                                    (d.rows === "none"
                                      ? col.issues
                                      : col.issues.filter((i) => row.issues.includes(i))
                                    ).filter((i) => i.key !== key),
                                    before,
                                    d.descending,
                                  )
                                : undefined,
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
            {d.rows === "none" && hidden.length > 0 && (
              <HiddenColumns
                columns={hidden}
                open={hiddenOpen}
                toggle={() => setHiddenOpen(!hiddenOpen)}
                reveal={reveal}
              />
            )}
          </div>
        )}
        {hidden.length > 0 && d.layout === "board" && d.rows === "none"
          ? null
          : hidden.length > 0 && (
              <details
                open
                className="shrink-0 border-t border-line px-4 py-2 text-[12px] text-fg-3"
              >
                <summary className="cursor-default">
                  Hidden {d.layout === "board" ? "columns" : "groups"}
                </summary>
                <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  {hidden.map((c) => (
                    <button
                      key={c.id}
                      aria-label={`Show ${c.name}`}
                      className="flex h-8 items-center gap-2 rounded-lg bg-card px-3 text-fg-2 hover:bg-hover"
                      onClick={() => reveal(c.id)}
                    >
                      {c.status && <StatusIcon status={c.status} />}
                      <span>{c.name}</span>
                      <span className="text-fg-3">{c.issues.length}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
        {d.layout === "board" && visible.length > 0 && <ResultsFeedback count={visible.length} baseline={baseline} view={activeView} temporary={!!overlay.children.length || !!query || (mine && !activeView?.mine)} clear={clearAll} layout="board" />}
      </div>
      {active && shown && details && !panel && (activeView ? <ViewDetails view={activeView} issues={visible} /> : <BoardDetails board={board} issues={visible} />)}
    </div>
  );
});

/** The rank for a card dropped before `before` (or at the end) in a column shown in `list` order. */
function dropRank(list: Issue[], before: string | undefined, descending: boolean) {
  const i = list.findIndex((x) => x.key === before),
    at = i < 0 ? list.length : i,
    prev = list[at - 1]?.rank,
    next = list[at]?.rank;
  return descending ? rankBetween(next, prev) : rankBetween(prev, next);
}

/** Linear's "Hidden columns" list: pinned right, 338px, 50px header on the panel colour, 37px rows 10px apart. */
function HiddenColumns({
  columns,
  open,
  toggle,
  reveal,
}: {
  columns: Bucket[];
  open: boolean;
  toggle: () => void;
  reveal: (id: string) => void;
}) {
  return (
    <aside
      aria-label="Hidden columns"
      className="mr-3 w-[338px] shrink-0 overflow-y-auto border-l border-line pl-3"
    >
      <div className="flex h-[50px] items-center">
        <button
          aria-expanded={open}
          onClick={toggle}
          className="ml-px flex h-6 items-center gap-1 rounded-full border-[0.5px] border-transparent pr-2 pl-1 text-[12px] font-medium text-fg-2 hover:bg-hover"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`text-fg-3 transition-transform ${open ? "rotate-90" : ""}`}
          >
            <path d="M6.75194 10.6239C6.41861 10.8183 6 10.5779 6 10.192V5.80802C6 5.42212 6.41861 5.18169 6.75194 5.37613L10.5096 7.56811C10.8404 7.76105 10.8404 8.23895 10.5096 8.43189L6.75194 10.6239Z" />
          </svg>
          Hidden columns
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 pb-12">
          {columns.map((c) => (
            <button
              key={c.id}
              aria-label={`Show ${c.name}`}
              onClick={() => reveal(c.id)}
              className="flex h-[37px] shrink-0 items-center gap-3.5 rounded-lg border-[0.5px] border-hidden-line bg-card px-3 text-left text-[13px] font-medium text-fg shadow-(--hidden-shadow) hover:bg-card-hover"
            >
              {c.status ? <StatusIcon status={c.status} /> : <Icon name="layers" />}
              <span className="flex-1 truncate">{c.name}</span>
              <span className="font-[450] text-card-fg-3">{c.issues.length}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}

function GroupHeading({
  bucket,
  collapsed,
  toggle,
  create,
}: {
  bucket: Bucket;
  collapsed: boolean;
  toggle: () => void;
  create: () => void;
}) {
  return (
    <div className="flex h-10 items-center gap-2 border-y border-line bg-col px-5 text-[12px] font-medium text-fg-2">
      <button
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${bucket.name}`}
        aria-expanded={!collapsed}
        onClick={toggle}
        className="flex flex-1 items-center gap-2 text-left"
      >
        <Icon name={collapsed ? "chevron" : "down"} />
        {bucket.status && <StatusIcon status={bucket.status} />}
        <span>{bucket.name}</span>
        <span className="text-fg-3">{bucket.issues.length}</span>
      </button>
      <button aria-label={`New issue in ${bucket.name}`} onClick={create} className={COL_BTN}>
        <Icon name="plus" />
      </button>
    </div>
  );
}

function IssueList({
  issues,
  universe,
  display,
  selected,
  limit,
}: {
  issues: Issue[];
  universe: Issue[];
  display: Display;
  selected: string | null;
  limit: number;
}) {
  return listRows(issues, universe, display.subIssues ? display.nested : "none")
    .slice(0, limit)
    .map(({ issue, depth }) => (
      <Card
        key={issue.key}
        issue={issue}
        selected={selected === issue.key}
        display={display}
        list
        depth={depth}
      />
    ));
}

// --- keyboard ---

function QuickNavigation({ kind }: { kind: "favorites" | "views" | "boards" }) {
  const boards = useStore((s) => s.boards);
  const savedViews = useStore((s) => s.savedViews);
  const favorites = useStore((s) => s.favorites);
  const issues = useStore((s) => s.issues);
  const close = () => ui.send({ type: "overlay.close" });
  const title =
    kind === "views" ? "Open view" : kind === "boards" ? "Open a team / board" : "Open a favorite";
  const choices = navigationChoices(kind, { boards, savedViews, favorites, issues });
  return (
    <Modal label={title} close={close}>
      <Command loop>
        <Command.Input
          autoFocus
          aria-label="Find view or favorite"
          placeholder="Search…"
          className="w-full bg-transparent p-3 outline-none"
        />
        <Command.List>
          <Command.Empty className="p-3 text-fg-3">No saved {kind}</Command.Empty>
          {choices.map((choice) => (
            <Command.Item
              key={choice.id}
              value={choice.name}
              onSelect={() => {
                close();
                const to = choice.destination;
                if ("view" in to) openSavedView(to.view);
                else {
                  const { scope, ...route } = to;
                  navigate(route);
                  if (scope) setScope(to.board, scope);
                }
              }}
              className="p-2 data-[selected=true]:bg-sel"
            >
              {choice.name}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Modal>
  );
}

// --- chrome ---

function Sidebar({ boards }: { boards: Board[] }) {
  const boardId = useStore((s) => s.board);
  const activeView = useActiveView();
  const views = useSavedViews();
  const viewsPage = useStore((s) => s.viewsPage);
  const mine = useStore((s) => s.mine);
  const hidden = useStore((s) => s.sidebarHidden);
  const open = useStore((s) => s.sidebarOpen);
  const inbox = useStore((s) => s.inbox);
  const badge = useInboxBadge();
  if (hidden && !open) return null;
  const close = () => set({ sidebarOpen: false });
  return (
    <>
      {open && (
        <button
          aria-label="Close menu"
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      )}
      <nav
        aria-label="Main navigation"
        // Below 768px the sidebar opens over the page from the Menu button or [, and closes after a pick.
        onClick={(e) => open && (e.target as Element).closest("button") && close()}
        className={`flex w-[244px] shrink-0 flex-col gap-px overflow-y-auto p-2 font-medium ${open ? "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:bg-panel max-md:shadow-lg" : "max-md:hidden"}`}
      >
        <div className="mb-1 flex h-11 items-center gap-2 px-2 text-fg">
          <span className="grid size-[18px] place-items-center rounded-[5px] bg-accent text-[10px] font-semibold text-white">
            bj
          </span>
          better-jira
        </div>
        <SideItem active={inbox} onClick={() => timed("open inbox", () => runShortcut("inbox"))}>
          <Icon name="inbox" /> Inbox
          {badge > 0 && (
            <span data-inbox-badge className="ml-auto text-[12px] text-fg-2">
              {badge}
            </span>
          )}
        </SideItem>
        <SideItem onClick={() => runShortcut("search")}>
          <Icon name="search" /> Search <kbd className="ml-auto">/</kbd>
        </SideItem>
        <SideItem onClick={() => beginCreate()}>
          <Icon name="plus" /> New issue <kbd className="ml-auto">C</kbd>
        </SideItem>
        {/* Like Linear, My issues is a sidebar view rather than a tab beside Active/Backlog/All. */}
        <SideItem
          active={mine && !inbox && !activeView && !viewsPage}
          onClick={() => timed("only mine", () => { navigate({ board: boardId, selected: null, panel: false }); ui.send({ type: "mine.set", mine: !mine }); })}
        >
          <Icon name="user" /> My issues <kbd className="ml-auto">{shortcutLabel("mine")}</kbd>
        </SideItem>

        <div className="group mt-5 mb-1 flex items-center px-2 text-[12px] text-fg-3">
          Boards
          <button
            aria-label="Add board"
            title="Add board"
            onClick={() => ui.send({ type: "overlay.open", overlay: "add-board" })}
            className="ml-auto grid size-5 place-items-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-hover hover:text-fg-2"
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        {boards.map((b) => (
          <SideItem
            key={b.id}
            active={!inbox && !activeView && !viewsPage && b.id === boardId}
            onClick={() =>
              timed("switch board", () => navigate({ board: b.id, selected: null, panel: false }))
            }
          >
            <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-sel text-[9px] font-semibold text-fg-2">
              {b.name[0]}
            </span>
            <span className="truncate">{b.name}</span>
          </SideItem>
        ))}
        {/* Views is a section like Boards: every saved view inline; the heading opens the Views directory. */}
        <button
          onClick={() => navigate({ board: boardId, viewsPage: true, selected: null, panel: false, inbox: false })}
          aria-current={viewsPage || undefined}
          className={`mt-5 mb-1 flex h-6 items-center rounded-md px-2 text-left text-[12px] hover:text-fg-2 ${viewsPage ? "text-fg-2" : "text-fg-3"}`}
        >
          Views
        </button>
        {views.map((v) => (
          <ViewContextMenu key={v.id} view={v}>
            <SideItem active={activeView?.id === v.id} onClick={() => timed("open view", () => openSavedView(v))}>
              <SavedViewIcon view={v} />
              <span className="truncate">{v.name}</span>
            </SideItem>
          </ViewContextMenu>
        ))}
        <ViewFavorites />
        <button
          id="help-menu"
          aria-label="Open Help menu"
          onClick={() => runShortcut("help")}
          className="mt-auto flex items-center justify-between rounded-lg px-2 py-2 text-fg-3 hover:bg-hover"
        >
          Help <kbd>?</kbd>
        </button>
      </nav>
    </>
  );
}

/** Linear's 28px bottom bar under the sidebar and panel; ours carries the perf readout and the local-only note. */
/** Linear's delete dialog instead of a native confirm. Jira deletes the issue's subtasks with it (deleteSubtasks=true), so it names them. */
function DeleteConfirm() {
  const key = useStore((s) => s.deleting),
    issue = useStore((s) => (s.deleting ? s.issues.get(s.deleting) : undefined)),
    issues = useStore((s) => s.issues),
    types = useStore((s) => s.options.types);
  if (!key || !issue) return null;
  const levels = types?.[issue.project?.key ?? ""];
  // Subtasks go with the issue; an epic's own children (level 0 and up) stay in Jira, unparented.
  const subtasks = [...issues.values()].filter(
    (i) => i.parent === key && (levels?.find((t) => t.name === i.type)?.hierarchyLevel ?? -1) < 0,
  );
  const close = () => set({ deleting: null });
  return (
    <Confirm
      title={`Delete "${key} ‒ ${issue.summary}"?`}
      detail={`${
        subtasks.length
          ? `This also deletes its ${subtasks.length} sub-issue${subtasks.length === 1 ? "" : "s"} (${subtasks.map((i) => i.key).join(", ")}). `
          : ""
      }Jira can't restore deleted issues, so this can't be undone.`}
      action={subtasks.length ? `Delete ${subtasks.length + 1} issues` : "Delete"}
      onConfirm={() => {
        close();
        actions.remove(key, true);
      }}
      close={close}
    />
  );
}

function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      aria-live="polite"
      data-toast
      className="fixed right-4 bottom-10 z-50 flex items-center gap-3 rounded-lg border border-line-2 bg-card px-3 py-2 text-[13px] text-fg shadow-lg"
    >
      <div>
        {toast.text}
        {toast.detail && <p className="mt-1 text-[12px] text-fg-3">{toast.detail}</p>}
      </div>
      {toast.undo && (
        <button
          className="text-accent hover:underline"
          onClick={() => {
            if (toast.undo === "inbox") undoInboxToast();
            else undoEdit();
            ui.send({ type: "toast.dismiss" });
          }}
        >
          Undo
        </button>
      )}
      {toast.key && (
        <button
          onClick={() => (
            ui.send({ type: "toast.dismiss" }),
            navigate({
              selected: toast.key,
              panel: true,
              board: get().issues.get(currentKey(toast.key ?? ""))?.board,
            })
          )}
          className="text-accent hover:underline"
        >
          View issue
        </button>
      )}
    </div>
  );
}

function StatusBar() {
  const perf = useStore((s) => s.perf);
  const undo = useStore((s) => s.undoCount),
    redo = useStore((s) => s.redoCount);
  const storage = useStore((s) => s.storage),
    writable = useStore((s) => s.writable),
    pending = useStore((s) => s.pendingWrites),
    writeError = useStore((s) => s.writeError);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 px-4 pb-2 text-[11px] whitespace-nowrap">
      {writable ? (
        <span
          title="Issue edits are written to Jira."
          className="flex min-w-0 items-center gap-1.5 text-emerald-500"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate">Edits write to Jira</span>
        </span>
      ) : (
        <span
          title="Issue changes, files, and view preferences are saved in this browser."
          className="flex min-w-0 items-center gap-1.5 text-amber-500"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="truncate">Local only: nothing is sent to Jira</span>
        </span>
      )}
      {writable && (
        <span
          role="status"
          aria-label="Jira save status"
          data-jira-pending={pending}
          title={writeError?.text}
          className={`flex min-w-0 items-center gap-1 ${writeError && (!pending || writeError.retrying) ? "text-red-500" : "text-fg-3"}`}
        >
          <span className="truncate">
            {pending && writeError?.retrying
              ? `Still sending ${pending} to Jira: ${writeError.key}: ${writeError.text}`
              : pending
                ? `Sending ${pending} to Jira…`
                : writeError
                  ? `Not saved to Jira: ${writeError.key}: ${writeError.text}`
                  : "Saved to Jira"}
          </span>
          {writeError && !pending && (
            <button
              aria-label="Dismiss Jira save error"
              onClick={dismissWriteError}
              className={FOOT_BTN}
            >
              <Icon name="close" />
            </button>
          )}
        </span>
      )}
      <span
        role="status"
        aria-label="Local save status"
        data-storage-status={storage.status}
        className="text-fg-3"
      >
        {storage.status === "saving"
          ? "Saving…"
          : storage.status === "saved"
            ? "Saved locally"
            : storage.status === "loading"
              ? "Opening local data…"
              : "Not saved"}
      </span>
      <span className="-ml-2 flex">
        <button
          aria-label="Undo"
          disabled={!undo}
          onClick={undoEdit}
          title="Undo (⌘Z)"
          className={FOOT_BTN}
        >
          <Icon name="undo" />
        </button>
        <button
          aria-label="Redo"
          disabled={!redo}
          onClick={redoEdit}
          title="Redo (⌘⇧Z)"
          className={FOOT_BTN}
        >
          <Icon name="redo" />
        </button>
        <button
          aria-label="Download backup"
          title="Download your local changes and files"
          onClick={() => void downloadLocalBackup()}
          className={FOOT_BTN}
        >
          <Icon name="download" />
        </button>
      </span>
      <span className="ml-auto truncate font-mono text-emerald-500">{perf}</span>
    </footer>
  );
}

function StorageNotice() {
  const storage = useStore((s) => s.storage);
  if (storage.status !== "error" && !storage.recovered) return null;
  return (
    <div
      role={storage.status === "error" ? "alert" : "status"}
      className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[12px] text-fg-2"
    >
      <span className="mr-auto">{storage.message}</span>
      {storage.status === "error" && (
        <button onClick={() => void retryLocalStorage()} className="text-accent">
          Retry local storage
        </button>
      )}
      <button onClick={() => void downloadLocalBackup()} className="text-accent">
        Download local backup
      </button>
      {storage.recovered && storage.status !== "error" && (
        <button aria-label="Dismiss local recovery notice" onClick={dismissRecoveryNotice}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}

const SideItem = ({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    onClick={onClick}
    aria-current={active || undefined}
    className={`flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}
  >
    {children}
  </button>
);

// Linear's pill button: 28px, 0.5px ring drawn as a shadow, 12px/500.
const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-transparent px-2.5 text-[12px] font-medium";
const CIRCLE =
  "flex h-7 min-w-7 shrink-0 items-center rounded-full bg-btn text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2";

/** Linear's Menu button: below 768px it opens the hidden sidebar. */
function MenuButton() {
  return (
    <button
      aria-label="Menu"
      onClick={() => set({ sidebarOpen: true })}
      className={`${COL_BTN} mr-1 shrink-0 md:hidden`}
    >
      <Icon name="side" />
    </button>
  );
}
// Linear's breadcrumb (linear.app/…/view/…, 2026-11-11 computed styles): 24px links padded 0 5px 0 4px with matching
// negative margins, 16px icon + 6px, 13px/500 text at line-height normal, "›" with 8px sides lifted 2px; hover bg
// --crumb-hover and primary text, only colour animates (0.15s).
const CRUMB_LAST =
  "-ml-1 flex h-6 min-w-0 items-center rounded-lg pr-[5px] pl-1 transition-[color] duration-150 ease-[ease] hover:bg-(--crumb-hover) hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
const CRUMB = `-mr-[5px] ${CRUMB_LAST}`; // the current (last) crumb keeps its right padding, like Linear's current item
const CRUMB_ICON = "mr-1.5 grid w-4 shrink-0 place-items-center";
function CrumbSep({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`mx-2 -mt-0.5 shrink-0 text-fg-3 ${className}`}>›</span>;
}
function BoardBreadcrumbs({ board, issue }: { board: Board; issue?: Issue }) {
  const mine = useStore((s) => s.mine);
  const activeView = useActiveView();
  const custom = !issue && activeView?.kind === "custom" ? activeView : null;
  const openAllIssues = () => openBoardIssues(board.id);
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center text-[13px] leading-[normal] font-medium text-fg-2"
    >
      <MenuButton />
      <button aria-label={board.name} title={board.name} onClick={openAllIssues} className={CRUMB}>
        <span aria-hidden="true" className={CRUMB_ICON}>
          <span className="grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{board.name[0]}</span>
        </span>
        <span className="truncate">{board.name}</span>
      </button>
      <CrumbSep className={issue ? "max-sm:hidden" : ""} />
      {custom ? (
        <>
          <button onClick={() => navigate({ board: board.id, viewsPage: true, selected: null, panel: false, inbox: false })} className={`${CRUMB} shrink-0`}>
            Views
          </button>
          <CrumbSep />
          {/* Linear: the current view is plain text (right-click for its menu), not a link. */}
          <ViewContextMenu view={custom}>
            <span aria-current="page" className="flex h-6 min-w-0 items-center">
              <span className={CRUMB_ICON}><SavedViewIcon view={custom} /></span>
              <h2 className="truncate font-medium">{custom.name}</h2>
            </span>
          </ViewContextMenu>
        </>
      ) : (
        <button
          aria-label={!activeView && mine ? "My issues" : "Issues"}
          aria-current={issue ? undefined : "page"}
          onClick={openAllIssues}
          className={`${CRUMB} shrink-0 ${issue ? "max-sm:hidden" : ""}`}
        >
          {!activeView && mine ? "My issues" : "Issues"}
        </button>
      )}
      {issue && (
        <>
          <CrumbSep />
          {/* The key never truncates (Opus review 4: at 390px it vanished): the title truncates, and below 640px the Issues crumb gives way. */}
          <a aria-current="page" className={CRUMB_LAST} href={issueURL(issue)} target="_blank" rel="noreferrer">
            <span className={CRUMB_ICON}><TypeDot type={issue.type} /></span>
            <span data-crumb-issue className="flex min-w-0">
              <span className="mr-[5.6px] shrink-0 tracking-[-0.24px]">{issue.key}</span>
              <span className="truncate">{issue.summary}</span>
            </span>
          </a>
        </>
      )}
    </nav>
  );
}

function BoardHeader() {
  const activeView = useActiveView();
  const savedViews = useSavedViews();
  const board = useStore((s) => s.boards.find((b) => b.id === s.board));
  const query = useStore((s) => s.query);
  const draft = useStore((s) => s.editorDraft);
  const custom = (draft ?? activeView)?.kind === "custom";
  const details = useStore((s) => s.details);
  const prefs = useViewSettings(board!.id);
  const finding = useStore((s) => s.findInView);
  const findRef = useRef<HTMLInputElement>(null);
  useHotkey(
    "Escape",
    () => {
      set({ findInView: false });
      ui.send({ type: "query.set", query: "" });
      findRef.current?.blur();
    },
    { target: findRef, ignoreInputs: false },
  );
  const favoriteId = activeView?.kind === "custom" ? `view:${activeView.id}` : `board:${board!.id}`;
  const favorite = useStore((s) => s.favorites.includes(favoriteId));
  return (
    <header className="shrink-0">
      <div className="flex h-11 items-center justify-between border-b-[0.5px] border-frame px-2">
        <div className="flex min-w-0 items-center pr-1 pl-2.5 text-[13px] font-medium text-fg-2">
          <BoardBreadcrumbs board={board!} />
          {/* Linear: star, then ⋯ — 28px round buttons, 14px glyphs, 4px apart; hover fills --crumb-hover and whitens the glyph. */}
          <button
            role="switch"
            aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
            aria-checked={favorite}
            onClick={() => toggleFavorite(favoriteId)}
            className={`ml-2 grid size-7 shrink-0 place-items-center rounded-full border-[0.5px] border-transparent transition-[border-color,background-color,color,opacity] duration-150 ease-[ease] hover:bg-(--crumb-hover) ${favorite ? "text-[#f2c94c]" : "text-fg-3 hover:text-fg"}`}
          >
            <Icon name={favorite ? "starred" : "star"} size={14} />
          </button>
          {activeView?.kind === "custom" && <ViewMenu view={activeView}><button aria-label="Issue view options" className="ml-1 grid size-7 shrink-0 place-items-center rounded-full border-[0.5px] border-transparent transition-[border-color,background-color,color,opacity] duration-150 ease-[ease] hover:bg-(--crumb-hover) text-fg-3 hover:text-fg"><Icon name="dots" size={14} /></button></ViewMenu>}
        </div>
        <button
          aria-label="Search issues"
          onClick={() => runShortcut("search")}
          className={`${COL_BTN} ml-auto md:hidden`}
        >
          <Icon name="search" />
        </button>
        <button
          onClick={() => beginCreate()}
          className={`${PILL} pr-2.5 pl-2 text-fg-3 hover:bg-hover hover:text-fg-2`}
        >
          <Icon name="plus" /> New issue
        </button>
      </div>
      {/* Linear: custom views (and their editor) show only the breadcrumb, no team tabs. The editor floats this row's
          controls into its card, so a custom draft collapses the row. */}
      <div className={`flex flex-wrap items-center gap-1 px-2 ${custom && draft ? "" : "min-h-[43.5px] py-1"}`}>
        {!custom && (["active", "backlog", "all"] as const).map((scope) => (
          <button
            key={scope}
            aria-pressed={!activeView && !draft && prefs.scope === scope}
            onClick={() => { navigate({ board: board!.id, selected: null, panel: false }); setScope(board!.id, scope); }}
            className={`${PILL} ${!activeView && !draft && prefs.scope === scope ? "bg-tab-on text-fg shadow-(--tab-on-shadow)" : "bg-tab text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2"}`}
          >
            {scope === "active" ? "Active" : scope === "backlog" ? "Backlog" : "All issues"}
          </button>
        ))}
        {!custom && savedViews.filter(v => v.board === board!.id && v.kind === "tab").map(view => { const on = activeView?.id === view.id || draft?.id === view.id; return <ViewContextMenu key={view.id} view={view}><button aria-pressed={on} onClick={() => openSavedView(view)} className={`${PILL} ${on ? "bg-tab-on text-fg shadow-(--tab-on-shadow)" : "bg-tab text-fg-3 shadow-(--tab-shadow) hover:bg-hover"}`}>{view.name}</button></ViewContextMenu>; })}
        {/* Linear swaps Add new view for the draft tab while a new tab view is being made. */}
        {draft && !draft.id && draft.kind === "tab" ? <span aria-current="page" className={`${PILL} bg-tab-on text-fg-3 shadow-(--tab-on-shadow)`}><SavedViewIcon view={draft} />{draft.name.trim() || "New view"}<Icon name="pencil" size={12} /></span>
          : !custom && !draft && <button className={`${PILL} text-fg-3 hover:bg-hover`} onClick={() => openViewEditor(createViewDraft("tab"))}><Icon name="plus" size={14} />Add new view</button>}
        <div className="ml-auto flex items-center gap-1">
          <BoardControls board={board!} />
        </div>
        <button
          aria-label={details ? "Close details" : "Open details"}
          aria-expanded={details}
          title="Board details"
          onClick={() => (set({ details: !details }), navigate({ panel: false }))}
          className={`${CIRCLE} justify-center`}
        >
          <Icon name="side" />
        </button>
      </div>
      {finding && (
        <input
          id="find-in-view"
          ref={findRef}
          aria-label="Find in view"
          autoFocus
          value={query}
          onChange={(e) => ui.send({ type: "query.set", query: e.target.value })}
          placeholder="Find in view…"
          className="mx-3 mb-2 rounded border border-line-2 bg-card px-3 py-1.5 outline-none"
        />
      )}
      <ViewEditorPage />
      {board && <FilterChips board={board} />}
    </header>
  );
}

// --- board ---

// Linear's bottom-bar button: 28px, radius 8, fg-3.
const FOOT_BTN =
  "grid size-7 place-items-center rounded-lg text-fg-3 hover:bg-hover hover:text-fg-2 disabled:opacity-30 disabled:hover:bg-transparent";
const COL_BTN =
  "grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover hover:text-fg";

function ColumnHeading({
  bucket,
  count,
  display,
  hide,
  create,
}: {
  bucket: Bucket;
  count: number;
  display: Display;
  hide: () => void;
  create: () => void;
}) {
  return (
    <h2 className="flex h-[46px] shrink-0 items-center gap-2 pr-2 pl-3.5 text-[13px]">
      {bucket.status ? (
        <StatusIcon status={bucket.status} />
      ) : display.columns === "priority" ? (
        <PriorityIcon name={bucket.name} />
      ) : (
        <Icon name="layers" />
      )}
      <span className="ml-0.5 truncate font-medium text-fg-2">{bucket.name}</span>
      <span className="text-fg-3">{count}</span>
      <GroupMenu name={bucket.name} hide={hide} />
      <button
        aria-label={`New issue in ${bucket.name}`}
        onClick={create}
        className={`-ml-1.5 ${COL_BTN}`}
      >
        <Icon name="plus" />
      </button>
    </h2>
  );
}

/** `header={false}` in swimlanes: Linear shows one sticky header row above all lanes. */
function ColumnView({
  bucket,
  issues,
  selected,
  display,
  scroll,
  onDrop,
  hide,
  create,
  header = true,
  limit,
}: {
  bucket: Bucket;
  limit: number;
  issues: Issue[];
  selected: string | null;
  display: Display;
  scroll: boolean;
  onDrop: (key: string, before?: string) => void;
  hide: () => void;
  create: () => void;
  header?: boolean;
}) {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const key = e.dataTransfer.getData("text/plain");
        onDrop(
          key,
          [...e.currentTarget.querySelectorAll<HTMLElement>("[data-key]")].find((c) => {
            const r = c.getBoundingClientRect();
            return c.dataset.key !== key && r.top + r.height / 2 > e.clientY;
          })?.dataset.key,
        );
      }}
      className={`flex w-[340px] shrink-0 flex-col rounded-t-[5px] bg-[linear-gradient(var(--col-top),var(--col-top)_46px,var(--col-bottom))] ${over ? "ring-1 ring-accent" : ""}`}
    >
      {header && (
        <ColumnHeading
          bucket={bucket}
          count={issues.length}
          display={display}
          hide={hide}
          create={create}
        />
      )}
      <div className={`flex-1 px-[9px] pt-[9px] ${scroll ? "overflow-y-auto" : ""}`}>
        {issues.slice(0, limit).map((i) => (
          <Card key={i.key} issue={i} selected={i.key === selected} display={display} />
        ))}
      </div>
    </section>
  );
}

// Linear's card chip: 24px pill, 0.5px border, 12px/450 muted text after a 14px icon.
const CHIP =
  "flex h-6 max-w-[224px] shrink-0 items-center rounded-full border-[0.5px] border-chip-line bg-card px-2 text-[12px] font-[450] text-card-fg-3";

const Card = memo(function Card({
  issue,
  selected,
  display: d,
  list = false,
  depth = 0,
}: {
  issue: Issue;
  selected: boolean;
  display: Display;
  list?: boolean;
  depth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => void (selected && ref.current?.scrollIntoView({ block: "nearest" })), [selected]);
  // A right-clicked card is highlighted only while its menu is open, as Linear does; it never becomes the selection.
  const menu = useStore((s) => !!s.overlay && s.target === issue.key);
  const lit = selected || menu;
  const show = (p: Property) => d.properties.includes(p);
  const clock = useStore((s) => (d.properties.includes("statusAge") ? s.clock : 0));
  const status = statusOf(issue);
  const properties = (
    <>
      {show("priority") && (
        <span
          title={issue.priority ?? "No priority"}
          className={list ? "text-fg-3" : `${CHIP} px-[4.5px]`}
        >
          <PriorityIcon name={issue.priority} />
        </span>
      )}
      {show("type") && issue.type && (
        <span className={CHIP}>
          <TypeDot type={issue.type} />
          <span className="ml-1.5">{issue.type}</span>
        </span>
      )}
      {show("project") && issue.project && (
        <span title={issue.project.name} className={CHIP}>
          <Icon name="layers" />
          <span className="ml-1.5 truncate">{issue.project.name}</span>
        </span>
      )}
      {show("labels") && issue.labels.slice(0, list ? 1 : 2).map((l) => <Label key={l} name={l} />)}
      {show("labels") && issue.labels.length > (list ? 1 : 2) && (
        <span title={issue.labels.join(", ")} className={CHIP}>
          +{issue.labels.length - (list ? 1 : 2)}
        </span>
      )}
      {show("comments") && commentCount(issue) > 0 && (
        <span className={CHIP} aria-label={`${commentCount(issue)} comments`}>
          <Icon name="comment" />
          <span className="ml-1.5">{commentCount(issue)}</span>
        </span>
      )}
      {show("links") && !!issue.links?.length && (
        <span title={issue.links.join("\n")} className={CHIP}>
          <Icon name="external" />
          <span className="ml-1.5">{issue.links.length}</span>
        </span>
      )}
      {show("creator") && issue.creator && (
        <span title={`Created by ${issue.creator.name}`}>
          <Avatar user={issue.creator} size={18} />
        </span>
      )}
      {show("due") && issue.due && (
        <span className={CHIP}>
          <Icon name="calendar" />
          <span className="ml-1.5">{shortDate(issue.due, undefined, true)}</span>
        </span>
      )}
      {show("milestone") &&
        issue.milestones?.map((v) => (
          <span key={v.id} title={`Jira fix version: ${v.name}`} className={CHIP}>
            <Icon name="layers" />
            <span className="ml-1.5 truncate">{v.name}</span>
          </span>
        ))}
      {show("statusAge") && issue.statusSince && (
        <span
          className={CHIP}
          title={`In current status since ${new Date(issue.statusSince).toLocaleString()}`}
        >
          <Icon name="calendar" />
          <span className="ml-1.5">
            {statusDuration(issue.statusSince, Math.max(clock, Date.now()))} in status
          </span>
        </span>
      )}
      {show("pullRequests") && !!issue.prCount && (
        <span className={CHIP} title="Pull requests reported by Jira's development summary">
          <Icon name="external" />
          <span className="ml-1.5">
            {issue.prCount} PR{issue.prCount === 1 ? "" : "s"}
          </span>
        </span>
      )}
    </>
  );
  const dates = (
    <>
      {show("created") && issue.created && (
        <span title={`Created ${issue.created}`}>Created {shortDate(issue.created)}</span>
      )}
      {show("updated") && (
        <span title={`Updated ${issue.updated}`}>
          {list ? "" : "Updated "}
          {shortDate(issue.updated)}
        </span>
      )}
    </>
  );
  return (
    <div
      className={
        list
          ? "[content-visibility:auto] [contain-intrinsic-size:auto_44px]"
          : "pb-2 [contain-intrinsic-size:auto_124px] [content-visibility:auto] [overflow-clip-margin:4px]"
      }
    >
      <div
        ref={ref}
        data-key={issue.key}
        data-selected={selected || undefined}
        data-menu={menu || undefined}
        role="button"
        aria-label={`${issue.key} ${issue.summary}`}
        tabIndex={0}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            navigate({
              selected: issue.key,
              panel: true,
              view: e.key === "Enter" ? "page" : "side",
            });
          }
        }}
        onClick={() =>
          timed(`open ${issue.key}`, () => navigate({ selected: issue.key, panel: true }))
        }
        // Linear's row menu: Issue options at the pointer, on this issue, without selecting it.
        onContextMenu={(e) => {
          e.preventDefault();
          set({ target: issue.key, issueOptionsPoint: { x: e.clientX + 3, y: e.clientY } });
          ui.send({ type: "overlay.open", overlay: "options" });
        }}
        className={
          list
            ? `flex min-h-11 cursor-default items-center gap-3 border-b border-line px-5 outline-none focus-visible:ring-1 focus-visible:ring-accent ${lit ? "bg-hover shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-hover"}`
            : `relative flex min-h-[42px] cursor-default flex-col rounded-lg p-2 shadow-(--card-shadow) outline-none focus-visible:ring-1 focus-visible:ring-accent ${lit ? "bg-card-hover ring-1 ring-accent" : "bg-card hover:bg-card-hover"}`
        }
        style={list && depth ? { paddingLeft: 20 + depth * 20 } : undefined}
      >
        {list ? (
          <>
            {show("id") && (
              <span className="w-[85px] shrink-0 text-[12px] text-fg-3 tabular-nums">
                {depth > 0 && "↳ "}
                {issue.key}
              </span>
            )}
            {show("status") && status && (
              <span title={status.name}>
                <StatusIcon status={status} />
              </span>
            )}
            <span className="min-w-32 flex-1 truncate font-medium">{issue.summary}</span>
            <span className="flex max-w-[45%] shrink-0 items-center gap-2 overflow-hidden">
              {properties}
            </span>
            {show("assignee") && <Avatar user={issue.assignee} size={18} />}
            <span className="flex shrink-0 gap-2 text-[11px] text-fg-3">{dates}</span>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 pr-[34px] pl-1">
              {show("id") && (
                <span className="truncate text-[12px] leading-[normal] font-[450] tracking-[-0.24px] text-card-fg-3 tabular-nums">
                  {issue.key}
                </span>
              )}
              <div className="flex items-start gap-1.5">
                {show("status") && status && (
                  <span className="mt-px" title={status.name}>
                    <StatusIcon status={status} />
                  </span>
                )}
                <span className="line-clamp-2 text-[13px] leading-4 font-medium [overflow-wrap:anywhere]">
                  {issue.summary}
                </span>
              </div>
            </div>
            {show("assignee") && (
              <span className="absolute top-2 right-2">
                <Avatar user={issue.assignee} size={18} />
              </span>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1 overflow-hidden">
              {properties}
            </div>
            {(show("updated") || show("created")) && (
              <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-3 pl-px text-[12px] font-[450] text-card-fg-3">
                {dates}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

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

const IssueView = memo(function IssueView({
  issue,
  page,
  fill,
}: {
  issue: Issue;
  page: boolean;
  fill?: boolean;
}) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const favorite = useStore((s) => s.favorites.includes(issue.key)),
    optionsOpen = useStore((s) => s.overlay === "options");
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
      <button
        role="switch"
        aria-label={favorite ? "Remove issue from favorites" : "Add issue to favorites"}
        aria-checked={favorite}
        onClick={() => toggleFavorite(issue.key)}
        className={`${ICON_BTN} ${favorite ? "text-[#f2c94c]!" : ""}`}
      >
        <Icon name={favorite ? "starred" : "star"} size={16} />
      </button>
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
  useStore((s) => s.issues); // re-render when the list changes; nav.cols is rebuilt by the board in the same render
  useStore((s) => s.mine);
  useStore((s) => s.query);
  useStore((s) => s.preferences);
  const flat = flatNav();
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
function Properties({ issue }: { issue: Issue }) {
  const status = statusOf(issue);
  const issues = useStore((s) => s.issues);
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
              rows.map((r) => {
                const target = issues.get(r.key),
                  status = target && statusOf(target);
                return (
                  <div
                    key={r.key}
                    data-relation={`${kind}:${r.key}`}
                    className="group/relation flex max-w-full items-center gap-2"
                  >
                    {target ? (
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
                        <span className="truncate">{r.key}</span>
                      </span>
                    )}
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
                );
              }),
            )}
          </Fragment>
        ) : null;
      })}
    </div>
  );
}

/** Edited in place like Linear: changes save 600ms after typing stops and on blur, so a reload never loses them. */
function Description({ issue }: { issue: Issue }) {
  const focus = useStore((s) => s.editDesc);
  const f = useStore((s) => s.full.get(issue.key));
  const error = useStore((s) => s.fullErrors.get(issue.key));
  // A description Jira refused stays in the editor (beside Jira's copy in the store) until a version is picked or it is edited.
  const refusal = f?.descriptionError,
    content = f ? (f.descriptionRejected ?? f.fields.description ?? "") : undefined;
  const stored = content !== undefined ? JSON.stringify(normalizeDocument(content)) : "";
  const shown = useRef(stored),
    typed = useRef<AdfDocument | null>(null),
    section = useRef<HTMLElement>(null);
  const [revision, setRevision] = useState(0),
    [focused, setFocused] = useState(false),
    [restored, setRestored] = useState(0);
  // Jira's text changed under unsaved typing; or Jira refused the save because someone else changed it. Saves wait until the person picks a version.
  const [conflict, setConflict] = useState(false),
    held = useRef(false);
  held.current = conflict || refusal === DESCRIPTION_CONFLICT;
  const draftKey = `better-jira:description-draft:${get().namespace}:${issue.key}`;
  const [autosave] = useState(() =>
    createActor(
      autosaveMachine.provide({
        actions: {
          keepDraft: (_, doc) => {
            try {
              // With the text it started from, so a reload can tell whether Jira changed meanwhile.
              localStorage.setItem(draftKey, JSON.stringify({ doc, base: shown.current }));
            } catch {
              /* autosave still runs */
            }
          },
          commit: (_, doc) => {
            if (!doc || held.current) return;
            shown.current = JSON.stringify(normalizeDocument(doc));
            typed.current = null;
            actions.description(currentKey(issue.key), doc);
            void flushLocalChanges().then(() => {
              try {
                if (autosave.getSnapshot().matches("clean")) localStorage.removeItem(draftKey);
              } catch {
                /* best effort */
              }
            });
          },
        },
      }),
      { inspect: inspector(`autosave ${issue.key}`) },
    ).start(),
  );
  const show = (doc: string) => {
    shown.current = doc;
    setRevision((r) => r + 1);
  };
  const textOf = (doc: string) => adfToText(JSON.parse(doc || "null"));
  // Undo, redo, a rolled-back save, a restored revision or someone else's edit replaces the document under the editor.
  // Only unsaved typing asks first (R2-D1): a focused editor with nothing unsaved takes Jira's text too, but not a mere media id swap after its own save.
  useEffect(() => {
    if (!stored || stored === shown.current || conflict) return;
    const inside = !!section.current?.contains(document.activeElement);
    if (autosave.getSnapshot().matches("dirty") && textOf(stored) !== textOf(shown.current))
      setConflict(true);
    else if (!inside) show(stored);
    else if (textOf(stored) !== textOf(shown.current)) {
      show(stored);
      ui.send({ type: "description.edit" });
    }
  }, [stored, focused, conflict, restored, autosave]);
  useEffect(() => {
    const restore = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== issue.key) return;
      shown.current = "";
      typed.current = null;
      setConflict(false);
      setRestored((n) => n + 1);
    };
    addEventListener("jira-restored", restore);
    return () => removeEventListener("jira-restored", restore);
  }, [issue.key]);
  const resolve = (keep: boolean) => {
    // Typing not yet saved is kept (or dropped) below, never committed on the way.
    held.current = true;
    autosave.send({ type: "flush" });
    const key = currentKey(issue.key);
    if (keep) {
      const doc = typed.current ?? normalizeDocument(JSON.parse(shown.current));
      shown.current = JSON.stringify(normalizeDocument(doc));
      typed.current = null;
      setConflict(false);
      held.current = false;
      actions.description(key, doc);
      void flushLocalChanges();
    } else {
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* best effort */
      }
      // The discarded text goes to the description history, and nothing of it is sent later (R2-D1).
      actions.discardDescription(key, typed.current ?? undefined);
      typed.current = null;
      setConflict(false);
      show(JSON.stringify(normalizeDocument(get().full.get(key)?.fields.description ?? "")));
    }
    // Back to the editor, not the page: typing must not run board shortcuts (R2-D5).
    ui.send({ type: "description.edit" });
  };
  // A reload in the autosave window leaves the typed draft in localStorage: save it, unless Jira's text changed since it started (R2-D1, R2-D2).
  useEffect(() => {
    if (!f) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved = JSON.parse(raw),
        doc: AdfDocument = saved?.type === "doc" ? saved : saved.doc,
        base: string | undefined = saved?.type === "doc" ? undefined : saved.base;
      if (textOf(JSON.stringify(doc)) === textOf(stored)) localStorage.removeItem(draftKey);
      else if (held.current || (base && textOf(base) !== textOf(stored))) {
        typed.current = doc;
        if (!held.current) setConflict(true);
        setRevision((r) => r + 1);
      } else {
        autosave.send({ type: "change", doc });
        autosave.send({ type: "flush" });
        setRevision((r) => r + 1);
      }
    } catch {
      /* ignore a broken draft */
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Prefetch and draft recovery follow selection/load transitions, not render-local arrays or refreshed full issue objects.
  }, [!!f]);
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
  useEffect(() => () => autosave.send({ type: "flush" }), [autosave]);
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
          {held.current && (
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
        <RichEditor
          key={revision}
          id="description"
          inline
          selectionToolbar
          scope={`${issue.key}:description`}
          onLateMedia={(merge) =>
            actions.description(issue.key, merge(get().full.get(issue.key)?.fields.description))
          }
          initial={typed.current ?? content}
          onFiles={(files) => addIssueFiles(issue.key, files)}
          issueKey={issue.key}
          attachments={issue.attachments}
          placeholder="Add description…"
          onChange={(doc) => {
            typed.current = doc;
            autosave.send({ type: "change", doc });
          }}
          onBlur={() => autosave.send({ type: "flush" })}
        />
      )}
    </section>
  );
}

function Activity({ issue, f }: { issue: Issue; f: any }) {
  const [composer, setComposer] = useState(0),
    composerFiles = useDraftFiles(issue.key);
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
      <div className="mt-[14px]">
        {/* A new key clears the box after sending; autoFocus keeps the caret in it. */}
        <RichEditor
          key={`${composer}:${restored}`}
          initial={composer && !restored ? "" : draft}
          variant="comment"
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

const MENU =
  "overflow-hidden rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] " +
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fg-3 " +
  "[&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-default [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 " +
  "[&_[cmdk-item][data-selected=true]]:bg-sel [&_[cmdk-item][data-selected=true]]:text-fg";

function Overlay({
  children,
  label = "Search issues and commands",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Modal label={label} close={() => ui.send({ type: "overlay.close" })}>
      {children}
    </Modal>
  );
}

/** Linear's status and assignee menus (RAJ-52): under the property in the issue view, else under the selected card. */
function StatusPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  const board = boardOf(issueKey);
  if (!issue || !board) return null;
  const statuses = board.columns.flatMap((c) => c.statuses.map((s) => ({ ...s, column: c.name })));
  return (
    <PropertyMenu
      label="Change status"
      placeholder="Change status…"
      hotkey="S"
      anchor={issueAnchor("prop-status", issueKey)}
      close={() => ui.send({ type: "overlay.close" })}
      current={statusOf(issue)?.name}
    >
      {statuses.map((s, i) => (
        <PickerRow
          key={s.id}
          value={s.name}
          keywords={[s.column]}
          icon={<StatusIcon status={s} />}
          current={s.id === issue.status}
          number={i < 9 ? i + 1 : undefined}
          onSelect={() => actions.status(issueKey, s.id)}
        >
          {s.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}

function AssignPicker({ issueKey }: { issueKey: string }) {
  const current = useStore((s) => s.issues.get(issueKey)?.assignee);
  const users = useAssignableUsers();
  const value = (u: User) => `${u.name} ${u.id}`;
  return (
    <PropertyMenu
      label="Assign issue"
      placeholder="Assign to…"
      hotkey="A"
      anchor={issueAnchor("prop-assignee", issueKey)}
      close={() => ui.send({ type: "overlay.close" })}
      current={current ? value(current) : "No assignee"}
    >
      <PickerRow
        value="No assignee"
        icon={<Avatar user={null} size={16} />}
        current={!current}
        number={0}
        onSelect={() => actions.assign(issueKey, null)}
      >
        No assignee
      </PickerRow>
      {users.map((u, i) => (
        <PickerRow
          key={u.id}
          value={value(u)}
          icon={<Avatar user={u} size={16} />}
          current={current?.id === u.id}
          number={i < 9 ? i + 1 : undefined}
          onSelect={() => actions.assign(issueKey, u)}
        >
          {u.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}

type Cmd = { name: string; hint?: string; icon?: ReactNode; disabled?: boolean; run: () => void };
/** A palette command that runs a shortcut, so the hint shown is the key that does the same thing. */

function Palette({ searchOnly = false }: { searchOnly?: boolean }) {
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  useStore((s) => s.mine);
  useStore((s) => s.view);
  const [scope, setScope] = useState(searchOnly || get().document ? null : get().selected); // ⌘K acts on the selected issue; Backspace drops it
  const [q, setQ] = useState("");
  const scoped = scope ? issues.get(scope) : undefined;
  const activeView = useActiveView();
  const overlay = useOverlayFilters();
  const favorites = useStore(s => s.favorites);
  const [deletingView, setDeletingView] = useState(false);
  const [savingTo, setSavingTo] = useState(false);
  const viewAction = (run: () => void) => () => { ui.send({ type: "overlay.close" }); run(); };
  const viewCommands: Cmd[] = activeView && !searchOnly ? [
    { name: "Edit view…", run: viewAction(() => openViewEditor(editViewDraft(activeView.id))) },
    { name: "Save to…", run: () => { setSavingTo(true); setQ(""); } },
    { name: favorites.includes(`view:${activeView.id}`) ? "Unfavorite view" : "Favorite view", hint: shortcutLabel("view-favorite"), run: viewAction(() => toggleFavorite(`view:${activeView.id}`)) },
    { name: "Make a copy as new view…", run: viewAction(() => openViewEditor(duplicateViewDraft(activeView.id))) },
    { name: "Delete view", run: () => setDeletingView(true) },
  ] : [];

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length)
      return searchOnly
        ? [...issues.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 20)
        : [];
    const exact = q.trim().toUpperCase();
    // Exact key, then title matches (exact, prefix, whole word…), then the most recently updated.
    const rank = (i: Issue) => {
      const title = matchRank(i.summary, q);
      return i.key === exact ? -1 : title < 0 ? 6 : title;
    };
    return [...issues.values()]
      .filter((i) => words.every((w) => `${i.key} ${i.summary}`.toLowerCase().includes(w)))
      .map((i) => [rank(i), i] as const)
      .sort(([ra, a], [rb, b]) => ra - rb || (a.updated < b.updated ? 1 : -1))
      .slice(0, 50)
      .map(([, i]) => i);
  }, [q, issues, searchOnly]);

  const command = (entry: (typeof shortcuts)[number]): Cmd => ({
    name: entry.label?.() ?? entry.name,
    hint: shortcutLabel(entry.id),
    run: () => {
      ui.send({ type: "overlay.close" });
      runShortcut(entry.id);
    },
  });
  // Only commands that would do something now, as Linear lists them.
  const issueCmds: Cmd[] = scoped
    ? shortcuts.filter((s) => s.issue && shortcutApplies(s)).map(command)
    : [];
  const general: Cmd[] = searchOnly
    ? []
    : [
        ...shortcuts
          .filter(
            (s, i, a) =>
              !s.issue &&
              shortcutApplies(s) &&
              s.id !== "commands" &&
              a.findIndex((other) => other.name === s.name) === i,
          )
          .map(command),
        ...boards
          .filter((b) => b.id !== boardId)
          .map((b): Cmd => ({
            name: `Switch to ${b.name}`,
            run: () => {
              ui.send({ type: "overlay.close" });
              navigate({ board: b.id, selected: null, panel: false });
            },
          })),
      ];
  // Best match first, so Enter runs the command whose name was typed.
  const ranked = (cmds: Cmd[]) =>
    cmds
      .map((c) => [q.trim() ? matchRank(c.name, q) : 0, c] as const)
      .filter(([r]) => r >= 0)
      .sort(([a], [b]) => a - b);
  // Save to… mirrors the filter row's Save menu, so it is offered even before any temporary filter exists.
  const mergeable = !!activeView && !!filterCount(overlay) && canMergeOverlay(activeView.filters, overlay);
  const groups = savingTo && activeView ? [{ heading: "Save to", rows: ranked([
    { name: filterCount(overlay) && !mergeable ? "Cannot merge these filters into the view" : "Save to this view", hint: shortcutLabel("view-save"), disabled: !mergeable, run: viewAction(() => { void saveOverlayToView().catch(e => set({ perf: String(e) })); }) },
    { name: "Create new view…", hint: shortcutLabel("view-create"), run: viewAction(createToolbarView) },
  ]) }] : [
    { heading: scoped?.key ?? "", rows: ranked(issueCmds) },
    { heading: `View · ${activeView?.name ?? ""}`, rows: ranked(viewCommands) },
    { heading: "Views", rows: ranked(searchOnly ? [] : [{ name: "Create view…", run: viewAction(() => openViewEditor(createViewDraft("custom"))) }]) },
    { heading: "General", rows: ranked(general) },
  ]
    .filter((g) => g.rows.length)
    .sort((a, b) => a.rows[0]![0] - b.rows[0]![0]);
  const item = (c: Cmd) => (
    <Command.Item key={c.name} value={`cmd:${c.name}`} disabled={c.disabled} className="data-[disabled=true]:opacity-50" onSelect={c.run}>
      <span className="grid w-4 shrink-0 place-items-center text-fg-3">{c.icon}</span>
      <span className="flex-1 truncate">{c.name}</span>
      {c.hint && <kbd>{c.hint}</kbd>}
    </Command.Item>
  );

  if (deletingView && activeView) return <ViewDeleteDialog view={activeView} close={() => { setDeletingView(false); ui.send({ type: "overlay.close" }); }} />;
  return (
    <Overlay label={searchOnly ? "Search issues" : "Search issues and commands"}>
      <Command shouldFilter={false} loop className={`w-full ${MENU}`}>
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {scoped && (
            <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-sel px-2 text-[12px] text-fg-2">
              <TypeDot type={scoped.type} />
              {scoped.key}
            </span>
          )}
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && (savingTo ? setSavingTo(false) : setScope(null))}
            placeholder={
              scoped
                ? "Type a command, or ⌫ to search everything…"
                : "Search issues or type a command…"
            }
            className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
          />
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-3 text-fg-3">No results</Command.Empty>
          {groups.map((g) => (
            <Command.Group key={g.heading} heading={g.heading}>
              {g.rows.map(([, c]) => item(c))}
            </Command.Group>
          ))}
          {results.length > 0 && (
            <Command.Group
              heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}
            >
              {results.map((i) => (
                <Command.Item
                  key={i.key}
                  value={i.key}
                  onSelect={() =>
                    timed(
                      `open ${i.key}`,
                      () => (
                        ui.send({ type: "overlay.close" }),
                        navigate({ board: i.board, selected: i.key, panel: true }),
                        ui.send({ type: "query.set", query: "" })
                      ),
                    )
                  }
                >
                  {(() => {
                    const s = statusOf(i);
                    return s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />;
                  })()}
                  <span className="w-[88px] shrink-0 text-[12px] tracking-[-0.24px] text-fg-3">
                    {i.key}
                  </span>
                  <span className="flex-1 truncate">{i.summary}</span>
                  <Avatar user={i.assignee} size={18} />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}

export default App;
