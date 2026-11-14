import { EntityIdentifier } from "@/client/components/entity-identifier";
import { type Issue } from "@/shared/issue-model";
import {
  useActiveView,
  useOverlayFilters,
  createViewDraft,
  editViewDraft,
  duplicateViewDraft,
  saveOverlayToView,
} from "@/client/features/views/saved-views";
import { openViewEditor, ViewDeleteDialog } from "@/client/features/views/view-editor";
import { canMergeOverlay } from "@/shared/saved-view-model";
import { createToolbarView } from "@/client/features/views/view-toolbar-actions";
import { useMemo, useState, type ReactNode } from "react";
import { navigationChoices, type NavigationChoice } from "./quick-navigation";
import { ActionLabel, ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Icon, StatusIcon, TypeDot, type IconName } from "@/client/components/icons";
import { get, set, timed, useStore, statusOf, ME } from "@/client/state/store";
import { currentKey } from "@/client/state/jira-sync";
import { navigate, openSavedView, preloadOnHover, ui } from "./app-navigation";
import { toggleFavorite } from "./favorites";
import { peopleOf } from "@/shared/people";
import { equalOperators, filterCount, type Display } from "@/shared/view-model";
import { setDisplay, useViewSettings } from "@/client/features/views/view-settings";
import {
  GROUPING_ACTION,
  ORDERING_ACTION,
  groupingChoices,
  hoistedViewChoices,
  orderingChoices,
} from "@/client/features/views/view-choices";
import { MenuSurface } from "@/client/components/menu-surface";
import { Menu } from "@/client/components/menu";
import { COMMAND_MENU_WIDTH, CommandMenuTitle } from "@/client/components/command-menu";
import { Avatar } from "@/client/components/avatar";
import { actionScore, hoistedRow, hoistValues, MIN_APPLICABILITY, type ScoredAction } from "@/client/lib/fuzzy-score";
import { issuePropertyEntries } from "@/client/features/issue/issue-menu";
import { workOnIssueEntry } from "@/client/features/issue/coding-tools";
import { COMMAND_KEYWORDS, VIEW_COMMAND_KEYWORDS } from "./command-keywords";
import {
  matchDocuments,
  matchesSearchFilters,
  toggleSearchValue,
  matchIssues,
  SEARCH_FILTER_FIELDS,
  SEARCH_ORDERINGS,
  type DocumentMatch,
  type SearchFilter,
  type SearchOrdering,
} from "./issue-search";
import { FilterBar, FilterBlock, type OpenedBy } from "@/client/components/filter-block";
import { FilterOperatorMenu } from "@/client/features/filters/filter-operator-menu";
import { plural } from "@/client/features/filters/property-filter";
import { FilterIcon } from "@/client/features/filters/filter-icons";
import { IconButton } from "@/client/components/button";
import { useStoredState } from "@/client/state/stored-state";
import { SelectRow } from "@/client/components/display-options";
import { recentIssues, recentSearches, recordSearch, resolveRecents } from "./recents";
import { hotkeyOf, runShortcut, shortcutApplies, shortcuts } from "./shortcuts";
import { isMac, type Keys } from "@/client/components/keycap";
import { appURL, jiraIssueURL } from "@/client/features/issue/issue-urls";
import { useSmartLinkDetails } from "@/client/state/smart-link-details";
import { browseURL, opensNewTab, pastedIssue, pastedRow, type PastedIssue } from "./pasted-issue";
import type { SmartLinkDetails } from "@/shared/smart-link";
import {
  groupPriority,
  LISTED_BY_VIEW_GROUP,
  orderGroups,
  paletteGroupOf,
  TARGET_PRIORITY,
  VIEW_PRIORITY,
  type PaletteGroup,
} from "./palette-groups";

/** `keys`: the hotkey that does the same thing, drawn after the name. `id` keys the row when names repeat (its value keeps the name).
 *  It is scored as Linear scores an action (`actionScore`): by its name, `keywords` and, for a hoisted value, its `parents`. */
