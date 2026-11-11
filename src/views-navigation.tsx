import { useState } from "react";
import { Icon, type IconName } from "./icons";
import { Avatar } from "./avatar";
import { ME, navigate, useStore, type Issue } from "./store";
import { findIssueDocument } from "./issue-resource";
import { createViewDraft, editViewDraft, openSavedView, useActiveView, useSavedViews, type SavedView } from "./saved-views";
import { openViewEditor, ViewContextMenu } from "./view-editor";
import { directoryViews, resultFeedback, viewSummaries } from "./views-navigation-model";
import "./views-navigation.css";

export function SavedViewIcon({ view }: { view: SavedView }) {
  return <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: view.color === "gray" ? "var(--fg-3)" : view.color }}>
    {/[^\x00-\x7F]/.test(view.icon) ? view.icon : <Icon name={view.icon as IconName} size={16} />}
  </span>;
}
export function ViewsDirectory() {
  const board = useStore(s => s.boards.find(b => b.id === s.board));
  const views = useSavedViews();
  const [sort, setSort] = useState<"name" | "owner">("name");
  const [descending, setDescending] = useState(false);
  const rows = directoryViews(views, board!.id, descending, sort);
  const order = (key: "name" | "owner") => { setSort(key); setDescending(sort === key ? !descending : false); };
  const create = () => openViewEditor(createViewDraft("custom"));
  return <section aria-label="Views" className="views-directory flex min-w-0 flex-1 flex-col">
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-frame px-4 text-[13px] font-medium text-fg-2"><span>{board?.name}</span><span className="text-fg-3">›</span><h2>Views</h2><button className="ml-auto flex h-7 items-center gap-2 rounded-full pr-2.5 pl-2 text-[12px] text-fg-3 hover:bg-hover" onClick={create}><Icon name="plus" />New view</button></header>
    <div className="flex h-11 shrink-0 items-center px-2"><span className="rounded-full bg-tab-on px-3 py-1.5 text-[12px] font-medium">Issues</span></div>
    {rows.length ? <div role="table" aria-label="Custom views" className="overflow-auto">
      <div role="row" className="views-directory-grid border-b border-line px-3 py-1">
        {(["name", "owner"] as const).map(key => <div role="columnheader" aria-sort={sort === key ? descending ? "descending" : "ascending" : "none"} key={key}><button aria-label={`Order by ${key === "name" ? "Name" : "Owner"}`} className="h-6 rounded-full px-1.5 text-[12px] font-medium text-fg-3 hover:bg-hover" onClick={() => order(key)}>{key === "name" ? "Name" : "Owner"}{sort === key && (descending ? " ↓" : " ↑")}</button></div>)}
      </div>
      {rows.map(view => <ViewContextMenu key={view.id} view={view}><div role="row" className="views-directory-grid px-5 py-3 hover:bg-hover"><div role="cell"><button className="flex w-full items-start gap-3 text-left" onClick={() => openSavedView(view)}><span className="pt-0.5"><SavedViewIcon view={view} /></span><span className="min-w-0"><span className="block truncate text-[13px] font-medium text-fg-2">{view.name}</span>{view.description && <span className="mt-0.5 block truncate text-[13px] text-fg-3">{view.description}</span>}</span></button></div><div role="cell" className="flex items-center gap-2 truncate text-[12px] text-fg-2"><Avatar user={ME} size={18} /><span className="truncate">{ME.name}</span></div></div></ViewContextMenu>)}
    </div> : <div className="flex flex-1 items-center justify-center"><div className="w-[340px] max-w-full px-2 text-[13px] text-fg-3"><div className="mb-8 text-fg-3"><svg aria-hidden="true" width="72" height="88" viewBox="0 0 72 88" fill="none" stroke="currentColor" strokeWidth=".8"><path d="M4 47 35 31 68 47 36 64Z M4 52 36 69 68 52 M4 57 36 74 68 57 M4 62 36 79 68 62 M4 67 36 84 68 67" opacity=".4"/><path d="m3 43 19-34 34-6 2 3-19 34-34 6Z M6 43 25 11 55 5 M38 40 58 6"/></svg></div><h3 className="mb-2 text-[15px] font-semibold text-fg-2">Views</h3><p>Create custom views using filters to show only the issues you want to see. You can save and favorite these views for easy access and faster issue triage.</p><p className="mt-4">You can also save any existing view by clicking the <span className="inline-flex align-middle"><Icon name="view" /></span> icon or by pressing <kbd>⌥</kbd> <kbd>V</kbd>.</p><div className="mt-6 flex gap-2"><button className="views-create" onClick={create}>Create new view</button><a className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-2" href="https://linear.app/docs/custom-views" target="_blank" rel="noreferrer">Documentation</a></div></div></div>}
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
    const button = <button key={id} aria-current={view?.id === active?.id && !!view ? "page" : undefined} onClick={() => {
      if (view) openSavedView(view);
      else if (document) navigate({ board: document.issue.board, selected: document.issue.key, panel: true, document: document.resource.id });
      else if (issue) navigate({ board: issue.board, selected: issue.key, panel: true });
      else if (board) navigate({ board: board.id, panel: false, selected: null });
    }} className={`flex h-7 w-full items-center gap-2 rounded-lg px-2 text-left ${view && active?.id === view.id ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}>{view ? <SavedViewIcon view={view} /> : document ? <Icon name="file" /> : <span className="text-fg-3">☆</span>}<span className="truncate">{view?.name ?? (document ? document.resource.title || "New document" : issue ? `${issue.key} ${issue.summary}` : board?.name)}</span></button>;
    return [view ? <ViewContextMenu key={id} view={view}>{button}</ViewContextMenu> : button];
  });
  return rows.length ? <div className="mt-5"><div className="mb-1 px-2 text-[12px] text-fg-3">Favorites</div>{rows}</div> : null;
}
export function ViewDetails({ view, issues }: { view: SavedView; issues: Issue[] }) {
  const { assignees, labels } = viewSummaries(issues);
  return <aside aria-label="View details" className="view-details w-[320px] shrink-0 overflow-auto border-l border-line p-5 text-[13px] max-sm:absolute max-sm:inset-y-0 max-sm:right-0 max-sm:bg-panel">
    <div className="mb-3"><SavedViewIcon view={view} /></div><h2 className="text-[15px] leading-[23px] font-semibold text-fg-2">{view.name}</h2>{view.description && <p className="mt-2 whitespace-pre-wrap text-fg-3">{view.description}</p>}
    <dl className="my-6 grid grid-cols-[90px_1fr] gap-y-3"><dt className="text-fg-3">Visibility</dt><dd>Personal</dd><dt className="text-fg-3">Owner</dt><dd className="flex items-center gap-2"><Avatar user={ME} size={18} />{ME.name}</dd></dl>
    <h3 className="mb-3 font-medium text-fg-2">Assignees</h3>{assignees.length ? assignees.map(([name, count]) => <div key={name} className="my-2 flex justify-between text-fg-3"><span>{name}</span><span>{count}</span></div>) : <p className="text-fg-3">No assignees</p>}
    <h3 className="mt-6 mb-3 font-medium text-fg-2">Labels</h3>{labels.length ? labels.map(([name, count]) => <div key={name} className="my-2 flex justify-between text-fg-3"><span>{name}</span><span>{count}</span></div>) : <p className="text-fg-3">No labels</p>}
  </aside>;
}
export function ResultsFeedback({ count, baseline, view, temporary, clear }: { count: number; baseline: number; view: SavedView | null; temporary: boolean; clear: () => void }) {
  const feedback = resultFeedback(count, baseline, !!view, temporary);
  if (!feedback) return null;
  return <div role="status" className={`flex shrink-0 flex-col items-center justify-center gap-3 text-[13px] text-fg-3 ${count ? "py-4" : "py-12"}`}><span>{feedback.text}</span>{feedback.edit ? <button className="rounded-full bg-btn px-3 py-1 text-[12px] font-medium text-fg-2 shadow-(--tab-shadow)" onClick={() => view && openViewEditor(editViewDraft(view.id))}>Edit your filters</button> : <button className="text-[12px] font-medium text-fg-2" onClick={clear}>Clear filters</button>}</div>;
}
