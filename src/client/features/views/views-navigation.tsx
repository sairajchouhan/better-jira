import { type Issue } from "@/shared/issue-model";
import { SidebarLink, SidebarViewLink } from "@/client/features/navigation/sidebar-link";
import { favoritePlace } from "@/client/features/navigation/sidebar-active";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/client/components/icons";
import { Avatar } from "@/client/components/avatar";
import { ME, useStore } from "@/client/state/store";
import { moveFavorite } from "@/client/features/navigation/favorites";
import { boardURL, favoriteEntries } from "@/client/features/navigation/sidebar-menus";
import { placeURL } from "@/client/features/navigation/app-navigation";
import { ContextMenu } from "@/client/components/action-menu";
import { SectionDisclosure } from "@/client/components/section-disclosure";
import { findIssueDocument } from "@/shared/issue-resource";
import { useSavedViews, type SavedView } from "./saved-views";
import { FavoriteButton, RemoveFavoriteButton } from "@/client/features/navigation/favorite-button";
import { ViewMenu } from "@/client/features/views/view-editor";
import { Button, IconButton } from "@/client/components/button";
import { Tabs } from "@/client/components/tabs";
import { Sortable } from "@/client/components/sortable";
import { Text } from "@/client/components/text";
import { CountBadge } from "@/client/components/count-badge";
import { viewSummaries, type ResultFeedback } from "./views-navigation-model";
import { boardFor } from "@/shared/board-membership";