type Cmd = ScoredAction & { id?: string; keys?: Keys; icon?: ReactNode; disabled?: boolean; checked?: boolean; run: () => void };

/** One command row (Linear's command-menu Item, Fgn): icon, name, shortcut; ⌘K's commands and every nested page's choices. A value
 *  hoisted from a parent leads with its breadcrumb ("Change status › In Progress", Linear's M4e) and checks the current value. */
function CommandRow({ cmd: c }: { cmd: Cmd }) {
  const label = [...(c.parents ?? []), c.name].join(" › ");
  return (
    <Menu.Item
      value={`cmd:${c.id ? `${c.id} ` : ""}${label}`}
      disabled={c.disabled}
      onSelect={c.run}
      icon={c.icon}
      checked={c.checked}
      shortcut={c.keys?.length ? c.keys : undefined}
    >
      <ActionLabel name={label} />
    </Menu.Item>
  );
}

/** Each command's icon, as Linear's actions carry one; a group's own image (Help's Book: mO.defaultImage) otherwise. */
const COMMAND_ICONS: Record<string, IconName> = {
  new: "plus",
  "new-full": "plus",
  search: "search",
  find: "search",
  undo: "undo",
  redo: "redo",
  "inbox-undo": "undo",
  back: "arrow-left",
  sidebar: "side",
  "customize-sidebar": "side",
  preferences: "user",
  details: "side",
  display: "display",
  layout: "display",
  "collapse-all": "display",
  // Linear's grouping image (useGroupingMenu `u`: three stacked bars) and ordering image (useOrderingMenu `m`: arrows up and down).
  grouping: "list",
  ordering: "sort-desc",
  "copy-page": "link",
  "dismiss-toast": "close",
  "toast-open": "external",
  "open-issue": "external",
  "open-document": "file",
  "open-user": "user",
  mine: "user",
  inbox: "inbox",
  active: "board",
  backlog: "board",
  all: "board",
  "team-open": "board",
  "board-add": "plus",
  "favorite-open": "star",
  "view-open": "view",
  "last-viewed": "clock",
  help: "help",
  shortcuts: "keyboard",
  filter: "filter",
  "filter-clear": "filter",
  "filter-last": "filter",
  "view-create": "plus",
  "view-save": "view",
  "view-favorite": "star",
  "document-rename": "pencil",
  "document-favorite": "star",
  "document-subscribers": "bell",
  "document-remind": "clock",
  "document-authors": "user",
  "document-copy-url": "link",
  "document-copy-title": "copy",
  "document-copy-link": "link",
  "document-copy-markdown": "copy",
};
const GROUP_ICONS: Record<PaletteGroup, IconName> = {
  Document: "file",
  Notifications: "inbox",
  Issues: "plus",
  Views: "view",
  Filter: "filter",
  Navigation: "arrow-left",
  "Display options": "display",
  Miscellaneous: "dots",
  Help: "help",
};
const commandIcon = (id: string, group?: PaletteGroup) => {
  const name = COMMAND_ICONS[id] ?? (group && GROUP_ICONS[group]);
  return name ? <Icon name={name} size={16} /> : undefined;
};
/** Linear's root search: the rows scoring at least 0.24 (DEFAULT_MIN_APPLICABILITY_SCORE), best first, so Enter runs the best one;
 *  ties keep their order. Every row while the query is empty. */
const ranked = (cmds: Cmd[], q: string): (readonly [number, Cmd])[] =>
  q.trim()
    ? cmds
        .map((c) => [actionScore(c, q), c] as const)
        .filter(([score]) => score >= MIN_APPLICABILITY)
        .sort(([a], [b]) => b - a)
    : cmds.map((c) => [0, c] as const);

/** The targeted issue's commands whose values ⌘K lists once enough is typed (Linear's subActionsHoisting on RCn, Odn, Xun, eK
 *  and Work on issue's K5t), by the registry id that must apply: status, priority and the coding tools from 2 characters, assignee
 *  and labels from 3 (each entry's hoistFrom). */
