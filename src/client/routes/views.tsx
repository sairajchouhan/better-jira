import { useState } from "react";
import { Icon } from "@/client/components/icons";
import { Avatar } from "@/client/components/avatar";
import { ME, useStore } from "@/client/state/store";
import { createViewDraft, openSavedView, useSavedViews } from "@/client/features/views/saved-views";
import { SavedViewIcon } from "@/client/features/views/views-navigation";
import { openViewEditor, ViewContextMenu } from "./view-editor";
import { MenuSurface } from "@/client/components/menu-surface";
import { Menu } from "@/client/components/menu";
import { Button, ButtonLink, IconButton } from "@/client/components/button";
import { Tabs } from "@/client/components/tabs";
import { Text } from "@/client/components/text";
import { EmptyState } from "@/client/components/empty-state";
import { Shortcut } from "@/client/components/keycap";
import { directoryViews } from "@/client/features/views/views-navigation-model";

/** The `/team/<board>/views` route: the board's saved views. */
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
    {rows.length ? <div role="table" aria-label="Custom views" data-scroll-restoration-id="views-list" className="overflow-auto">
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