export function SavedViewIcon({ view }: { view: Pick<SavedView, "icon" | "color"> }) {
  return <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: view.color === "gray" ? "var(--view-gray)" : view.color }}>
    {/[^\x00-\x7F]/.test(view.icon) ? view.icon : <Icon name={view.icon as IconName} size={16} />}
  </span>;
}
export function ViewFavorites({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const favorites = useStore(s => s.favorites), views = useSavedViews();
  const boards = useStore(s => s.boards), issues = useStore(s => s.issues), current = useStore(s => s.board);
  const rows = favorites.flatMap(id => {
    const view = views.find(v => `view:${v.id}` === id);
    const document = id.startsWith("document:") ? findIssueDocument(issues.values(), id.slice(9)) : undefined;
    const issue = issues.get(id), board = id.startsWith("board:") ? boards.find(b => b.id === Number(id.split(":")[1])) : undefined;
    if (!view && !document && !issue && !board) return [];

    const content = <>{view ? <SavedViewIcon view={view} /> : document ? <Icon name="file" /> : <span className="text-fg-3">☆</span>}<span className="min-w-0 flex-1 truncate">{view?.name ?? (document ? document.resource.title || "New document" : issue ? `${issue.key} ${issue.summary}` : board?.name)}</span><RemoveFavoriteButton id={id} /></>;
    // Each row is the sidebar's one link, marked by the shared rule: active only when the screen came from this favorite.
    const row = { place: favoritePlace(id), favorite: id };
    // The row drags by its surface (BJ-75), so the link itself is never the browser's own drag of its URL.
    // `group/favorite` is the row its × shows on (Linear's `d0.wrapper` hover).
    const props = { draggable: false, "data-favorite": id, className: "group/favorite w-full" };
    const link = view
      ? <SidebarViewLink row={row} view={view} {...props}>{content}</SidebarViewLink>
      : <SidebarLink row={row} to={document ? { board: boardFor(document.issue, current), selected: document.issue.key, panel: true, document: document.resource.id } : issue ? { board: boardFor(issue, current), selected: issue.key, panel: true } : { board: board!.id, panel: false, selected: null }} {...props}>{content}</SidebarLink>;
    // Linear's favorite row (`d5n`) has one menu for every kind of favorite: Copy URL, Open in new tab, ┄ Remove favorite.
    const url = () => board ? boardURL(board) : placeURL(view ? { to: "view", id: view.id } : document ? { to: "issue", key: document.issue.key, document: document.resource.id } : { to: "issue", key: issue!.key });
    return [{ id, row: <ContextMenu label="Favorite options" entries={() => favoriteEntries(id, url)}>{link}</ContextMenu> }];
  });
  // Linear's favourites reorder as a dnd-kit sortable dragged by the whole row (startup-root `LN`): a drop takes the slot of
  // the row it lands on.
  return rows.length ? (
    <div className="mt-5">
      <SectionDisclosure expanded={expanded} onExpandedChange={onToggle}>
        <div className="mb-1"><SectionDisclosure.Trigger label="Favorites" /></div>
        <SectionDisclosure.Panel>
          <Sortable ids={rows.map((r) => r.id)} onMove={moveFavorite}>
            {rows.map(({ id, row }) => <Sortable.Item key={id} id={id}><Sortable.Surface>{row}</Sortable.Surface></Sortable.Item>)}
          </Sortable>
        </SectionDisclosure.Panel>
      </SectionDisclosure>
    </div>
  ) : null;
}
export function ViewDetails({ view, issues }: { view: SavedView; issues: Issue[] }) {
  const summaries = viewSummaries(issues);
  const [tab, setTab] = useState<"assignees" | "labels">("assignees");
  const rows = summaries[tab];
  return <aside aria-label="View details" className="view-details w-[320px] shrink-0 overflow-auto border-l border-line p-5 text-[13px] max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:bg-panel">
    <div className="rounded-lg border border-line bg-col p-4" data-view-card="identity">
    <div className="mb-3 flex items-center"><SavedViewIcon view={view} /><FavoriteButton id={`view:${view.id}`} className="ml-auto" noun="view" /><ViewMenu view={view}><IconButton label="View details options" variant="muted"><Icon name="dots" /></IconButton></ViewMenu></div><Text as="h2" variant="regularPlus" color="base">{view.name}</Text>{view.description && <Text as="p" variant="small" color="muted" className="mt-2 whitespace-pre-wrap">{view.description}</Text>}
    </div>
    <dl data-view-card="properties" className="my-4 grid grid-cols-[90px_1fr] gap-y-3 rounded-lg border border-line bg-col p-4"><dt className="text-fg-3">Visibility</dt><dd>Personal</dd><dt className="text-fg-3">Owner</dt><dd className="flex items-center gap-2"><Avatar user={ME} size={18} />{ME.name}</dd></dl>
    {issues.length > 0 && <Tabs value={tab} onValueChange={value => setTab(value as typeof tab)}>
      <Tabs.List variant="summary" aria-label="Summary" className="mb-3">{(["assignees", "labels"] as const).map(key => <Tabs.Tab key={key} value={key}>{key === "assignees" ? "Assignees" : "Labels"}</Tabs.Tab>)}</Tabs.List>
      <Tabs.Panel value={tab}>{rows.length ? rows.map(([name, count]) => <div key={name} className="flex h-9 items-center justify-between px-1 text-fg-2"><span className="truncate">{name}</span><CountBadge>{count}</CountBadge></div>) : <Text as="p" variant="small" color="muted" className="px-1 py-2">{tab === "assignees" ? "No assignees" : "No labels"}</Text>}</Tabs.Panel>
    </Tabs>}
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
/** Shared illustration for saved and temporary filtered empty results. */
function FilterIllustration() {
  return <svg aria-hidden="true" width="140" height="84" viewBox="0 0 140 84" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect width="100" height="100" rx="14" transform="matrix(.9 -.28 .46 .48 2 28)" vectorEffect="non-scaling-stroke" strokeDasharray="3 3" opacity=".6" />
      <g className="text-fg-2" transform="translate(0 6) rotate(-13 70 30)" strokeWidth="1.25">
        {[[28, 10, 66], [50, 26, 44], [70, 42, 24]].map(([x, y, w]) => <g key={y}>
          <rect x={x} y={y} width={w} height="8" rx="4" />
          <path d={`M${x! + 0.5} ${y! + 5}v2.5a4 4 0 0 0 4 4h${w! - 9}a4 4 0 0 0 4 -4v-2.5`} opacity=".7" />
        </g>)}
      </g>
    </svg>;
}
/**
 * A view's word on its results, `feedback` from views-navigation-model.ts `resultFeedback`: a page with no issue draws
 * `empty` (Linear's `zeroStateFallback`, empty-states.tsx), a saved view matching nothing "No matching issues", a filter
 * leaving nothing "No issues matching the filters" with its hidden count, and a partial result its hidden count.
 */
export function ResultsFeedback({ feedback, empty, clear, layout = "list" }: { feedback: ResultFeedback | null; empty: ReactNode; clear: () => void; layout?: "list" | "board" }) {
  if (!feedback) return null;
  if (feedback.kind === "empty") return empty;
  // Linear's saved-empty state: a centred filter illustration and one line, nothing to act on.
  if (feedback.kind === "saved") return <div role="status" className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-6 text-[14px] font-medium text-fg-3">
    <FilterIllustration />
    {feedback.text}
  </div>;
  // Partial results: hiddenItemsContainer (full width, 12px top/bottom, wraps, centred, 20px gap) inside Linear's board
  // footer (45px bar on bgBase under the columns) or list footer (84px row after the last item, 34px sides).
  if (feedback.kind === "partial") {
    const inner = <div role="status" className="flex w-full flex-wrap items-center justify-center gap-5 py-3"><HiddenRow hidden={feedback.hidden} clear={clear} /></div>;
    return layout === "board" ? <div className="flex h-[45px] shrink-0 items-center justify-center bg-panel">{inner}</div> : <div className="flex h-[84px] justify-center px-[34px]">{inner}</div>;
  }
  // Zero state: the rows sit in a bgBorder box (0.5px, 5px radius, min 350px), each 16px padded, count left, action right.
  return <div role="status" className="flex shrink-0 flex-col items-center justify-center gap-4 py-12 text-[13px] text-fg-3"><FilterIllustration /><span className="text-[15px] font-medium">{feedback.text}</span>
    {feedback.hidden ? <div className="min-w-[350px] rounded-[5px] border-[0.5px] border-(--bg-border)"><div className="p-4"><HiddenRow hidden={feedback.hidden} clear={clear} between /></div></div> : null}</div>;
}
