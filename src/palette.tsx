import {
  useActiveView,
  useOverlayFilters,
  createViewDraft,
  editViewDraft,
  duplicateViewDraft,
  saveOverlayToView,
} from "./saved-views";
import { openViewEditor, ViewDeleteDialog } from "./view-editor";
import { canMergeOverlay } from "./saved-view-model";
import { createToolbarView } from "./view-toolbar-actions";
import { Command } from "cmdk";
import { useMemo, useState, type ReactNode } from "react";
import { navigationChoices, type NavigationChoice } from "./quick-navigation";
import { setScope } from "./view-settings";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Icon, StatusIcon, TypeDot } from "./icons";
import { currentKey, get, navigate, openSavedView, set, timed, ui, useStore, type Issue, statusOf, ME } from "./store";
import { toggleFavorite } from "./favorites";
import { peopleOf } from "./people";
import { filterCount } from "./view-model";
import { Modal } from "./personal-controls";
import { Avatar } from "./avatar";
import { matchRank } from "./search-rank";
import {
  matchDocuments,
  matchesSearchFilters,
  matchIssues,
  SEARCH_FILTER_FIELDS,
  SEARCH_ORDERINGS,
  type DocumentMatch,
  type SearchFilter,
  type SearchOrdering,
} from "./issue-search";
import { FilterChip } from "./filter-chip";
import { FilterIcon } from "./filter-icons";
import { IconButton } from "./button";
import { useStoredState } from "./stored-state";
import { SelectRow } from "./display-options";
import { recentIssues, recentSearches, recordSearch } from "./recents";
import { hotkeyOf, runShortcut, shortcutApplies, shortcuts } from "./shortcuts";
import { Shortcut, type Keys } from "./keycap";
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

/** `keys`: the hotkey that does the same thing, drawn after the name. `id` keys the row when names repeat (its value keeps the name). */
type Cmd = { id?: string; name: string; keys?: Keys; icon?: ReactNode; disabled?: boolean; run: () => void };

/** One command row; ⌘K's commands and every nested page's choices. */
function CommandRow({ cmd: c }: { cmd: Cmd }) {
  return (
    <Command.Item value={`cmd:${c.id ? `${c.id} ` : ""}${c.name}`} disabled={c.disabled} className="data-[disabled=true]:opacity-50" onSelect={c.run}>
      <span className="grid w-4 shrink-0 place-items-center text-fg-3">{c.icon}</span>
      <span className="flex-1 truncate">{c.name}</span>
      {c.keys?.length ? <Shortcut keys={c.keys} /> : null}
    </Command.Item>
  );
}
/** Best match first, so Enter runs the row whose name was typed; every row while the query is empty. */
const ranked = (cmds: Cmd[], q: string) =>
  cmds
    .map((c) => [q.trim() ? matchRank(c.name, q) : 0, c] as const)
    .filter(([r]) => r >= 0)
    .sort(([a], [b]) => a - b);

/** Linear's nested "Open …" command pages (`nameAsParent`, `searchShortcut.keyword` in startup-root.CnUSfl4j.js): their
 *  chord opens the palette on the page, with the parent's name as the input's chip; ⌫ in the empty input leaves it. */
const PAGES = {
  favorites: { parent: "Favorite", label: "Open favorite", keyword: "f" },
  boards: { parent: "Team", label: "Open team", keyword: "t" },
  views: { parent: "View", label: "Open view", keyword: "v" },
  issues: { parent: "Issue", label: "Open issue", keyword: "i" },
  documents: { parent: "Document", label: "Open document", keyword: "d" },
  users: { parent: "User", label: "Open user", keyword: "u" },
  /** Linear's `?` Help action (`mAt`, search input hidden) when the sidebar's Help button isn't there to anchor its menu. */
  help: { parent: "Help", label: "Help", keyword: undefined },
} as const;
export type PalettePage = keyof typeof PAGES;
export const isPalettePage = (overlay: string | null): overlay is PalettePage => !!overlay && overlay in PAGES;
/** The page a root query's `searchShortcut.keyword` and a space ("t ") focuses search on (BJ-64). */
export const keywordPage = (q: string) =>
  (Object.keys(PAGES) as PalettePage[]).find((page) => PAGES[page].keyword && q === `${PAGES[page].keyword} `);
