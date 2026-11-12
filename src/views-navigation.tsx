import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { Avatar } from "./avatar";
import { ME, navigate, useStore, type Issue } from "./store";
import { findIssueDocument } from "./issue-resource";
import { createViewDraft, openSavedView, useActiveView, useSavedViews, type SavedView } from "./saved-views";
import { openViewEditor, ViewContextMenu } from "./view-editor";
import { MenuSurface } from "./menu-surface";
import { Menu } from "./menu";
import { Button, ButtonLink, IconButton } from "./button";
import { Tabs } from "./tabs";
import { Text } from "./text";
import { CountBadge } from "./count-badge";
import { EmptyState } from "./empty-state";
import { Shortcut } from "./keycap";
import { directoryViews, resultFeedback, viewSummaries } from "./views-navigation-model";
import "./views-navigation.css";

export function SavedViewIcon({ view }: { view: Pick<SavedView, "icon" | "color"> }) {
  return <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: view.color === "gray" ? "var(--view-gray)" : view.color }}>
    {/[^\x00-\x7F]/.test(view.icon) ? view.icon : <Icon name={view.icon as IconName} size={16} />}
  </span>;
}
export function ViewsDirectory() {
  const board = useStore(s => s.boards.find(b => b.id === s.board));
  const views = useSavedViews();
  const [sort, setSort] = useState<"name" | "owner">("name");
  const [descending, setDescending] = useState(false);
  const rows = directoryViews(views, board!.id, descending, sort);
  const [displayAnchor, setDisplayAnchor] = useState<HTMLElement | null>(null);
  const order = (key: "name" | "owner") => { setSort(key); setDescending(sort === key ? !descending : false); };
  const create = () => openViewEditor(createViewDraft("custom"));
  return <section aria-label="Views" className="views-directory flex min-w-0 flex-1 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-frame px-4 text-[13px] font-medium text-fg-2"><span>{board?.name}</span><span className="text-fg-3">›</span><h2>Views</h2><Button variant="muted" size="medium" icon={<Icon name="plus" />} className="ml-auto" onClick={create}>New view</Button></header>
    <div className="flex h-11 shrink-0 items-center px-2"><Tabs value="issues" onValueChange={() => {}}><Tabs.List aria-label="View type"><Tabs.Tab value="issues">Issues</Tabs.Tab></Tabs.List></Tabs><IconButton label="Display options" variant="secondary" aria-expanded={!!displayAnchor} className="ml-auto" onClick={e => setDisplayAnchor(e.currentTarget)}><Icon name="display" /></IconButton></div>
    {displayAnchor && <MenuSurface label="Display options" anchor={displayAnchor} align="end" fit close={() => setDisplayAnchor(null)}><Menu tabIndex={0} defaultValue={sort}><Menu.List><Menu.GroupHeader>Ordering</Menu.GroupHeader>{(["name", "owner"] as const).map(key => <Menu.Item key={key} value={key} checked={sort === key} onSelect={() => { setSort(key); setDescending(false); setDisplayAnchor(null); }}>{key === "name" ? "Name" : "Owner"}</Menu.Item>)}</Menu.List></Menu></MenuSurface>}
    {rows.length ? <div role="table" aria-label="Custom views" className="overflow-auto">
      <div role="row" className="views-directory-grid border-b border-line py-1 pr-6 pl-2">
        {(["name", "owner"] as const).map(key => <div role="columnheader" aria-sort={sort === key ? descending ? "descending" : "ascending" : "none"} key={key}><Button variant="borderless" size="small" aria-label={`Order by ${key === "name" ? "Name" : "Owner"}`} onClick={() => order(key)}>{key === "name" ? "Name" : "Owner"}{sort === key && (descending ? " ↑" : " ↓")}</Button></div>)}
      </div>
      {/* Two-line directory navigation rows have no matching Button variant. */}
      {rows.map(view => <ViewContextMenu key={view.id} view={view}><div role="row" className="views-directory-grid py-2.5 pr-6 pl-4 hover:bg-hover"><div role="cell"><button className="flex w-full items-start gap-3 text-left" onClick={() => openSavedView(view)}><span className="pt-0.5"><SavedViewIcon view={view} /></span><span className="min-w-0"><Text variant="smallPlus" wrap="truncate" className="block">{view.name}</Text>{view.description && <Text variant="small" color="muted" wrap="truncate" className="mt-0.5 block">{view.description}</Text>}</span></button></div><div role="cell" className="flex items-center"><span title={ME.name} className="flex h-7 w-[120px] items-center gap-1.5 rounded-full px-1.5 text-[13px] text-fg"><Avatar user={ME} size={16} /><span className="truncate">{ME.name}</span></span></div></div></ViewContextMenu>)}
    </div> : <EmptyState
      icon={<svg width="72" height="88" viewBox="0 0 72 88" fill="none" stroke="currentColor" strokeWidth=".8" className="text-fg-3"><path d="M4 47 35 31 68 47 36 64Z M4 52 36 69 68 52 M4 57 36 74 68 57 M4 62 36 79 68 62 M4 67 36 84 68 67" opacity=".4"/><path d="m3 43 19-34 34-6 2 3-19 34-34 6Z M6 43 25 11 55 5 M38 40 58 6"/></svg>}
      title="Views"
      actions={<>
        <Button size="medium" onClick={create}>Create new view</Button>
        <ButtonLink variant="secondary" size="small" href="https://linear.app/docs/custom-views" target="_blank" rel="noreferrer">Documentation</ButtonLink>
      </>}
    >
      <p>Create custom views using filters to show only the issues you want to see. You can save and favorite these views for easy access and faster issue triage.</p>
      <p>You can also save any existing view by clicking the <span className="inline-flex align-middle"><Icon name="view" /></span> icon or by pressing <Shortcut keys="Alt+V" size="small" className="align-middle" />.</p>
    </EmptyState>}
  </section>;
}