const HOISTED = [
  ["status", "status"],
  ["priority", "priority"],
  ["assign", "assignee"],
  ["labels", "labels"],
  ["copy-prompt", "work"],
] as const;
/** The values of each applicable command above, scored with their breadcrumb, at most 10 per command (`hoistValues`). Picking one
 *  writes through the issue's actions, which undo, and closes the palette. */
function hoistedValues(issue: Issue, q: string, applies: (id: string) => boolean): (readonly [number, Cmd])[] {
  const entries = { ...issuePropertyEntries(issue, { close, menu: "command" }), work: workOnIssueEntry(issue, close) };
  return HOISTED.flatMap(([id, key]) => {
    const parent = entries[key];
    if (!applies(id) || !parent.children) return [];
    const { nameAsParent } = parent;
    const values = parent.children.map(
      (child): Cmd => ({
        id: `${id}:${child.name}`,
        name: child.name,
        // Linear's getParentActionLabel: nameAsParent, else the parent's name without its "…".
        parents: [typeof nameAsParent === "function" ? nameAsParent(child) : (nameAsParent ?? parent.name.replaceAll("…", ""))],
        ...hoistedRow(child.name, child.keywords),
        exact: child.exact,
        icon: child.image ?? (child.icon && <Icon name={child.icon} size={16} />),
        checked: child.selected,
        run: () => child.run?.(),
      }),
    );
    return hoistValues(values, q, parent.hoistFrom ?? 2);
  });
}

/** Linear's nested "Open …" command pages (`nameAsParent`, `searchShortcut.keyword` in startup-root.CnUSfl4j.js): their
 *  chord opens the palette on the page, with the parent's name as the input's chip; ⌫ in the empty input leaves it. */
const PAGES = {
  favorites: { parent: "Favorite", label: "Open favorite", keyword: "f" },
  boards: { parent: "Space", label: "Open space", keyword: "t" },
  views: { parent: "View", label: "Open view", keyword: "v" },
  issues: { parent: "Issue", label: "Open issue", keyword: "i" },
  documents: { parent: "Document", label: "Open document", keyword: "d" },
  users: { parent: "User", label: "Open user", keyword: "u" },
  /** Linear's `?` Help action (`mAt`, search input hidden) when the sidebar's Help button isn't there to anchor its menu. */
  help: { parent: "Help", label: "Help", keyword: undefined },
  /** ⌥⇧G and ⌥⇧O: the command menu on the action's sub-actions, its name as the chip (useGroupingMenu `d`, useOrderingMenu `_`). */
  grouping: { parent: GROUPING_ACTION.parent, label: GROUPING_ACTION.name, keyword: undefined },
  ordering: { parent: ORDERING_ACTION.parent, label: ORDERING_ACTION.name, keyword: undefined },
} as const;
export type PalettePage = keyof typeof PAGES;
export const isPalettePage = (overlay: string | null): overlay is PalettePage => !!overlay && overlay in PAGES;
/** The page a root query's `searchShortcut.keyword` and a space ("t ") focuses search on (BJ-64). */
export const keywordPage = (q: string) =>
  (Object.keys(PAGES) as PalettePage[]).find((page) => PAGES[page].keyword && q === `${PAGES[page].keyword} `);
const close = () => ui.send({ type: "overlay.close" });

function openChoice({ destination: to, favorite }: NavigationChoice) {
  close();
  // Linear's Open favorite links carry `favoriteId` like the sidebar row, so the favorite's row lights, not its board.
  if ("view" in to) return openSavedView(to.view, favorite);
  // ⌘K opens a page afresh (Linear's `resetBreadcrumb: true`).
  navigate({ ...to, favorite: favorite ?? null, trail: null });
}
/** The open board's grouping or ordering choices as rows, the current one checked; picking one writes the board's display as the
 *  Display menu's select does, and closes the menu. */