const close = () => ui.send({ type: "overlay.close" });

function openChoice({ destination: to }: NavigationChoice) {
  close();
  if ("view" in to) return openSavedView(to.view);
  const { scope, ...route } = to;
  navigate(route);
  if (scope) setScope(to.board, scope);
}
/** A page's rows, unfiltered. */
function usePageRows(page: PalettePage): Cmd[] {
  const boards = useStore((s) => s.boards);
  const savedViews = useStore((s) => s.savedViews);
  const favorites = useStore((s) => s.favorites);
  const issues = useStore((s) => s.issues);
  if (page === "issues" || page === "documents") return [];
  if (page === "users")
    return peopleOf(issues.values()).map((u) => ({
      id: u.id,
      name: u.name,
      icon: <Avatar user={u} size={16} />,
      // A user's issues (BJ-77); choosing myself is My issues.
      run: () => (close(), navigate({ mine: true, person: u.id === ME.id ? null : u.id, selected: null, panel: false })),
    }));
  if (page === "help")
    return [{ name: "Keyboard shortcuts", keys: hotkeyOf("shortcuts"), run: () => ui.send({ type: "overlay.open", overlay: "shortcuts" }) }];
  return navigationChoices(page, { boards, savedViews, favorites, issues }).map((choice) => ({
    id: choice.id,
    name: choice.name,
    run: () => openChoice(choice),
  }));
}
function PageRows({ page, q, setQ }: { page: PalettePage; q: string; setQ: (q: string) => void }) {
  const rows = ranked(usePageRows(page), q);
  if (page === "issues") return <IssueRows q={q} setQ={setQ} />;
  if (page === "documents") return <DocumentResults q={q} />;
  return rows.map(([, c]) => <CommandRow key={c.id ?? c.name} cmd={c} />);
}

/** Linear's Help menu under the sidebar's Help button; the same entries in the palette when that button is hidden. */
export function HelpMenu() {
  const [anchor] = useState(() => {
    const node = document.getElementById("help-menu");
    return node?.getClientRects().length ? node : null;
  });
  const rows = usePageRows("help");
  if (!anchor) return <CommandPalette page="help" />;
  return (
    <ActionMenu
      label="Help"
      anchor={anchor}
      close={close}
      entries={rows.map((c) => ({ name: c.name, shortcut: c.keys, run: c.run }))}
    />
  );
}

/** The palette dialog both search and ⌘K use: the input (with the scoped issue's chip), then the result groups.
 *  Not menu.tsx on purpose: Linear's ⌘K CommandMenu renders through its own large-menu compound
 *  (`WK = {List, Item, Title, GroupHeader, Divider, TextDivider, Input, Peek}` in startup-root.CnUSfl4j.js), while IB
 *  (menu.tsx) serves only its small and contextual command menus. */
