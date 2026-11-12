import { VirtualItems } from "./virtual-items";
import { isMyIssues } from "./navigation";
import { personIssues } from "./people";
import { useEffectiveMine, useActiveView, useOverlayFilters } from "./saved-views";
import {
  clearFilters,
  hideGroup,
  showGroup,
  toggleCollapsed,
  useEffectiveSettings,
} from "./view-settings";
import { ViewDetails, ResultsFeedback } from "./views-navigation";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { commentCount } from "./media-edits";
import { Icon, Label, PriorityIcon, StatusIcon, TypeDot } from "./icons";
import { ME, actions, get, set, timed, useStore, beginCreate, type Board, type Issue, statusOf } from "./store";
import { loadFull } from "./server-data";
import { navigate, ui } from "./app-navigation";
import {
  myIssuesBoard,
  boardColumns,
  draftForGroup,
  groupLayout,
  layoutOrder,
  rankBetween,
  listRows,
  selectIssues,
  displayHiddenCount,
  resultsFeedback,
  statusDuration,
  type Bucket,
  type Display,
  type Property,
} from "./view-model";
import { BoardDetails, GroupMenu } from "./personal-controls";
import { Avatar } from "./avatar";
import { shortDate } from "./due-date";
import { Button, IconButton } from "./button";
import { CountBadge } from "./count-badge";
import { Text } from "./text";
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
  const [expanded, setExpanded] = useState<string[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(true);
  const all = useMemo(() => [...issues.values()], [issues]);
  const visible = useMemo(
    () => selectIssues(all, board, prefs, who || mine, query, ME.id, Date.now(), personal),
    [all, board, prefs, who, mine, query, personal],
  );
  const universe = useMemo(() => personal ? all : all.filter((i) => i.board === board.id), [all, board.id, personal]);
  const columns = useMemo(
    () => boardColumns(visible, board, prefs, universe),
    [visible, board, prefs, universe],
  );
  const collapsed = prefs.collapsed[d.columns] ?? [];
  // One pass per data change: shown and hidden groups, a list's rows per group, a board's cards per lane and column.
  const layout = useMemo(() => {
    const hiddenIds = prefs.hidden[d.columns] ?? [];
    const hidden = columns.filter(
      (c) =>
        hiddenIds.includes(c.id) || (!d.emptyGroups && !c.issues.length && !expanded.includes(c.id)),
    );
    const show = columns.filter((c) => !hidden.includes(c));
    return { hidden, show, ...groupLayout(show, visible, board, d) };
  }, [columns, prefs.hidden, d, expanded, visible, board]);
  const { hidden, show } = layout;
  // The prefetch order follows the cards and rows just laid out, so which groups show is decided once.
  const order = useMemo(() => layoutOrder(layout.show, layout, prefs, universe), [layout, prefs, universe]);
  // Revealed empty groups close again when grouping or the empty-groups option changes.
  const expandedFor = `${d.columns}:${d.emptyGroups}`;
  const [expandedKey, setExpandedKey] = useState(expandedFor);
  if (expandedKey !== expandedFor) {
    setExpandedKey(expandedFor);
    setExpanded([]);
  }
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
  const feedback = useMemo(
    () => resultsFeedback(all, board, prefs, activeView, { overlay, query, mine }, who, ME.id),
    [all, board, prefs, activeView, overlay, query, mine, who],
  );
  const clearAll = () => {
    clearFilters(board.id);
    ui.send({ type: "query.set", query: "" });
    ui.send({ type: "mine.set", mine: personal || (activeView?.mine ?? false) });
    set({ findInView: false });
  };
  // One feedback, placed by layout: the zero state above the groups, else the list's last row or the board's footer.
  const displayHidden = useMemo(
    () => displayHiddenCount(all, board, prefs, mine, query, ME.id, Date.now(), personal),
    [all, board, prefs, mine, query, personal],
  );
  const results = <ResultsFeedback count={visible.length} {...feedback} view={activeView} clear={clearAll} layout={d.layout} />;
  return (
    <div className={`${shown ? "flex" : "hidden"} min-w-0 min-h-0 flex-1`}>
      <div className="relative flex min-w-0 min-h-0 flex-1 flex-col" data-layout={d.layout}>
        {!visible.length && results}
        {d.layout === "list" ? (
          <div className="flex-1 overflow-auto py-1">
            {show.map((c, ci) => (
              <section key={c.id} className="mb-2">
                <GroupHeading
                  bucket={c}
                  collapsed={collapsed.includes(c.id)}
                  toggle={() => collapse(c.id)}
                  create={() => createIn(c)}
                />
                {!collapsed.includes(c.id) &&
                  layout.sections[ci]!.map((r) => (
                      <div key={r.id}>
                        {d.rows !== "none" && (
                          <div className="border-b border-line bg-col px-8 py-2 text-[12px] text-fg-3">
                            {r.name} <span className="ml-2">{r.issues.length}</span>
                          </div>
                        )}
                        <IssueList
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
              {layout.rows.map(
                (row, ri) =>
                  (d.rows === "none" || row.issues.length > 0) && (
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
                    <div className={d.rows === "none" ? "contents" : "flex gap-4"}>
                      {show.map((col, ci) => (
                        <ColumnView
                          key={col.id}
                          bucket={col}
                          issues={layout.cells[ri]![ci]!}
                          selected={selected}
                          display={d}
                          scroll={d.rows === "none"}
                          header={d.rows === "none"}
                          hide={() => hide(col.id)}
                          create={() => createIn(col, d.rows === "none" ? undefined : row)}
                          onDrop={(key, before) =>
                            actions.drop(
                              key,
                              personal ? (issues.get(key)?.board ?? board.id) : board.id,
                              [
                                { by: d.columns, id: col.id },
                                ...(d.rows !== "none" ? [{ by: d.rows, id: row.id }] : []),
                              ],
                              d.ordering === "manual"
                                ? dropRank(
                                    layout.cells[ri]![ci]!.filter((i) => i.key !== key),
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
                ),
              )}
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
                  {hidden.map((c) => (
                    <Button
                      key={c.id}
                      variant="secondary"
                      aria-label={`Show ${c.name}`}
                      icon={c.status && <StatusIcon status={c.status} />}
                      onClick={() => reveal(c.id)}
                    >
                      {c.name}
                      <CountBadge>{c.issues.length}</CountBadge>
                    </Button>
                  ))}
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
        {/* Not Button: the disclosure draws an 18px triangle, which a small Button would shrink to its 14px icon. */}
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
      <IconButton label={`New issue in ${bucket.name}`} variant="muted" size="small" onClick={create}>
        <Icon name="plus" />
      </IconButton>
    </div>
  );
}

const rowKey = (row: { issue: Issue }) => row.issue.key;
const issueKey = (issue: Issue) => issue.key;

function IssueList({
  issues,
  universe,
  display,
  selected,
}: {
  issues: Issue[];
  universe: Issue[];
  display: Display;
  selected: string | null;
}) {
  const rows = useMemo(() => listRows(issues, universe, display.subIssues ? display.nested : "none"), [issues, universe, display.subIssues, display.nested]);
  return <VirtualItems items={rows} itemKey={rowKey} selected={selected} estimate={44}>
    {({ issue, depth }) => <IssueRow issue={issue} selected={selected === issue.key} display={display} depth={depth} />}
  </VirtualItems>;
}

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
      {/* .raj/linear.md "Columns": the name 13px/500 fg-2, the count 13px/450 fg-3. */}
      <Text variant="smallPlus" color="base" wrap="truncate" className="ml-0.5">
        {bucket.name}
      </Text>
      <Text variant="small" color="muted">
        {count}
      </Text>
      <GroupMenu
        name={bucket.name}
        hide={hide}
        issues={bucket.issues}
        completed={bucket.status?.category === "done"}
        display={display}
      />
      <IconButton label={`New issue in ${bucket.name}`} variant="muted" size="small" onClick={create} className="-ml-1.5">
        <Icon name="plus" />
      </IconButton>
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
}: {
  bucket: Bucket;
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
        <VirtualItems items={issues} itemKey={issueKey} selected={selected} estimate={124}>
          {(issue) => <BoardCard issue={issue} selected={issue.key === selected} display={display} />}
        </VirtualItems>
        <Button type="button" variant="borderless" size="medium" onClick={create} aria-label={`Add issue to ${bucket.name}`}>
          <Icon name="plus" size={14} /> Add issue
        </Button>
      </div>
    </section>
  );
}

// Linear's card chip: 24px pill, 0.5px border, 12px/450 muted text after a 14px icon. Not PropertyTrigger: these chips
// only show a value inside the card's own button, and PropertyTrigger is a button that opens a picker.
const CHIP =
  "flex h-6 max-w-[224px] shrink-0 items-center rounded-full border-[0.5px] border-chip-line bg-card px-2 text-[12px] font-[450] text-card-fg-3";

/** What a row and a card share: the clickable, draggable target with selection scrolling, the menu highlight and the issue's keys. */
function IssueTarget({
  issue,
  selected,
  className,
  style,
  children,
}: {
  issue: Issue;
  selected: boolean;
  className: (lit: boolean) => string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => void (selected && ref.current?.scrollIntoView({ block: "nearest" })), [selected]);
  // A right-clicked card is highlighted only while its menu is open, as Linear does; it never becomes the selection.
  const menu = useStore((s) => !!s.overlay && s.target === issue.key);
  const columnSelected = useStore((s) => s.columnSelection.has(issue.key));
  return (
    <div
      ref={ref}
      data-key={issue.key}
      data-selected={selected || columnSelected || undefined}
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
        timed(`open ${issue.key}`, () => {
          set({ columnSelection: new Set() });
          navigate({ selected: issue.key, panel: true });
        })
      }
      // Linear's row menu: Issue options at the pointer, on this issue, without selecting it.
      onContextMenu={(e) => {
        e.preventDefault();
        ui.send({
          type: "overlay.open",
          overlay: "options",
          target: issue.key,
          point: { x: e.clientX + 3, y: e.clientY },
        });
      }}
      className={className(selected || columnSelected || menu)}
      style={style}
    >
      {children}
    </div>
  );
}

/** The display's property chips; a row fits one label and a plain priority icon, a card two labels and a priority chip. */
function IssueProperties({
  issue,
  display: d,
  labels,
  priorityClass,
}: {
  issue: Issue;
  display: Display;
  labels: number;
  priorityClass: string;
}) {
  const show = (p: Property) => d.properties.includes(p);
  const clock = useStore((s) => (d.properties.includes("statusAge") ? s.clock : 0));
  return (
    <>
      {show("priority") && (
        <span title={issue.priority ?? "No priority"} className={priorityClass}>
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
      {show("labels") && issue.labels.slice(0, labels).map((l) => <Label key={l} name={l} />)}
      {show("labels") && issue.labels.length > labels && (
        <span title={issue.labels.join(", ")} className={CHIP}>
          +{issue.labels.length - labels}
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
            {/* oxlint-disable-next-line react/purity -- the elapsed time is read at render; `clock` re-renders it each minute. */}
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
}

/** Created and updated dates; `updated` is the label before the updated date ("Updated " on cards, none on rows). */
function IssueDates({ issue, display: d, updated }: { issue: Issue; display: Display; updated: string }) {
  return (
    <>
      {d.properties.includes("created") && issue.created && (
        <span title={`Created ${issue.created}`}>Created {shortDate(issue.created)}</span>
      )}
      {d.properties.includes("updated") && (
        <span title={`Updated ${issue.updated}`}>
          {updated}
          {shortDate(issue.updated)}
        </span>
      )}
    </>
  );
}

/** A list row: key, status, title, then properties, assignee and dates on one line; nested rows indent 20px per level. */
const IssueRow = memo(function IssueRow({
  issue,
  selected,
  display: d,
  depth,
}: {
  issue: Issue;
  selected: boolean;
  display: Display;
  depth: number;
}) {
  const show = (p: Property) => d.properties.includes(p);
  const status = statusOf(issue);
  return (
    <div>
      <IssueTarget
        issue={issue}
        selected={selected}
        className={(lit) =>
          `flex min-h-11 cursor-default items-center gap-3 border-b border-line px-5 outline-none focus-visible:ring-1 focus-visible:ring-accent ${lit ? "bg-hover shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-hover"}`
        }
        style={depth ? { paddingLeft: 20 + depth * 20 } : undefined}
      >
        {show("id") && (
          <Text variant="mini" color="muted" numeric="tabular" className="w-[85px] shrink-0">
            {depth > 0 && "↳ "}
            {issue.key}
          </Text>
        )}
        {show("status") && status && (
          <span title={status.name}>
            <StatusIcon status={status} />
          </span>
        )}
        <span className="min-w-32 flex-1 truncate font-medium">{issue.summary}</span>
        <span className="flex max-w-[45%] shrink-0 items-center gap-2 overflow-hidden">
          <IssueProperties issue={issue} display={d} labels={1} priorityClass="text-fg-3" />
        </span>
        {show("assignee") && <Avatar user={issue.assignee} size={18} />}
        <Text variant="micro" color="muted" className="flex shrink-0 gap-2">
          <IssueDates issue={issue} display={d} updated="" />
        </Text>
      </IssueTarget>
    </div>
  );
});

/** A board card: key and two-line title with the assignee in the corner, then property chips and dates. */
const BoardCard = memo(function BoardCard({
  issue,
  selected,
  display: d,
}: {
  issue: Issue;
  selected: boolean;
  display: Display;
}) {
  const show = (p: Property) => d.properties.includes(p);
  const status = statusOf(issue);
  return (
    <div className="pb-2 [overflow-clip-margin:4px]">
      <IssueTarget
        issue={issue}
        selected={selected}
        className={(lit) =>
          `relative flex min-h-[42px] cursor-default flex-col rounded-lg p-2 shadow-(--card-shadow) outline-none focus-visible:ring-1 focus-visible:ring-accent ${lit ? "bg-card-hover ring-1 ring-accent" : "bg-card hover:bg-card-hover"}`
        }
      >
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
          <IssueProperties
            issue={issue}
            display={d}
            labels={2}
            priorityClass={`${CHIP} px-[4.5px]`}
          />
        </div>
        {(show("updated") || show("created")) && (
          <div className="mt-1.5 flex min-h-6 flex-wrap items-center gap-x-3 pl-px text-[12px] font-[450] text-card-fg-3">
            <IssueDates issue={issue} display={d} updated="Updated " />
          </div>
        )}
      </IssueTarget>
    </div>
  );
});