function viewChoiceRows(kind: "grouping" | "ordering", display: Display): Cmd[] {
  const board = get().board;
  const apply = (patch: Partial<Display>) => timed("display", () => setDisplay(board, patch));
  return (kind === "grouping" ? groupingChoices(display, apply) : orderingChoices(display, apply)).map((choice) => ({
    id: `${kind}:${choice.name}`,
    name: choice.name,
    keywords: choice.keywords,
    checked: choice.selected,
    run: () => (close(), choice.run?.()),
  }));
}
/** A page's rows, unfiltered. */
function usePageRows(page: PalettePage): Cmd[] {
  const display = useViewSettings(useStore((s) => s.board)).display;
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
    return [{ name: "Keyboard shortcuts", keys: hotkeyOf("shortcuts"), icon: commandIcon("shortcuts"), run: () => ui.send({ type: "overlay.open", overlay: "shortcuts" }) }];
  if (page === "grouping" || page === "ordering") return viewChoiceRows(page, display);
  const icon = commandIcon(page === "boards" ? "team-open" : page === "views" ? "view-open" : "favorite-open");
  return navigationChoices(page, { boards, savedViews, favorites, issues }).map((choice) => ({
    id: choice.id,
    name: choice.name,
    icon,
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

/** The palette both search and ⌘K use: Linear's command menu (WK in startup-root.CnUSfl4j.js; sizes VK, spelled out in index.css
 *  `.command-menu`) through the same `MenuSurface command` frame and `Menu` compound every issue's command menu uses. Centred,
 *  720px, 110px down, with no backdrop and one frame: the targeted issue's chip as its title, the 46px search, then the groups. */
function PaletteFrame({
  label,
  q,
  setQ,
  title,
  chip,
  placeholder = "Type a command or search…",
  onBackspace,
  footer,
  children,
}: {
  label: string;
  q: string;
  setQ: (q: string) => void;
  /** The issue the commands act on, drawn as the menu's title chip. */
  title?: Issue;
  /** A nested page's parent name, before the search. */
  chip?: ReactNode;
  placeholder?: string;
  /** Runs on Backspace in an empty input. */
  onBackspace?: () => void;
  /** Controls under the results, outside cmdk so their own menus keep their keys. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <MenuSurface label={label} close={close} command width={COMMAND_MENU_WIDTH}>
      <div
        className="command-menu palette"
        // Before cmdk runs the pick: whether it opens a new tab.
        onKeyDownCapture={(e) => {
          if (e.key === "Enter") holdNewTab(e);
        }}
        onClickCapture={holdNewTab}
      >
        {title && <CommandMenuTitle issue={title} />}
        <Menu
          shouldFilter={false}
          width="auto"
          // The highlighted issue (arrow keys or pointer) loads before it is picked.
          onValueChange={(value) => {
            const issue = get().issues.get(value);
            preloadOnHover(issue ? { board: issue.board, selected: issue.key, panel: true } : null);
          }}
        >
          <Menu.Input
            autoFocus
            aria-label={label}
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && onBackspace?.()}
            placeholder={placeholder}
            chip={chip}
          />
          <Menu.List maxHeight={`${PALETTE_LIST_HEIGHT}px`}>
            <Menu.Empty>No results</Menu.Empty>
            {children}
          </Menu.List>
        </Menu>
        {footer && <div className="palette-footer">{footer}</div>}
      </div>
    </MenuSurface>
  );
}
/** Linear's command-menu list height without a peek (vgn in startup-root.CnUSfl4j.js). */
const PALETTE_LIST_HEIGHT = 450;

/** Whether ⌘ (Ctrl off a Mac) was held for the Enter or click that picks a row, read as the pick runs (Linear's `fu.metaKey`). */
let newTab = false;
const holdNewTab = (event: { metaKey: boolean; ctrlKey: boolean }) => void (newTab = opensNewTab(event, isMac()));
const openNewTab = (url: string) => (close(), void window.open(url, "_blank", "noopener"));

/** Opens the issue on its board; ⌘↵ or ⌘-click opens its page in a new tab (Linear's `openPage({ newTab: fu.metaKey })`). */
const openIssue = (i: Issue) =>
  newTab
    ? openNewTab(appURL(i))
    : timed(`open ${i.key}`, () => (close(), navigate({ board: i.board, selected: i.key, panel: true, trail: null }), ui.send({ type: "query.set", query: "" })));

/** An issue row: status, key, title and assignee; picking it opens the issue on its board. */
function IssueRow({ issue: i, onOpen }: { issue: Issue; onOpen?: () => void }) {
  const s = statusOf(i);
  return (
    <Menu.Item
      value={i.key}
      onSelect={() => (onOpen?.(), openIssue(i))}
      icon={s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />}
      hint={<Avatar user={i.assignee} size={18} />}
    >
      <EntityIdentifier className="palette-issue-key">{i.key}</EntityIdentifier>
      {i.summary}
    </Menu.Item>
  );
}

/** An issue only Jira has (a pasted link or typed key off every board): the server's read-only status and title. It opens
 *  on Jira's page, as a smart link to it does. */
function JiraIssueRow({ issueKey, details }: { issueKey: string; details: SmartLinkDetails }) {
  return (
    <Menu.Item
      value={`jira:${issueKey}`}
      onSelect={() => openNewTab(jiraIssueURL(issueKey))}
      icon={details.status ? <StatusIcon status={details.status} /> : <Icon name="link" size={16} />}
    >
      <EntityIdentifier className="palette-issue-key">{issueKey}</EntityIdentifier>
      {details.title}
    </Menu.Item>
  );
}
/** Linear's "No issues found for this link" (`url-no-results`): a link no issue answers; picking it does nothing. */
function MissingIssueRow() {
  return (
    <Menu.Item value="pasted:none" onSelect={() => {}} icon={<Icon name="info" size={16} />}>
      No issues found for this link
    </Menu.Item>
  );
}
/** The store's key for what the query names (a renamed key resolves to the issue's key now), so the search below skips it. */
const pastedKey = (pasted: PastedIssue | undefined) =>
  pasted && pasted.kind !== "elsewhere" ? currentKey(pasted.key) : undefined;
/** The issue a pasted link or typed key names, first (pasted-issue.ts): the store's issue, else the server's read of it. */
function PastedIssueGroup({ pasted }: { pasted: PastedIssue | undefined }) {
  const site = useStore((s) => s.site);
  const key = pastedKey(pasted);
  const issue = useStore((s) => (key ? s.issues.get(key) : undefined));
  const details = useSmartLinkDetails(key && site ? browseURL(site, key) : "", !!key && !!site && !issue);
  const row = pastedRow(pasted, issue, details);
  if (!row) return null;
  return (
    <Menu.Group>
      {row.kind === "app" ? (
        <IssueRow issue={row.issue} />
      ) : row.kind === "jira" ? (
        <JiraIssueRow issueKey={row.key} details={row.details} />
      ) : (
        <MissingIssueRow />
      )}
    </Menu.Group>
  );
}
const pastedIn = (q: string, site: string) => pastedIssue(q, { site, origin: location.origin });

/** The "Issues (n)" group for a typed query; opening one remembers the query as a recent search. */
function IssueResults({ results, q }: { results: Issue[]; q: string }) {
  if (!results.length) return null;
  return (
    <Menu.Group heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}>
      {results.map((i) => <IssueRow key={i.key} issue={i} onOpen={() => recordSearch(q)} />)}
    </Menu.Group>
  );
}

/** The "Documents" group: documents whose title or body matches (every document on the Open document page). */
function DocumentResults({ q }: { q: string }) {
  const issues = useStore((s) => s.issues);
  const results = useMemo(() => matchDocuments(issues, q), [q, issues]);
  if (!results.length) return null;
  return (
    <Menu.Group heading="Documents">
      {results.map((m) => <DocumentRow key={m.resource.id} match={m} q={q} />)}
    </Menu.Group>
  );
}
function DocumentRow({ match: { issue, resource }, q }: { match: DocumentMatch; q: string }) {
  return (
    <Menu.Item
      value={`document:${resource.id}`}
      onSelect={() => {
        recordSearch(q);
        close();
        navigate({ board: issue.board, selected: issue.key, panel: true, document: resource.id });
      }}
      icon={<Icon name="file" size={16} />}
      hint={issue.key}
    >
      {resource.title || "New document"}
    </Menu.Item>
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
  const site = useStore((s) => s.site);
  const issues = useMemo(
    () =>
      filters.length
        ? new Map([...all].filter(([, i]) => matchesSearchFilters(i, filters, (x) => statusOf(x)?.name)))
        : all,
    [all, filters],
  );
  const [recent] = useState(() => {
    const open = get().panel ? get().selected : null;
    return resolveRecents(recentIssues(), (key) => issues.get(currentKey(key)), open, 10);
  });
  const [searches] = useState(recentSearches);
  const searching = !!q.trim() || filters.length > 0;
  const results = useMemo(() => (searching ? matchIssues(issues, q, ordering) : []), [searching, q, issues, ordering]);
  const pasted = pastedIn(q, site);
  const lifted = pastedKey(pasted);
  if (searching)
    return (
      <>
        <PastedIssueGroup pasted={pasted} />
        <IssueResults results={lifted ? results.filter((i) => i.key !== lifted) : results} q={q} />
      </>
    );
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
        <Menu.Group heading="Recent">
          {recent.map((i) => <IssueRow key={i.key} issue={i} />)}
        </Menu.Group>
      )}
      {searches.length > 0 && (
        <Menu.Group heading="Recent searches">
          {searches.map((search) => (
            <Menu.Item key={search} value={`search:${search}`} onSelect={() => setQ(search)} icon={<Icon name="search" size={16} />}>
              {search}
            </Menu.Item>
          ))}
        </Menu.Group>
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
  const [edit, setEdit] = useState<{
    field: SearchFilter["field"];
    segment: "operator" | "value";
    anchor: HTMLElement;
    openedBy: OpenedBy;
  } | null>(null);
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
  const toggle = (field: SearchFilter["field"], value: string) => setFilters((current) => toggleSearchValue(current, field, value));
  const entries: ActionEntry[] = SEARCH_FILTER_FIELDS.map(([field, name]) => ({
    name,
    image: <FilterIcon name={name} />,
    children: choices(field).map(([value, text]) => ({
      name: text,
      selected: !!filters.find((f) => f.field === field)?.values.includes(value),
      run: () => toggle(field, value),
    })),
  }));
  const filterButton = (
    <IconButton label="Filter" variant="muted" size="small" aria-expanded={!!anchor} onClick={(e) => setAnchor(e.currentTarget)}>
      <Icon name="filter" />
    </IconButton>
  );
  const nameOf = (field: SearchFilter["field"]) => SEARCH_FILTER_FIELDS.find(([f]) => f === field)![1];
  const change = (field: SearchFilter["field"], patch: Partial<SearchFilter>) =>
    setFilters((current) => current.map((f) => (f.field === field ? { ...f, ...patch } : f)));
  const editing = edit && filters.find((f) => f.field === edit.field);
  return (
    <>
      {filters.length ? (
        // The board's FilterBar, its blocks and "+" (Linear's searchResult panel); no Clear or Save.
        <FilterBar label="Search filters" className="mx-0 mb-1.5">
          <FilterBar.Blocks>
            {filters.map(({ field, values, op = "is" }) => {
              const name = nameOf(field);
              const open = edit?.field === field ? edit.segment : null;
              const labels = values.map((v) => label(field, v));
              return (
                <FilterBlock key={field} onRemove={() => setFilters((current) => current.filter((f) => f.field !== field))}>
                  <FilterBlock.Field>{name}</FilterBlock.Field>
                  <FilterBlock.Operator
                    label={`${name} operator`}
                    expanded={open === "operator"}
                    onOpen={(anchor, by) => setEdit({ field, segment: "operator", anchor, openedBy: by })}
                  >
                    {equalOperators(values.length).find(([o]) => o === op)![1]}
                  </FilterBlock.Operator>
                  <FilterBlock.Value
                    label={`${name} value`}
                    expanded={open === "value"}
                    title={values.length > 1 ? labels.join(", ") : undefined}
                    onOpen={(anchor, by) => setEdit({ field, segment: "value", anchor, openedBy: by })}
                  >
                    {values.length > 1 ? `${values.length} ${plural(name.toLowerCase())}` : labels[0]}
                  </FilterBlock.Value>
                  <FilterBlock.Remove label={`Remove ${name} filter`} />
                </FilterBlock>
              );
            })}
            <IconButton
              label="Add another filter"
              variant="borderless"
              size="small"
              className="ui-filter-add"
              aria-expanded={!!anchor}
              onClick={(e) => setAnchor(e.currentTarget)}
            >
              <Icon name="plus" />
            </IconButton>
          </FilterBar.Blocks>
        </FilterBar>
      ) : (
        <div className="mb-1.5 flex items-center">{filterButton}</div>
      )}
      {anchor && <ActionMenu label="Filter" anchor={anchor} entries={entries} close={() => setAnchor(null)} />}
      {edit?.segment === "value" && editing && (
        <ActionMenu
          label={nameOf(edit.field)}
          anchor={edit.anchor}
          placeholder={nameOf(edit.field)}
          entries={entries.find((e) => e.name === nameOf(edit.field))?.children ?? []}
          close={() => setEdit(null)}
        />
      )}
      {edit?.segment === "operator" && editing && (
        <MenuSurface label={`${nameOf(edit.field)} operator`} anchor={edit.anchor} fit width={248} close={() => setEdit(null)}>
          <FilterOperatorMenu
            name={nameOf(edit.field)}
            current={editing.op ?? "is"}
            operators={equalOperators(editing.values.length)}
            openedBy={edit.openedBy}
            pick={(op) => {
              change(edit.field, { op });
              setEdit(null);
            }}
          />
        </MenuSurface>
      )}
    </>
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
  const display = useViewSettings(boardId).display;
  const inInbox = useStore((s) => s.inbox);
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
  const viewCommands: Cmd[] = (activeView ? [
    { name: "Edit view…", run: viewAction(() => openViewEditor(editViewDraft(activeView.id))) },
    { name: "Save to…", run: () => { setSavingTo(true); setQ(""); } },
    { name: favorites.includes(`view:${activeView.id}`) ? "Unfavorite view" : "Favorite view", keys: hotkeyOf("view-favorite"), run: viewAction(() => toggleFavorite(`view:${activeView.id}`)) },
    { name: "Make a copy as new view…", run: viewAction(() => openViewEditor(duplicateViewDraft(activeView.id))) },
    { name: "Delete view", run: () => setDeletingView(true) },
  ] : []).map((c) => ({ ...c, keywords: VIEW_COMMAND_KEYWORDS[c.name] }));
  const site = useStore((s) => s.site);
  const pasted = pastedIn(q, site);
  const lifted = pastedKey(pasted);
  const results = useMemo(
    () => (q.trim() ? matchIssues(issues, q).filter((i) => i.key !== lifted) : []),
    [q, issues, lifted],
  );

  const command = (entry: (typeof shortcuts)[number]): Cmd => ({
    name: entry.label?.() ?? entry.name,
    keywords: COMMAND_KEYWORDS[entry.id],
    keys: hotkeyOf(entry.id),
    icon: commandIcon(entry.id, entry.issue ? undefined : paletteGroupOf(entry)),
    run: () => {
      ui.send({ type: "overlay.close" });
      runShortcut(entry.id);
    },
  });
  // Only commands that would do something now, as Linear lists them.
  const issueCmds: Cmd[] = scoped
    ? shortcuts.filter((s) => s.issue && applies(s)).map(command)
    : [];
  // The app's commands under Linear's group for each, with nothing filed twice under one name.
  const byGroup = new Map<PaletteGroup, Cmd[]>();
  const file = (group: PaletteGroup, cmd: Cmd) => byGroup.set(group, [...(byGroup.get(group) ?? []), cmd]);
  for (const [i, s] of shortcuts.entries())
    if (
      !s.issue &&
      applies(s) &&
      s.id !== "commands" &&
      !(activeView && LISTED_BY_VIEW_GROUP.has(s.id)) &&
      shortcuts.findIndex((other) => other.name === s.name) === i
    )
      file(paletteGroupOf(s), command(s));
  for (const b of boards)
    if (b.id !== boardId)
      file("Navigation", {
        name: `Switch to ${b.name}`,
        icon: commandIcon("team-open"),
        run: () => {
          ui.send({ type: "overlay.close" });
          navigate({ board: b.id, selected: null, panel: false });
        },
      });
  file("Views", { name: "Create view…", keywords: VIEW_COMMAND_KEYWORDS["Create view…"], icon: commandIcon("view-create"), run: viewAction(() => openViewEditor(createViewDraft("custom"))) });
  const at = { inbox: inInbox, view: !!activeView };
  // Save to… mirrors the filter row's Save menu, so it is offered even before any temporary filter exists.
  const mergeable = !!activeView && !!filterCount(overlay) && canMergeOverlay(activeView.filters, overlay);
  const listed = savingTo && activeView ? [{ key: "Save to", heading: "Save to", priority: 0, rows: ranked([
    { name: filterCount(overlay) && !mergeable ? "Cannot merge these filters into the view" : "Save to this view", keys: hotkeyOf("view-save"), icon: commandIcon("view-save"), disabled: !mergeable, run: viewAction(() => { void saveOverlayToView().catch(e => set({ perf: String(e) })); }) },
    { name: "Create new view…", keys: hotkeyOf("view-create"), icon: commandIcon("view-create"), run: viewAction(createToolbarView) },
  ], q) }] : [
    // The targeted issue's group is headless: Linear promotes its name to the menu's title (`promoteToTitle`).
    // Hoisted values join the targeted issue's group (Linear's groupWhenLifted), ranked with its commands.
    {
      key: "target",
      heading: undefined,
      priority: TARGET_PRIORITY,
      rows: [...ranked(issueCmds, q), ...(scoped ? hoistedValues(scoped, q, (id) => applyingIds.has(id)) : [])].sort(
        ([a], [b]) => b - a,
      ),
    },
    { key: "view", heading: `View · ${activeView?.name ?? ""}`, priority: VIEW_PRIORITY, rows: ranked(viewCommands, q) },
    ...[...byGroup].map(([group, cmds]) => ({
      key: group,
      heading: group,
      priority: groupPriority(group, at),
      rows:
        group === "Display options"
          ? [
              ...ranked(cmds, q),
              ...hoistedViewChoices(
                { grouping: viewChoiceRows("grouping", display), ordering: viewChoiceRows("ordering", display) },
                q,
                (id) => applyingIds.has(id),
              ),
            ].sort(([a], [b]) => b - a)
          : ranked(cmds, q),
    })),
  ];
  const groups = orderGroups(
    // The group of the best-scoring row first (orderGroups ranks lower first).
    listed.filter((g) => g.rows.length).map((g) => ({ ...g, rank: -g.rows[0]![0] })),
    !!q.trim(),
  );

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
      title={scoped}
      onBackspace={() => (savingTo ? setSavingTo(false) : setScopeKey(null))}
    >
      <PastedIssueGroup pasted={pasted} />
      {groups.map((g) => (
        <Menu.Group key={g.key} heading={g.heading}>
          {g.rows.map(([, c]) => <CommandRow key={c.id ?? c.name} cmd={c} />)}
        </Menu.Group>
      ))}
      <IssueResults results={results} q={q} />
      {q.trim() && <DocumentResults q={q} />}
    </PaletteFrame>
  );
}