export function ViewFavorites() {
  const favorites = useStore(s => s.favorites), views = useSavedViews(), active = useActiveView();
  const boards = useStore(s => s.boards), issues = useStore(s => s.issues);
  const rows = favorites.flatMap(id => {
    const view = views.find(v => `view:${v.id}` === id);
    const document = id.startsWith("document:") ? findIssueDocument(issues.values(), id.slice(9)) : undefined;
    const issue = issues.get(id), board = id.startsWith("board:") ? boards.find(b => b.id === Number(id.split(":")[1])) : undefined;
    if (!view && !document && !issue && !board) return [];
    // Sidebar navigation rows use selected-page geometry, outside the Button variants.
    const button = <button key={id} aria-current={view?.id === active?.id && !!view ? "page" : undefined} onClick={() => {
      if (view) openSavedView(view);
      else if (document) navigate({ board: document.issue.board, selected: document.issue.key, panel: true, document: document.resource.id });
      else if (issue) navigate({ board: issue.board, selected: issue.key, panel: true });
      else if (board) navigate({ board: board.id, panel: false, selected: null });
    }} className={`flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left ${view && active?.id === view.id ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}>{view ? <SavedViewIcon view={view} /> : document ? <Icon name="file" /> : <span className="text-fg-3">☆</span>}<span className="truncate">{view?.name ?? (document ? document.resource.title || "New document" : issue ? `${issue.key} ${issue.summary}` : board?.name)}</span></button>;
    return [view ? <ViewContextMenu key={id} view={view}>{button}</ViewContextMenu> : button];
  });
  return rows.length ? <div className="mt-5"><Text as="div" variant="mini" color="muted" className="mb-1 px-2">Favorites</Text>{rows}</div> : null;
}
export function ViewDetails({ view, issues }: { view: SavedView; issues: Issue[] }) {
  const summaries = viewSummaries(issues);
  const [tab, setTab] = useState<"assignees" | "labels">("assignees");
  const rows = summaries[tab];
  return <aside aria-label="View details" className="view-details w-[320px] shrink-0 overflow-auto border-l border-line p-5 text-[13px] max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:bg-panel">
    <div className="mb-3"><SavedViewIcon view={view} /></div><Text as="h2" variant="regularPlus" color="base">{view.name}</Text>{view.description && <Text as="p" variant="small" color="muted" className="mt-2 whitespace-pre-wrap">{view.description}</Text>}
    <dl className="my-6 grid grid-cols-[90px_1fr] gap-y-3"><dt className="text-fg-3">Visibility</dt><dd>Personal</dd><dt className="text-fg-3">Owner</dt><dd className="flex items-center gap-2"><Avatar user={ME} size={18} />{ME.name}</dd></dl>
    <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)}>
      <Tabs.List variant="summary" aria-label="Summary" className="mb-3">{(["assignees", "labels"] as const).map(key => <Tabs.Tab key={key} value={key}>{key === "assignees" ? "Assignees" : "Labels"}</Tabs.Tab>)}</Tabs.List>
      <Tabs.Panel value={tab}>{rows.length ? rows.map(([name, count]) => <div key={name} className="flex h-9 items-center justify-between px-1 text-fg-2"><span className="truncate">{name}</span><CountBadge>{count}</CountBadge></div>) : <Text as="p" variant="small" color="muted" className="px-1 py-2">{tab === "assignees" ? "No assignees" : "No labels"}</Text>}</Tabs.Panel>
    </Tabs>
  </aside>;
}
// Linear HiddenIndicator (assets/HiddenIndicator.*.js, 2026-11-11): a flex row (so no space) of the count as Text miniPlus (12px/normal/500, labelTitle,
// 3px 5px padding, 3px radius), " ", label as Text mini (12px/normal/450, labelMuted); row gap 8px; the action is a
// small borderless Button (24px, 8px sides, pill, 12px/500 labelBase; hover bgBorder-hover + labelTitle, instant in,
// 0.15s out) holding "Clear Filters" and a 12px X 6px apart. Numbers use Intl.NumberFormat.
function HiddenRow({ hidden, clear, between }: { hidden: number; clear: () => void; between?: boolean }) {
  return <div className={`flex flex-wrap items-center gap-2 ${between ? "justify-between" : "justify-center"}`}>
    <span className="flex items-center whitespace-nowrap"><Text variant="miniPlus" className="rounded-[3px] px-[5px] py-[3px]">{new Intl.NumberFormat().format(hidden)} issue{hidden === 1 ? "" : "s"}</Text> <Text variant="mini" color="muted">hidden by filters</Text></span>
    <div className="flex"><Button variant="borderless" size="small" onClick={clear}>Clear Filters<Icon name="x" size={12} /></Button></div>
  </div>;
}
export function ResultsFeedback({ count, baseline, view, temporary, clear, layout = "list" }: { count: number; baseline: number; view: SavedView | null; temporary: boolean; clear: () => void; layout?: "list" | "board" }) {
  const feedback = resultFeedback(count, baseline, !!view, temporary);
  if (!feedback) return null;
  // Linear's saved-empty state: a centred filter illustration and one line, nothing to act on.
  if (feedback.saved) return <div role="status" className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-6 text-[14px] font-medium text-fg-3">
    <svg aria-hidden="true" width="140" height="84" viewBox="0 0 140 84" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect width="100" height="100" rx="14" transform="matrix(.9 -.28 .46 .48 2 28)" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" opacity=".6" />
      <g className="text-fg-2" transform="translate(0 6) rotate(-13 70 30)" strokeWidth="1.25">
        {[[28, 10, 66], [50, 26, 44], [70, 42, 24]].map(([x, y, w]) => <g key={y}>
          <rect x={x} y={y} width={w} height="8" rx="4" />
          <path d={`M${x! + 0.5} ${y! + 5}v2.5a4 4 0 0 0 4 4h${w! - 9}a4 4 0 0 0 4 -4v-2.5`} opacity=".7" />
        </g>)}
      </g>
    </svg>
    {feedback.text}
  </div>;
  // Partial results: hiddenItemsContainer (full width, 12px top/bottom, wraps, centred, 20px gap) inside Linear's board
  // footer (45px bar on bgBase under the columns) or list footer (84px row after the last item, 34px sides).
  if (count) {
    const inner = <div role="status" className="flex w-full flex-wrap items-center justify-center gap-5 py-3"><HiddenRow hidden={feedback.hidden} clear={clear} /></div>;
    return layout === "board" ? <div className="flex h-[45px] shrink-0 items-center justify-center bg-panel">{inner}</div> : <div className="flex h-[84px] justify-center px-[34px]">{inner}</div>;
  }
  // Zero state: the rows sit in a bgBorder box (0.5px, 5px radius, min 350px), each 16px padded, count left, action right.
  return <div role="status" className="flex shrink-0 flex-col items-center justify-center gap-4 py-12 text-[13px] text-fg-3"><span className="text-[15px] font-medium">{feedback.text}</span>
    {feedback.hidden ? <div className="min-w-[350px] rounded-[5px] border-[0.5px] border-(--bg-border)"><div className="p-4"><HiddenRow hidden={feedback.hidden} clear={clear} between /></div></div> : null}</div>;
}
