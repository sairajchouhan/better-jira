import { fullTime } from "@/client/features/issue/issue-dates";
import { type Board, type Issue } from "@/shared/issue-model";
import { epicLocked, epicName, epicOf } from "@/shared/epics";
import { VirtualGridList, type ListDrop } from "@/client/components/virtual-grid-list";
import { useDragAutoScroll } from "@/client/components/drag-auto-scroll";
import { isMyIssues } from "@/client/features/navigation/navigation";
import { personIssues } from "@/shared/people";
import { useEffectiveMine, useActiveView, useOverlayFilters } from "@/client/features/views/saved-views";
import {
  clearFilters,
  hideGroup,
  showGroup,
  toggleAllCollapsed,
  toggleCollapsed,
  useEffectiveSettings,
} from "@/client/features/views/view-settings";
import { collapseClick, collapseTip } from "@/client/features/views/group-collapse";
import { ViewDetails, ResultsFeedback } from "@/client/features/views/views-navigation";
import { resultFeedback, type ResultPage } from "@/client/features/views/views-navigation-model";
import { PersonEmptyState, ScopeEmptyState } from "@/client/features/views/empty-states";
import { useRegisterViewGroups } from "@/client/features/views/view-groups";
import { GroupIcon } from "@/client/features/views/group-icon";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { Badge, IconMenuButton } from "@/client/components/badge";
import { PropertyPicker, type IssueField } from "@/client/features/issue/personal-controls";
import { LinkBadges, PullRequestBadge, SubIssueBadge } from "@/client/features/issue/card-badges";
import { DueIcon, Icon, LabelDot, PriorityIcon, StatusIcon, TypeDot } from "@/client/components/icons";
import { ME, get, set, timed, useStore, statusOf, issueBoardId } from "@/client/state/store";
import { actions, beginCreateInView } from "@/client/state/issue-actions";
import { loadFull } from "@/client/state/server-data";
import { navigate, preloadOnHover, ui } from "@/client/features/navigation/app-navigation";
import { followPeek, togglePeek } from "@/client/features/views/view-peek-state";
import { movedPointer } from "@/client/components/pointer-intent";
import { openInNewTabOnMiddleClick } from "@/client/features/navigation/middle-click";
import { appURL } from "@/client/features/issue/issue-urls";
import {
  myIssuesBoard,
  boardColumns,
  draftForGroup,
  drawnGroups,
  groupLayout,
  groupVisibility,
  layoutOrder,
  listRows,
  selectIssues,
  displayHiddenCount,
  resultsFeedback,
  statusDuration,
  type Bucket,
  type Display,
  type Property,
} from "@/shared/view-model";
import { BoardDetails, GroupMenu, groupMenuEntries } from "@/client/features/issue/personal-controls";
import { ContextMenu } from "@/client/components/action-menu";
import { Avatar } from "@/client/components/avatar";
import { shortDate } from "@/client/lib/due-date";
import { Button, IconButton } from "@/client/components/button";
import { CountBadge } from "@/client/components/count-badge";
import { Text } from "@/client/components/text";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { dropAll, dropPlan } from "./board-drop";
import { record } from "@/client/state/undo-history";
import "./board-column.css";
import { onBoard } from "@/shared/board-membership";
import { issueKeyURL } from "@/client/features/issue/issue-urls";
// Memoised: an overlay opening (⌘K) re-renders App, and must not re-render every board.
export const BoardView = memo(function BoardView({
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
  const personal = useStore(isMyIssues);
  const boards = useStore(s => s.boards);
  board = useMemo(() => personal ? myIssuesBoard(boards, board) : board, [personal, boards, board]);
  const activeView = useActiveView();
  const draft = useStore(s => s.editorDraft);
  const editedView = useStore(s => s.savedViews.find(v => v.id === draft?.id));
  const detailView = draft && editedView ? { ...editedView, ...draft, id: editedView.id } : activeView;
  const overlay = useOverlayFilters();
  const mine = useEffectiveMine();
  const person = useStore((s) => s.person);
  const personTab = useStore((s) => s.personTab);
  // The personal page lists the open person's tab: my Assigned issues by default (BJ-28), or another user's (BJ-77).
  const who = useMemo(
    () => (personal ? personIssues(person ?? ME.id, personTab, ME.id) : false),
    [personal, person, personTab],
  );
  const query = useStore((s) => s.query);
  const details = useStore((s) => s.details);
  const panel = useStore((s) => s.panel);
  const prefs = useEffectiveSettings(board.id);
  const d = prefs.display;
  const [hiddenOpen, setHiddenOpen] = useState(true);
  const all = useMemo(() => [...issues.values()], [issues]);
  const visible = useMemo(
    () => selectIssues(all, board, prefs, who || mine, query, ME.id, Date.now(), personal),
    [all, board, prefs, who, mine, query, personal],
  );
  const universe = useMemo(() => personal ? all : all.filter((i) => onBoard(i, board.id)), [all, board.id, personal]);
  const columns = useMemo(
    () => boardColumns(visible, board, prefs, universe),
    [visible, board, prefs, universe],
  );
  const collapsed = prefs.collapsed[d.columns] ?? [];
  // One pass per data change: shown and hidden groups, a list's rows per group, a board's cards per lane and column.
  const groups = useMemo(() => groupVisibility(columns, prefs), [columns, prefs]);
  const layout = useMemo(
    () => ({ ...groups, ...groupLayout(groups.show, visible, board, d, universe) }),
    [groups, visible, board, d, universe],
  );
  // The Group ordering panel lists the groups this view shows (Linear's ViewOptionsGroupsContext), even while a filter
  // leaves none to draw.
  useRegisterViewGroups(
    board.id,
    useMemo(() => (active ? { columns, hidden: layout.hidden, hiddenIds: layout.hiddenIds } : null), [active, columns, layout]),
  );
  const feedback = useMemo(
    () => resultsFeedback(all, board, prefs, activeView, { overlay, query, mine }, who, ME.id),
    [all, board, prefs, activeView, overlay, query, mine, who],
  );
  // One answer for what the results say; any zero state (all but a partial result) stands in for the groups.
  const displayHidden = useMemo(
    () => displayHiddenCount(all, board, prefs, who || mine, query, ME.id, Date.now(), personal),
    [all, board, prefs, who, mine, query, personal],
  );
  const page: ResultPage = activeView ? "view" : personal ? "person" : "tab";
  const result = resultFeedback(visible.length, feedback.baseline, page, feedback.temporary, displayHidden);
  const zeroState = !!result && result.kind !== "partial";
  const { hidden, hiddenIds, show } = drawnGroups(layout, zeroState);
  // The prefetch order follows the cards and rows just laid out, so which groups show is decided once.
  const order = useMemo(() => layoutOrder(layout.show, layout, prefs, universe), [layout, prefs, universe]);
  useEffect(() => {
    if (!active || !selected) return;
    if (!get().fullErrors.get(selected)) loadFull(selected);
    const flat = order.flat();
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
  // Linear offers Show only for a column the user hid; an empty column comes back only through Show empty columns.
  const reveal = (id: string) => showGroup(board.id, id);
  const collapse = (id: string) => toggleCollapsed(board.id, [id]);
  const createIn = (bucket: Bucket, row?: Bucket) =>
    beginCreateInView({
      ...draftForGroup(d.columns, bucket.id, board, universe, prefs.scope),
      ...(row ? draftForGroup(d.rows, row.id, board, universe, prefs.scope) : {}),
    });
  const clearAll = () => {
    clearFilters(board.id);
    ui.send({ type: "query.set", query: "" });
    ui.send({ type: "mine.set", mine: personal || (activeView?.mine ?? false) });
    set({ findInView: false });
  };
  // One feedback, placed by layout: the zero state above the groups, else the list's last row or the board's footer.
  const empty = personal
    ? <PersonEmptyState tab={personTab} person={person} />
    : <ScopeEmptyState scope={prefs.scope} />;
  const results = <ResultsFeedback feedback={result} empty={empty} clear={clearAll} layout={d.layout} />;
  const boardScroller = useRef<HTMLDivElement>(null);
  useDragAutoScroll(boardScroller);
  return (
    <div className={`${shown ? "flex" : "hidden"} min-w-0 min-h-0 flex-1`}>
      <div className="relative flex min-w-0 min-h-0 flex-1 flex-col" data-layout={d.layout}>
        {!visible.length && results}
        {d.layout === "list" ? (
          <div data-scroll-restoration-id={`board-${board.id}`} className="ui-scroll-stable flex-1 overflow-auto pb-2">
            {/* Groups stack with no margin between them (BJ-241). Linear's list header (36px), group or sub-group, keeps 2px below
                it (ListCell's header row `marginBottom: e.marginBottom ?? 2`), and each group and sub-group ends on a 2px padding,
                collapsed or not. The scroller pads 0 above the first header and 8px below the last row (live). */}
            {show.map((c, ci) => (
              <section key={c.id} className="pb-0.5">
                <GroupHeading
                  bucket={c}
                  display={d}
                  collapsed={collapsed.includes(c.id)}
                  toggle={() => collapse(c.id)}
                  toggleAll={() => toggleAllCollapsed(board.id, show.map((g) => g.id), c.id)}
                  hide={() => hide(c.id)}
                  create={() => createIn(c)}
                />
                {!collapsed.includes(c.id) &&
                  layout.sections[ci]!.map((r) => (
                      <div key={r.id} className={d.rows !== "none" ? "pb-0.5" : undefined}>
                        {/* Linear's sub-group divider is listHeaderHeight tall too (IssueList `heightPerLevel` [36, 36, 44]) and,
                            with `stickyHeaderLevels: 1`, scrolls with its rows: only the group header sticks. */}
                        {d.rows !== "none" && (
                          <div data-list-subgroup={r.name} className="mb-0.5 flex h-9 items-center border-b border-line bg-col px-8 text-[12px] text-fg-3">
                            {r.name} <span className="ml-2">{r.issues.length}</span>
                          </div>
                        )}
                        <IssueList
                          label={d.rows !== "none" ? `${c.name}, ${r.name}` : c.name}
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
            {visible.length > 0 && results}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* Linear's boardRowsScroller (IssueList.CUOYX8Am.js): overscroll-behavior none and 90px scroll-padding top and bottom
                (BJ-388). Linear's board columns are 348px apart (CustomerCountPopover `et`: qe=348) with a 340px background
                (columnBackgroundWidth calc(100% - 8px)), so 8px between columns (BJ-386). */}
            <div ref={boardScroller} data-scroll-restoration-id={`board-${board.id}`} className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-none scroll-py-[90px] px-2 pt-1">
              {d.rows !== "none" && (
                <div className="sticky top-0 z-10 flex w-max gap-2 bg-panel">
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
              {layout.rows.map(
                (row, ri) =>
                  (d.rows === "none" || row.issues.length > 0) && (
                  <div
                    key={row.id}
                    className={d.rows === "none" ? "flex h-full min-h-0 gap-2" : "mb-4 w-max"}
                  >
                    {/* The lane spans the board's full width, so its title can stay pinned left while the board scrolls. */}
                    {d.rows !== "none" && (
                      <div className="sticky left-0 mb-2 flex w-fit items-center gap-2 px-2 py-2 text-fg-3">
                        <span>{row.name}</span>
                        <span>{row.issues.length}</span>
                        {show[0] && (
                          <IconButton
                            label={`New issue in ${row.name}`}
                            variant="muted"
                            size="small"
                            onClick={() => createIn(show[0]!, row)}
                          >
                            <Icon name="plus" />
                          </IconButton>
                        )}
                      </div>
                    )}
                    <div className={d.rows === "none" ? "contents" : "flex gap-2"}>
                      {show.map((col, ci) => (
                        <ColumnView
                          key={col.id}
                          bucket={col}
                          label={d.rows !== "none" ? `${col.name}, ${row.name}` : col.name}
                          issues={layout.cells[ri]![ci]!}
                          selected={selected}
                          display={d}
                          scroll={d.rows === "none" ? `board-${board.id}-column-${col.id}` : undefined}
                          header={d.rows === "none"}
                          hide={() => hide(col.id)}
                          create={() => createIn(col, d.rows === "none" ? undefined : row)}
                          onDrop={(keys, before) => {
                            const groups = [
                              { by: d.columns, id: col.id },
                              ...(d.rows !== "none" ? [{ by: d.rows, id: row.id }] : []),
                            ];
                            const order = { manual: d.ordering === "manual", descending: d.descending };
                            dropAll(
                              dropPlan(layout.cells[ri]![ci]!, keys, before, order, issues),
                              ({ key, ...place }) => actions.drop(key, personal ? issueBoardId(issues.get(key)) : board.id, groups, place),
                              record,
                            );
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ),
              )}
            </div>
            {d.rows === "none" && hidden.length > 0 && (
              <HiddenColumns
                columns={hidden}
                by={d.columns}
                hiddenIds={hiddenIds}
                open={hiddenOpen}
                toggle={() => setHiddenOpen(!hiddenOpen)}
                reveal={reveal}
              />
            )}
          </div>
        )}
        {/* Not HiddenColumns in another variant: Linear's board "Hidden columns" (data-board-hidden-columns) and swimlane
            "Hidden rows" (data-board-hidden-rows) are separate components sharing only the toggle, and its list counts hidden
            groups in the footer instead. This list/swimlane strip is ours, so it stays its own element. */}
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
                  {hidden.map((c) =>
                    hiddenIds.includes(c.id) ? (
                      <Button
                        key={c.id}
                        variant="secondary"
                        aria-label={`Show ${c.name}`}
                        data-hidden-group={c.name}
                        icon={<GroupIcon bucket={c} by={d.columns} />}
                        onClick={() => reveal(c.id)}
                      >
                        {c.name}
                        <CountBadge>{c.issues.length}</CountBadge>
                      </Button>
                    ) : (
                      <span key={c.id} data-hidden-group={c.name} className="flex h-7 items-center gap-1.5 px-2 text-fg-2">
                        <GroupIcon bucket={c} by={d.columns} />
                        {c.name}
                        <CountBadge>{c.issues.length}</CountBadge>
                      </span>
                    ),
                  )}
                </div>
              </details>
            )}
        {d.layout === "board" && visible.length > 0 && results}
        {displayHidden > 0 && <div role="status" className="flex shrink-0 items-center justify-center gap-2 py-3">
          <Text variant="mini" color="muted">{displayHidden} issue{displayHidden === 1 ? "" : "s"} hidden by display options</Text>
          <Button variant="borderless" size="small" onClick={() => ui.send({ type: "toolbar.open", toolbar: "display" })}>Show options</Button>
        </div>}
      </div>
      {active && shown && details && !panel && (detailView ? <ViewDetails view={detailView} issues={visible} /> : <BoardDetails board={board} issues={visible} />)}
    </div>
  );
});

/** Linear's "Hidden columns" list: pinned right, 338px, 50px header on the panel colour, 37px rows 10px apart. */
function HiddenColumns({
  columns,
  by,
  hiddenIds,
  open,
  toggle,
  reveal,
}: {
  columns: Bucket[];
  by: Display["columns"];
  hiddenIds: string[];
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
        {/* Not Button: the disclosure draws an 18px triangle, which a small Button would shrink to its 14px icon. */}
        <button
          aria-expanded={open}
          onClick={toggle}
          className="ml-px flex h-6 items-center gap-1 rounded-full border-[0.5px] border-transparent pr-2 pl-1 text-[12px] font-medium text-fg-2 hover:bg-(--control-tertiary-hover)"
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
            <HiddenGroup
              key={c.id}
              bucket={c}
              reveal={hiddenIds.includes(c.id) ? () => reveal(c.id) : undefined}
              className="flex h-[37px] shrink-0 items-center gap-3.5 rounded-lg border-[0.5px] border-hidden-line bg-card px-3 text-left text-[13px] font-medium text-fg shadow-(--hidden-shadow)"
            >
              <GroupIcon bucket={c} by={by} />
              <span className="flex-1 truncate">{c.name}</span>
              <span className="font-[450] text-card-fg-3">{c.issues.length}</span>
            </HiddenGroup>
          ))}
        </div>
      )}
    </aside>
  );
}

/** A row in the hidden list. Only a group the user hid can be shown again (Linear's handleShowGroup); an empty
 * group stays listed, without Show, until Show empty columns is turned on. */
function HiddenGroup({
  bucket,
  reveal,
  className,
  children,
}: {
  bucket: Bucket;
  reveal: (() => void) | undefined;
  className: string;
  children: ReactNode;
}) {
  return reveal ? (
    <button aria-label={`Show ${bucket.name}`} data-hidden-group={bucket.name} onClick={reveal} className={`${className} hover:bg-card-hover`}>
      {children}
    </button>
  ) : (
    <div data-hidden-group={bucket.name} className={className}>
      {children}
    </div>
  );
}

/** A list group's header; right-click opens Linear's list group menu (useListContextualActions `h`). Linear's list header has no ⋯.
 *  ⌥-click toggles every group from this one's state; the chevron's tooltip says so (CollapseListGroupButton `x`, `S`).
 *  It is `listHeaderHeight` (36px, startup-root `CM`) tall and sticks to the top of the list while its rows scroll under it
 *  (IssueList list `stickyHeaderLevels: +!!grouping`); the section bounds it, so the next group's header takes its place. */
function GroupHeading({
  bucket,
  display,
  collapsed,
  toggle,
  toggleAll,
  hide,
  create,
}: {
  bucket: Bucket;
  display: Display;
  collapsed: boolean;
  toggle: () => void;
  /** Every group takes the opposite of this one's state (Collapse all, ⌥-click). */
  toggleAll: () => void;
  hide: () => void;
  create: () => void;
}) {
  const entries = () =>
    groupMenuEntries({
      unit: "group",
      issues: bucket.issues,
      hide,
      completed: bucket.status?.category === "done",
      display,
      collapse: { collapsed, toggle, toggleAll },
    });
  return (
    <ContextMenu label={`Group ${bucket.name}`} entries={entries}>
      <div data-list-group={bucket.name} className="sticky top-0 z-[2] mb-0.5 flex h-9 items-center gap-2 border-y border-line bg-col px-5 text-[12px] font-medium text-fg-2">
        <button
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${bucket.name}`}
          aria-expanded={!collapsed}
          onClick={(e) => collapseClick(e, toggle, toggleAll)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          {/* Linear's tooltip sits on the chevron only (CollapseListGroupButton `v`). */}
          <span title={collapseTip(collapsed)} className="flex">
            <Icon name={collapsed ? "chevron" : "down"} />
          </span>
          {bucket.status && <StatusIcon status={bucket.status} />}
          <span>{bucket.name}</span>
          <span className="text-fg-3">{bucket.issues.length}</span>
        </button>
        <IconButton label={`New issue in ${bucket.name}`} variant="muted" size="small" onClick={create}>
          <Icon name="plus" />
        </IconButton>
      </div>
    </ContextMenu>
  );
}

const rowKey = (row: { issue: Issue }) => row.issue.key;
const rowText = (row: { issue: Issue }) => issueText(row.issue);
const issueKey = (issue: Issue) => issue.key;
/** A row's accessible name: the issue's key and summary. */
const issueText = (issue: Issue) => `${issue.key} ${issue.summary}`;

function IssueList({
  label,
  issues,
  universe,
  display,
  selected,
}: {
  label: string;
  issues: Issue[];
  universe: Issue[];
  display: Display;
  selected: string | null;
}) {
  const rows = useMemo(() => listRows(issues, universe, display.subIssues ? display.nested : "none"), [issues, universe, display.subIssues, display.nested]);
  // A group's "Select all" shows on its rows as the selection does.
  const columnSelection = useStore((s) => s.columnSelection);
  return <VirtualGridList aria-label={label} items={rows} itemKey={rowKey} itemText={rowText} selected={selected} selectedKeys={columnSelection} estimate={44} onRowKeyDown={issueKeys}>
    {({ issue, depth }) => <IssueRow issue={issue} display={display} depth={depth} />}
  </VirtualGridList>;
}

/** A board column's header: its ⋯ and a right-click on it open the same menu (Linear's `qu`, its info area wrapped by `Gd`). */
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
  const entries = () =>
    groupMenuEntries({ unit: "column", issues: bucket.issues, hide, completed: bucket.status?.category === "done", display });
  return (
    <ContextMenu label={`Column ${bucket.name}`} entries={entries}>
      <h2 className="board-column-heading flex h-[46px] shrink-0 items-center gap-2 pr-2 pl-3.5 text-[13px]">
        <GroupIcon bucket={bucket} by={display.columns} />
        {/* Linear's column heading: the name 13px/500 fg-2, the count 13px/450 fg-3. */}
        <Text variant="smallPlus" color="base" wrap="truncate" className="ml-0.5">
          {bucket.name}
        </Text>
        <Text variant="small" color="muted">
          {count}
        </Text>
        <GroupMenu name={bucket.name} entries={entries} />
        <IconButton label={`New issue in ${bucket.name}`} variant="muted" size="small" onClick={create} className="-ml-1.5">
          <Icon name="plus" />
        </IconButton>
      </h2>
    </ContextMenu>
  );
}

/** Where every board card can be dragged to: any column or swimlane cell of the board. */
const ISSUE_DRAG = "application/x-better-jira-issue";

/** Linear's `clearSelection`: the board's multi-selection (a column's "Select all") goes. */
const clearColumnSelection = () => set({ columnSelection: new Set() });

/** `header={false}` in swimlanes: Linear shows one sticky header row above all lanes. */
function ColumnView({
  bucket,
  label,
  issues,
  selected,
  display,
  scroll,
  onDrop,
  hide,
  create,
  header = true,
}: {
  bucket: Bucket;
  /** The cards' list name: the column, and the lane in swimlanes. */
  label: string;
  issues: Issue[];
  selected: string | null;
  display: Display;
  /** The column scrolls on its own (no swimlanes); Back restores it under this id. */
  scroll?: string;
  /** Dropped cards land before `before`, or at the end. */
  onDrop: (keys: string[], before: string | undefined) => void;
  hide: () => void;
  create: () => void;
  header?: boolean;
}) {
  const columnSelection = useStore((s) => s.columnSelection);
  const drop: ListDrop = {
    type: ISSUE_DRAG,
    onDrop,
    renderPreview: (keys) => <CardPreview issues={keys.flatMap((key) => get().issues.get(key) ?? [])} display={display} />,
    clearSelection: clearColumnSelection,
    link: issueKeyURL,
  };
  return (
    <section data-board-column={bucket.name} className="board-column flex w-[340px] shrink-0 flex-col rounded-t-[5px]">
      {header && (
        <ColumnHeading
          bucket={bucket}
          count={issues.length}
          display={display}
          hide={hide}
          create={create}
        />
      )}
      <div
        data-scroll-restoration-id={scroll}
        className={`board-column-body flex flex-1 flex-col px-2 pt-[9px] ${scroll ? "board-column-scroller overflow-y-auto" : ""}`}
      >
        <VirtualGridList
          aria-label={label}
          items={issues}
          itemKey={issueKey}
          itemText={issueText}
          rowClassName="px-px pb-2"
          selected={selected}
          selectedKeys={columnSelection}
          estimate={124}
          drop={drop}
          onRowKeyDown={issueKeys}
          className="flex-1"
          footer={<AddIssueSlot onClick={create} />}
        >
          {(issue) => <BoardCard issue={issue} display={display} />}
        </VirtualGridList>
      </div>
    </section>
  );
}

/** Linear's column foot (IssueList `rl` around `sl`), right after the last card: a full-width 28px pill holding only a plus,
 *  shown while the pointer is over the column; every column's is "Add new issue" (board-column.css). */
function AddIssueSlot({ onClick }: { onClick: () => void }) {
  return (
    <div className="board-add-slot">
      <button type="button" aria-label="Add new issue" className="ui-button board-add" onClick={onClick}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

/** Enter on a focused row or card opens the issue's page; Space peeks into it, as the global Space does on the hovered one. */
function issueKeys(key: string, event: KeyboardEvent) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  if (event.repeat) return;
  if (event.key === "Enter") navigate({ selected: key, panel: true, view: "page" });
  else togglePeek(key);
}

/** What a row and a card share: the clickable surface inside the list's row, with the menu highlight and the pointer behaviour.
 *  The row (VirtualGridList's, named by the issue) carries `data-selected` (the j/k or column selection) and
 *  `data-focus-visible`, which style the surface (`in-data-*`); the surface carries `data-menu` while its right-click menu is
 *  open. The list scrolls the selection into view. */
function IssueTarget({
  issue,
  className,
  style,
  children,
}: {
  issue: Issue;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  // A right-clicked card is highlighted only while its menu is open, as Linear does; it never becomes the selection.
  const menu = useStore((s) => !!s.overlay && s.target === issue.key);
  // A property control inside (a badge, a status icon, the avatar, a link) and the menu it opens, which renders inside the card,
  // handle their own clicks: Linear's `FI` stops them reaching the card, so the issue does not open.
  const own = (e: SyntheticEvent) =>
    e.currentTarget.contains(e.target as Node) && !(e.target as Element).closest('button, a, [role="dialog"]');
  return (
    <div
      data-menu={menu || undefined}
      onPointerEnter={() => preloadOnHover({ selected: issue.key, panel: true })}
      // Linear's focus follows the pointer as it moves (useListRowActivation's `onMouseMove`), and an open peek shows the focused
      // item. A move of no distance is a card sliding under a still pointer, or ⌘ pressed over it: j/k's card keeps the peek.
      onPointerMove={(e) => movedPointer(e) && followPeek(issue.key)}
      // Leaving a card never closes the peek: Linear skips its mouse-leave deactivate while a peek is mounted.
      onPointerLeave={() => preloadOnHover(null)}
      // Middle-click opens the issue's page in a new tab, as Linear's row links do; ⌘-click stays the list's.
      onAuxClick={openInNewTabOnMiddleClick(() => appURL(issue))}
      onClick={(e) =>
        own(e) &&
        timed(`open ${issue.key}`, () => {
          set({ columnSelection: new Set() });
          navigate({ selected: issue.key, panel: true });
        })
      }
      // Linear's row menu: Issue options at the pointer, on this issue, without selecting it.
      onContextMenu={(e) => {
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        ui.send({
          type: "overlay.open",
          overlay: "options",
          target: issue.key,
          point: { x: e.clientX, y: e.clientY },
        });
      }}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}

type FieldControl = { issue: Issue; field: IssueField; label: string; title?: string; className?: string; children: ReactNode };

/** One of the issue's properties as a badge that opens that property's menu (the issue detail's PropertyPicker) anchored to it:
 *  Linear's `ZB`. Named "<Field> on <key>"; `title` is its tooltip. */
function FieldBadge({ issue, field, label, title, className, children }: FieldControl) {
  return (
    <Badge.Menu
      aria-label={`${label} on ${issue.key}`}
      title={title}
      className={className}
      menu={PropertyPicker}
      menuProps={{ issue, field }}
    >
      {children}
    </Badge.Menu>
  );
}

/** The card's Project badge: the issue's epic (shared/epics.ts), opening the project picker. Its icon is the epic's Jira type
 *  (the violet Epic TypeDot), not Linear's project glyph: the user's choice. */
export function ProjectBadge({ issue }: { issue: Issue }) {
  const epic = useStore((s) => epicOf(issue, (key) => s.issues.get(key)));
  const name = useStore((s) => (epic ? epicName(epic, (key) => s.issues.get(key)) : undefined));
  // An epic outside the mirror is still an epic: its key came from the parent's level.
  const type = useStore((s) => (epic ? (s.issues.get(epic)?.type ?? "Epic") : undefined));
  // An epic or a sub-issue can't pick its project (epicLocked), so its badge only names it, as the detail pill does.
  const locked = useStore((s) => epicLocked(issue, (key) => s.issues.get(key)));
  // An epic's own card names no epic: it is the epic.
  if (!name || epic === issue.key) return null;
  const content = (
    <>
      <Badge.Icon>
        <TypeDot type={type} />
      </Badge.Icon>
      <Badge.Text>{name}</Badge.Text>
    </>
  );
  return locked ? (
    <Badge data-project-badge title={`${name}: ${locked}`}>{content}</Badge>
  ) : (
    <FieldBadge issue={issue} field="project" label="Epic" title={name}>
      {content}
    </FieldBadge>
  );
}

/** A bare property icon (status, priority leading a row, the assignee's avatar) that opens its menu: Linear's brightening trigger. */
function FieldIcon({ issue, field, label, title, className, children }: FieldControl) {
  return (
    <IconMenuButton
      aria-label={`${label} on ${issue.key}`}
      title={title}
      className={className}
      menu={PropertyPicker}
      menuProps={{ issue, field }}
    >
      {children}
    </IconMenuButton>
  );
}

/** The issue's labels, Linear's `LabelsBadges`: up to `max` inline; past that `max - 1` and one "+N labels" badge for the rest,
 *  with the first hidden label's dot. Each opens the label menu, which Linear places left of the badge (`horizontal-left`). */
function IssueLabels({ issue, max }: { issue: Issue; max: number }) {
  const inline = issue.labels.length > max ? issue.labels.slice(0, max - 1) : issue.labels;
  const hidden = issue.labels.slice(inline.length);
  return (
    <>
      {inline.map((l) => (
        <FieldBadge key={l} issue={issue} field="labels" label="Labels" title={l}>
          <Badge.Icon>
            <LabelDot name={l} />
          </Badge.Icon>
          <Badge.Text>{l}</Badge.Text>
        </FieldBadge>
      ))}
      {hidden.length > 0 && (
        <FieldBadge issue={issue} field="labels" label="Labels" title={hidden.join(", ")}>
          <Badge.Icon>
            <LabelDot name={hidden[0]!} />
          </Badge.Icon>
          <Badge.Text>
            {inline.length ? "+" : ""}
            {hidden.length} {hidden.length === 1 ? "label" : "labels"}
          </Badge.Text>
        </FieldBadge>
      )}
    </>
  );
}

/** The display's property badges after the title, in Linear's card order (`wd`); a row fits one label, a card five. A card ends with
 *  its sub-issue badge. */
function IssueProperties({ issue, display: d, labels }: { issue: Issue; display: Display; labels: number }) {
  const show = (p: Property) => d.properties.includes(p);
  const clock = useStore((s) => (d.properties.includes("statusAge") ? s.clock : 0));
  return (
    <>
      {show("statusAge") && issue.statusSince && (
        <FieldBadge issue={issue} field="status" label="Time in status" title={`In current status since ${fullTime(issue.statusSince)}`}>
          <Badge.Icon>
            <Icon name="clock" />
          </Badge.Icon>
          {/* oxlint-disable-next-line react/purity -- the elapsed time is read at render; `clock` re-renders it each minute. */}
          <Badge.Text>{statusDuration(issue.statusSince, Math.max(clock, Date.now()))}</Badge.Text>
        </FieldBadge>
      )}
      {show("due") && issue.due && (
        <FieldBadge issue={issue} field="due" label="Due date" title={`Due ${fullTime(`${issue.due}T00:00:00`)}`}>
          <Badge.Icon>
            <DueIcon due={issue.due} resolved={issue.resolved} />
          </Badge.Icon>
          <Badge.Text>{shortDate(issue.due, undefined, true)}</Badge.Text>
        </FieldBadge>
      )}
      {show("type") && issue.type && (
        <FieldBadge issue={issue} field="type" label="Type" title={issue.type}>
          <Badge.Icon>
            <TypeDot type={issue.type} />
          </Badge.Icon>
          <Badge.Text>{issue.type}</Badge.Text>
        </FieldBadge>
      )}
      {show("project") && <ProjectBadge issue={issue} />}
      {show("milestone") &&
        issue.milestones?.map((v) => (
          <FieldBadge key={v.id} issue={issue} field="milestone" label="Milestone" title={`Jira fix version: ${v.name}`}>
            <Badge.Icon>
              <Icon name="layers" />
            </Badge.Icon>
            <Badge.Text>{v.name}</Badge.Text>
          </FieldBadge>
        ))}
      {show("labels") && <IssueLabels issue={issue} max={labels} />}
      {show("pullRequests") && !!issue.prCount && <PullRequestBadge issue={issue} layout={d.layout} />}
      {show("links") && <LinkBadges issue={issue} />}
      {/* Linear's card ends its badges with the sub-issues one, after links (IssueList `wd`); a row has it after its title. */}
      {d.layout === "board" && <SubIssueBadge issue={issue} layout="board" />}
    </>
  );
}

/** Created and updated dates, Linear's `Sd`/`Cd`: plain badges with the full time as their tooltip. `updated` is the label before the
 *  updated date ("Updated " on cards, none on rows). */
function IssueDates({ issue, display: d, updated }: { issue: Issue; display: Display; updated: string }) {
  return (
    <>
      {d.properties.includes("created") && issue.created && (
        <Badge variant="plain" title={`Created ${fullTime(issue.created)}`}>
          <Badge.Text>Created {shortDate(issue.created)}</Badge.Text>
        </Badge>
      )}
      {d.properties.includes("updated") && (
        <Badge variant="plain" title={`Updated ${fullTime(issue.updated)}`}>
          <Badge.Text>
            {updated}
            {shortDate(issue.updated)}
          </Badge.Text>
        </Badge>
      )}
    </>
  );
}

/** The status icon before the title, opening the status menu. */
function IssueStatus({ issue, className }: { issue: Issue; className?: string }) {
  const status = statusOf(issue);
  if (!status) return null;
  return (
    <FieldIcon issue={issue} field="status" label="Status" title={status.name} className={className}>
      <StatusIcon status={status} />
    </FieldIcon>
  );
}

/** The assignee's avatar, opening the assignee menu. */
function IssueAssignee({ issue, className }: { issue: Issue; className?: string }) {
  return (
    <FieldIcon issue={issue} field="assignee" label="Assignee" className={className}>
      <Avatar user={issue.assignee} size={18} />
    </FieldIcon>
  );
}

/** A list row, `listIssueRowHeight` (44px, startup-root `CM`) tall: priority, key, status, title, then properties, assignee and
 *  dates on one line, Linear's order; nested rows indent
 *  20px per level. Its keyboard ring is drawn inside the row (outline-offset −1px), so the next row cannot cover its bottom edge. */
const IssueRow = memo(function IssueRow({
  issue,
  display: d,
  depth,
}: {
  issue: Issue;
  display: Display;
  depth: number;
}) {
  const show = (p: Property) => d.properties.includes(p);
  return (
      <IssueTarget
        issue={issue}
        className="flex h-11 cursor-default items-center gap-3 border-b border-line px-5 -outline-offset-1 hover:bg-(--row-hover) data-menu:bg-(--row-hover) data-menu:shadow-[inset_2px_0_0_var(--accent)] in-data-selected:bg-(--row-hover) in-data-selected:shadow-[inset_2px_0_0_var(--accent)] in-data-focus-visible:outline-1 in-data-focus-visible:outline-accent in-data-focus-visible:outline-solid"
        style={depth ? { paddingLeft: 20 + depth * 20 } : undefined}
      >
        {show("priority") && (
          <FieldIcon issue={issue} field="priority" label="Priority" title={issue.priority ?? "No priority"} className="text-fg-3">
            <PriorityIcon name={issue.priority} />
          </FieldIcon>
        )}
        {show("id") && (
          <Text variant="mini" color="muted" numeric="tabular" className="w-[85px] shrink-0">
            {depth > 0 && "↳ "}
            {issue.key}
          </Text>
        )}
        {show("status") && <IssueStatus issue={issue} />}
        {/* Linear's row: the sub-issue badge leads its badge container, right after the title (issueWidgetFieldPreferences `at`). */}
        <span className="flex min-w-32 flex-1 items-center gap-3 overflow-hidden">
          <span className="truncate font-medium">{issue.summary}</span>
          <SubIssueBadge issue={issue} layout="list" />
        </span>
        <span className="flex max-w-[45%] shrink-0 items-center gap-1 overflow-hidden">
          <IssueProperties issue={issue} display={d} labels={1} />
        </span>
        {show("assignee") && <IssueAssignee issue={issue} />}
        <span className="flex shrink-0 items-center gap-1">
          <IssueDates issue={issue} display={d} updated="" />
        </span>
      </IssueTarget>
  );
});

/**
 * A board card, Linear's board item (`Cu.link`) around its issue card (`wd`, IssueList.CUOYX8Am.js): key and two-line title with the
 * assignee in the corner, then property badges and dates. Hovered or with a property menu open it takes bgBaseHover; selected or
 * keyboard-focused it keeps bgBase and draws a 1px accent outline 1px inside its edge, so no ancestor's overflow can clip it. The
 * wrapper's 0 1px 8px padding is Linear's.
 */
const BoardCard = memo(function BoardCard({ issue, display }: { issue: Issue; display: Display }) {
  return (
    <IssueTarget
      issue={issue}
      className="relative flex min-h-[42px] cursor-default flex-col rounded-lg bg-card p-2 shadow-(--card-shadow) -outline-offset-1 hover:bg-card-hover has-[[aria-expanded=true]]:bg-card-hover data-menu:bg-card-hover in-data-selected:bg-card in-data-selected:outline-1 in-data-selected:outline-accent in-data-selected:outline-solid in-data-focus-visible:outline-1 in-data-focus-visible:outline-accent in-data-focus-visible:outline-solid"
    >
      <CardContent issue={issue} display={display} />
    </IssueTarget>
  );
});

/** What a board card shows: key and two-line title with the assignee in the corner, then property badges and dates. */
function CardContent({ issue, display: d }: { issue: Issue; display: Display }) {
  const show = (p: Property) => d.properties.includes(p);
  return (
    <>
      <div className="flex flex-col gap-1.5 pr-[34px] pl-1">
        {show("id") && (
          <EntityIdentifier className="truncate text-[12px] leading-[normal] font-[450] text-card-fg-3">
            {issue.key}
          </EntityIdentifier>
        )}
        <div className="flex items-start gap-1.5">
          {show("status") && <IssueStatus issue={issue} className="mt-px" />}
          <span className="line-clamp-2 text-[13px] leading-4 font-medium [overflow-wrap:anywhere]">
            {issue.summary}
          </span>
        </div>
      </div>
      {show("assignee") && <IssueAssignee issue={issue} className="absolute top-2 right-2" />}
      {/* data-badges: Linear's badge row; the label menu opens left of a label badge here (`horizontal-left`). */}
      <div data-badges className="mt-2.5 flex flex-wrap items-center gap-1 empty:hidden">
        {show("priority") && (
          <FieldBadge issue={issue} field="priority" label="Priority" title={issue.priority ?? "No priority"}>
            <Badge.Icon>
              <PriorityIcon name={issue.priority} />
            </Badge.Icon>
          </FieldBadge>
        )}
        <IssueProperties issue={issue} display={d} labels={5} />
      </div>
      {(show("updated") || show("created")) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 empty:hidden">
          <IssueDates issue={issue} display={d} updated="Updated " />
        </div>
      )}
    </>
  );
}

/**
 * The card under the pointer while dragging, Linear's drag overlay (IssueList `pd`): the card at the column's width (322px),
 * on bgBaseHover with shadowMedium (`--menu-shadow`), radius 6. Several cards show their count over the first, as Linear's
 * multi-select overlay does. A native drag image, so the browser draws it translucent (Linear's is opaque).
 */
function CardPreview({ issues, display }: { issues: Issue[]; display: Display }) {
  const [first] = issues;
  if (!first) return null;
  return (
    <div data-drag-preview className="relative w-[322px] p-px pb-2">
      <div className="relative flex min-h-[42px] flex-col rounded-md bg-card-hover p-2 shadow-(--menu-shadow)">
        <CardContent issue={first} display={display} />
      </div>
      {issues.length > 1 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-medium text-white">
          {issues.length}
        </span>
      )}
    </div>
  );
}