function PaletteFrame({
  label,
  q,
  setQ,
  chip,
  placeholder = "Search issues or type a command…",
  onBackspace,
  footer,
  children,
}: {
  label: string;
  q: string;
  setQ: (q: string) => void;
  /** What the palette acts on or is nested in: the scoped issue, or a page's parent name. */
  chip?: ReactNode;
  placeholder?: string;
  /** Runs on Backspace in an empty input. */
  onBackspace?: () => void;
  /** Controls under the results, outside cmdk so their own menus keep their keys. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Overlay label={label}>
      <div className={`w-full ${MENU}`}>
      <Command shouldFilter={false} loop>
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {chip && (
            <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-sel px-2 text-[12px] text-fg-2">
              {chip}
            </span>
          )}
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && onBackspace?.()}
            placeholder={placeholder}
            className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
          />
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-3 text-fg-3">No results</Command.Empty>
          {children}
        </Command.List>
      </Command>
      {footer && <div className="border-t border-line px-3.5 py-1.5">{footer}</div>}
      </div>
    </Overlay>
  );
}

const openIssue = (i: Issue) =>
  timed(`open ${i.key}`, () => (close(), navigate({ board: i.board, selected: i.key, panel: true }), ui.send({ type: "query.set", query: "" })));

/** An issue row: status, key, title and assignee; picking it opens the issue on its board. */
function IssueRow({ issue: i, onOpen }: { issue: Issue; onOpen?: () => void }) {
  const s = statusOf(i);
  return (
    <Command.Item value={i.key} onSelect={() => (onOpen?.(), openIssue(i))}>
      {s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />}
      <span className="w-[88px] shrink-0 text-[12px] tracking-[-0.24px] text-fg-3">{i.key}</span>
      <span className="flex-1 truncate">{i.summary}</span>
      <Avatar user={i.assignee} size={18} />
    </Command.Item>
  );
}

/** The "Issues (n)" group for a typed query; opening one remembers the query as a recent search. */
function IssueResults({ results, q }: { results: Issue[]; q: string }) {
  if (!results.length) return null;
  return (
    <Command.Group heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}>
      {results.map((i) => <IssueRow key={i.key} issue={i} onOpen={() => recordSearch(q)} />)}
    </Command.Group>
  );
}

/** The "Documents" group: documents whose title or body matches (every document on the Open document page). */
function DocumentResults({ q }: { q: string }) {
  const issues = useStore((s) => s.issues);
  const results = useMemo(() => matchDocuments(issues, q), [q, issues]);
  if (!results.length) return null;
  return (
    <Command.Group heading="Documents">
      {results.map((m) => <DocumentRow key={m.resource.id} match={m} q={q} />)}
    </Command.Group>
  );
}
function DocumentRow({ match: { issue, resource }, q }: { match: DocumentMatch; q: string }) {
  return (
    <Command.Item
      value={`document:${resource.id}`}
      onSelect={() => {
        recordSearch(q);
        close();
        navigate({ board: issue.board, selected: issue.key, panel: true, document: resource.id });
      }}
    >
      <span className="grid w-4 shrink-0 place-items-center text-fg-3"><Icon name="file" /></span>
      <span className="flex-1 truncate">{resource.title || "New document"}</span>
      <span className="shrink-0 text-[12px] text-fg-3">{issue.key}</span>
    </Command.Item>
  );
}

/** Search (/) and Open issue (O I): matching issues; before anything is typed, Linear's Recent issues (the ten last
 *  opened, not the open one) and Recent searches, or the 20 most recently updated until any issue has been opened. */
function IssueRows({
  q,
  setQ,
  ordering,
  filters = [],
}: {
  q: string;
  setQ: (q: string) => void;
  ordering?: SearchOrdering;
  filters?: SearchFilter[];
}) {
  const all = useStore((s) => s.issues);
  const issues = useMemo(
    () =>
      filters.length
        ? new Map([...all].filter(([, i]) => matchesSearchFilters(i, filters, (x) => statusOf(x)?.name)))
        : all,
    [all, filters],
  );
  const [recent] = useState(() => {
    const open = get().panel ? get().selected : null;
    return recentIssues().flatMap((key) => {
      const issue = issues.get(currentKey(key));
      return issue && issue.key !== open ? [issue] : [];
    }).slice(0, 10);
  });
  const [searches] = useState(recentSearches);
  const searching = !!q.trim() || filters.length > 0;
  const results = useMemo(() => (searching ? matchIssues(issues, q, ordering) : []), [searching, q, issues, ordering]);
  if (searching) return <IssueResults results={results} q={q} />;
  if (!recent.length && !searches.length)
    return (
      <IssueResults
        results={[...issues.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 20)}
        q=""
      />
    );
  return (
    <>
      {recent.length > 0 && (
        <Command.Group heading="Recent">
          {recent.map((i) => <IssueRow key={i.key} issue={i} />)}
        </Command.Group>
      )}
      {searches.length > 0 && (
        <Command.Group heading="Recent searches">
          {searches.map((search) => (
            <Command.Item key={search} value={`search:${search}`} onSelect={() => setQ(search)}>
              <span className="grid w-4 shrink-0 place-items-center text-fg-3"><Icon name="search" /></span>
              <span className="flex-1 truncate">{search}</span>
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

/** Search's Filter bar (BJ-62), beside @name: the board toolbar's filter chips, and a Filter menu of the properties issues
 *  share across boards. Each pick adds or removes one value; a chip's × drops its property. */
function SearchFilterBar({
  filters,
  setFilters,
}: {
  filters: SearchFilter[];
  setFilters: (update: (filters: SearchFilter[]) => SearchFilter[]) => void;
}) {
  const issues = useStore((s) => s.issues),
    boards = useStore((s) => s.boards);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const choices = (field: SearchFilter["field"]): [value: string, label: string][] => {
    if (field === "board") return boards.map((b) => [String(b.id), b.name]);
    const names =
      field === "status"
        ? boards.flatMap((b) => b.columns.flatMap((c) => c.statuses.map((st) => st.name)))
        : [...issues.values()].flatMap((i) => (field === "labels" ? i.labels : i.priority ? [i.priority] : []));
    return [...new Set(names)].sort().map((name) => [name, name]);
  };
  const label = (field: SearchFilter["field"], value: string) =>
    field === "board" ? (boards.find((b) => String(b.id) === value)?.name ?? value) : value;
  const toggle = (field: SearchFilter["field"], value: string) =>
    setFilters((current) => {
      const values = current.find((f) => f.field === field)?.values ?? [],
        next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value],
        rest = current.filter((f) => f.field !== field);
      return next.length ? [...rest, { field, values: next }] : rest;
    });
  const entries: ActionEntry[] = SEARCH_FILTER_FIELDS.map(([field, name]) => ({
    name,
    image: <FilterIcon name={name} />,
    children: choices(field).map(([value, text]) => ({
      name: text,
      selected: !!filters.find((f) => f.field === field)?.values.includes(value),
      run: () => toggle(field, value),
    })),
  }));
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5" aria-label="Search filters">
      {filters.map(({ field, values }) => {
        const name = SEARCH_FILTER_FIELDS.find(([f]) => f === field)![1];
        return (
          <FilterChip key={field}>
            <FilterChip.Label>{name} is</FilterChip.Label>
            <FilterChip.Value>{values.map((v) => label(field, v)).join(", ")}</FilterChip.Value>
            <FilterChip.Remove
              label={`Remove ${name} filter`}
              onClick={() => setFilters((current) => current.filter((f) => f.field !== field))}
            />
          </FilterChip>
        );
      })}
      <IconButton label="Filter" variant="muted" size="small" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>
        <Icon name="filter" />
      </IconButton>
      {anchor && <ActionMenu label="Filter" anchor={anchor} entries={entries} close={() => setAnchor(null)} />}
    </div>
  );
}

const isOrdering = (raw: unknown): SearchOrdering =>
  SEARCH_ORDERINGS.find(([value]) => value === raw)?.[0] ?? "relevance";

/** Search (/): issues, in Linear's Search ordering, then documents. */
export function IssueSearch() {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const namespace = useStore((s) => s.namespace);
  const [ordering, setOrdering] = useStoredState(`better-jira:search-ordering:v1:${namespace}`, isOrdering, "relevance");
  return (
    <PaletteFrame
      label="Search issues"
      q={q}
      setQ={setQ}
      footer={
        <>
          <SearchFilterBar filters={filters} setFilters={setFilters} />
          <SelectRow label="Ordering" value={ordering} options={SEARCH_ORDERINGS} onChange={(v) => setOrdering(isOrdering(v))} />
        </>
      }
    >
      <IssueRows q={q} setQ={setQ} ordering={ordering} filters={filters} />
      {q.trim() && <DocumentResults q={q} />}
    </PaletteFrame>
  );
}

/** ⌘K: commands for the selected issue (Backspace drops it), the open view and the app, then matching issues; or one of
 *  its nested pages. */
export function CommandPalette({ page: initialPage }: { page?: PalettePage }) {
  const [page, setPage] = useState(initialPage ?? null);
  const [q, setQ] = useState("");
  if (page)
    return (
      <PaletteFrame
        label={PAGES[page].label}
        q={q}
        setQ={setQ}
        chip={PAGES[page].parent}
        placeholder="Search…"
        onBackspace={() => setPage(null)}
      >
        <PageRows page={page} q={q} setQ={setQ} />
      </PaletteFrame>
    );
  return <RootPalette openPage={(p) => (setQ(""), setPage(p))} />;
}
function RootPalette({ openPage }: { openPage: (page: PalettePage) => void }) {
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  // The ids of the shortcuts that apply now, as a string, so the palette re-renders only when that set changes.
  const applicable = useStore((s) => shortcuts.filter((e) => shortcutApplies(e, s)).map((e) => e.id).join(" "));
  const applyingIds = new Set(applicable.split(" "));
  const applies = (entry: (typeof shortcuts)[number]) => applyingIds.has(entry.id);
  const [scope, setScopeKey] = useState(get().document ? null : get().selected);
  const [q, setQ] = useState("");
  const scoped = scope ? issues.get(scope) : undefined;
  const activeView = useActiveView();
  const overlay = useOverlayFilters();
  const favorites = useStore(s => s.favorites);
  const [deletingView, setDeletingView] = useState(false);
  const [savingTo, setSavingTo] = useState(false);
  const viewAction = (run: () => void) => () => { ui.send({ type: "overlay.close" }); run(); };
  const viewCommands: Cmd[] = activeView ? [
    { name: "Edit view…", run: viewAction(() => openViewEditor(editViewDraft(activeView.id))) },
    { name: "Save to…", run: () => { setSavingTo(true); setQ(""); } },
    { name: favorites.includes(`view:${activeView.id}`) ? "Unfavorite view" : "Favorite view", keys: hotkeyOf("view-favorite"), run: viewAction(() => toggleFavorite(`view:${activeView.id}`)) },
    { name: "Make a copy as new view…", run: viewAction(() => openViewEditor(duplicateViewDraft(activeView.id))) },
    { name: "Delete view", run: () => setDeletingView(true) },
  ] : [];
  const results = useMemo(() => (q.trim() ? matchIssues(issues, q) : []), [q, issues]);

  const command = (entry: (typeof shortcuts)[number]): Cmd => ({
    name: entry.label?.() ?? entry.name,
    keys: hotkeyOf(entry.id),
    run: () => {
      ui.send({ type: "overlay.close" });
      runShortcut(entry.id);
    },
  });
  // Only commands that would do something now, as Linear lists them.
  const issueCmds: Cmd[] = scoped
    ? shortcuts.filter((s) => s.issue && applies(s)).map(command)
    : [];
  const general: Cmd[] = [
    ...shortcuts
      .filter(
        (s, i, a) =>
          !s.issue &&
          applies(s) &&
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
  // Save to… mirrors the filter row's Save menu, so it is offered even before any temporary filter exists.
  const mergeable = !!activeView && !!filterCount(overlay) && canMergeOverlay(activeView.filters, overlay);
  const groups = savingTo && activeView ? [{ heading: "Save to", rows: ranked([
    { name: filterCount(overlay) && !mergeable ? "Cannot merge these filters into the view" : "Save to this view", keys: hotkeyOf("view-save"), disabled: !mergeable, run: viewAction(() => { void saveOverlayToView().catch(e => set({ perf: String(e) })); }) },
    { name: "Create new view…", keys: hotkeyOf("view-create"), run: viewAction(createToolbarView) },
  ], q) }] : [
    { heading: scoped?.key ?? "", rows: ranked(issueCmds, q) },
    { heading: `View · ${activeView?.name ?? ""}`, rows: ranked(viewCommands, q) },
    { heading: "Views", rows: ranked([{ name: "Create view…", run: viewAction(() => openViewEditor(createViewDraft("custom"))) }], q) },
    { heading: "General", rows: ranked(general, q) },
  ]
    .filter((g) => g.rows.length)
    .sort((a, b) => a.rows[0]![0] - b.rows[0]![0]);

  if (deletingView && activeView) return <ViewDeleteDialog view={activeView} close={() => { setDeletingView(false); ui.send({ type: "overlay.close" }); }} />;
  return (
    <PaletteFrame
      label="Search issues and commands"
      q={q}
      setQ={(next) => {
        const page = keywordPage(next);
        if (page) openPage(page);
        else setQ(next);
      }}
      chip={scoped && <><TypeDot type={scoped.type} />{scoped.key}</>}
      placeholder={scoped ? "Type a command, or ⌫ to search everything…" : undefined}
      onBackspace={() => (savingTo ? setSavingTo(false) : setScopeKey(null))}
    >
      {groups.map((g) => (
        <Command.Group key={g.heading} heading={g.heading}>
          {g.rows.map(([, c]) => <CommandRow key={c.name} cmd={c} />)}
        </Command.Group>
      ))}
      <IssueResults results={results} q={q} />
      {q.trim() && <DocumentResults q={q} />}
    </PaletteFrame>
  );
}
