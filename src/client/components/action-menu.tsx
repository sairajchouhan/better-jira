import { memo, use, useState, type ComponentProps, type ReactNode } from "react";
import { actionScore, HOISTED_PER_PARENT, hoistedRow, menuFilter, MIN_APPLICABILITY } from "@/client/lib/fuzzy-score";
import { Icon, type IconName } from "./icons";
import type { Keys } from "./keycap";
import { Menu } from "./menu";
import { MenuSurface, MenuSurfaceContext, MENU_POPUP, useElevation } from "./menu-surface";
import { NoMatchesFooter, splitByMatches } from "./no-matches";
import { useOpenActionMenu } from "./open-action-menus";

/** One action row (Linear's action). `divider` starts a new group, drawn as a separator above the entry while the menu is unfiltered. */
export type ActionEntry = {
  name: string;
  /** Filter applicability count; zero-match choices are revealed by the footer. */
  matchCount?: number;
  run?: () => void;
  children?: ActionEntry[];
  /** Draws the submenu's rows from its search instead of `children` (Linear's recalculateOnInput: a typed date, label checkboxes
   *  with "Create new label"); `children`, when given too, then only feed the root search. Menu ranks what it draws. */
  rows?: (query: string) => ReactNode;
  /** The submenu's search placeholder (Linear's subActionPlaceholder); "Filter…" by default. */
  placeholder?: string;
  /** "hidden": the submenu keeps its search out of sight until typing starts, as a root menu does (Linear's searchInput hidden). */
  search?: "hidden";
  /** How many typed characters list this entry's children in its menu's search (Linear's subActionsHoisting.minInputLength):
   *  2 by default, Infinity never. */
  hoistFrom?: number;
  /** In a root search, the children are listed only when the query holds one of these words (Linear's whenMatchKeywords). */
  hoistWhen?: readonly string[];
  /** The breadcrumb a listed child gets ("Set priority to › High"); the entry's name by default (Linear's nameAsParent). */
  nameAsParent?: string | ((child: ActionEntry) => string);
  /** A multi-select row (Linear's multiSelectSubActions) with its leading checkbox in this state: the checkbox runs `run` and
   *  keeps the menu open; the row runs it and closes. */
  checkbox?: boolean;
  /** The digit key that picks the row while the search is empty, drawn as its hint (Linear's picker numbers). */
  number?: number;
  /** A registry chord or sequence, drawn as caps; `hint` is any other trailing text (a date, a count). */
  shortcut?: Keys;
  hint?: string;
  selected?: boolean;
  icon?: IconName;
  /** A drawn icon in place of `icon` (Linear's action `image`): a status, priority or avatar. */
  image?: ReactNode;
  divider?: boolean;
  /** Listed but greyed out and inert, with this reason as its tooltip (Linear's disabledReason, shown as the row's hintText). */
  disabledReason?: string;
  /** Other words a filter finds the entry by (a language's aliases), or `rowKeywords` (a status's workflow place). */
  keywords?: string[];
  /** Linear's keywordsExactMatch: a query equal to one of these is an exact hit ("me" on your own assignee row). */
  exact?: string[];
};
type Ranked = { entry: ActionEntry; score: number };

const HOIST_FROM = 2;
/** A menu's own row, scored as Linear's `Yn.scoreAction` (menuFilter); `exact` is Linear's keywordsExactMatch. */
const score = (entry: ActionEntry, query: string) =>
  entry.exact?.includes(query.trim().toLowerCase())
    ? 1
    : menuFilter(entry.name, query, entry.keywords && [entry.name, ...entry.keywords]);
/** Linear's `shouldHoistSubActions`: a parent lists its children once the query has `hoistFrom` characters; in a root menu one with
 *  `hoistWhen` (Linear's whenMatchKeywords) only when the query holds one of those words too. */
const hoists = ({ hoistFrom = HOIST_FROM, hoistWhen }: ActionEntry, query: string, root: boolean) =>
  !(root && hoistWhen && !hoistWhen.some((word) => query.toLowerCase().includes(word))) && query.length >= hoistFrom;
/** A child hoisted under `path`, scored as Linear's hoisted action (actionScore with its breadcrumb, 0.15 lower; a status in
 *  workflow order, a person by `mH`): the one scorer for every menu's root search and ⌘K's. 0 under 0.24. */
const hoistedScore = (child: ActionEntry, query: string, path: string[]) => {
  const score = actionScore({ name: child.name, ...hoistedRow(child.name, child.keywords), exact: child.exact, parents: path }, query);
  return score >= MIN_APPLICABILITY ? score : 0;
};
/** One hoisted value: the child, the breadcrumb it is listed under ("Change priority to") and its score. */
export type Hoisted = { child: ActionEntry; path: string[]; score: number };
/**
 * The values `parent` lists in a search, its children's children included ("Remove › Blocking issue …"), each named by its
 * breadcrumb and scored as Linear's hoisted action, in the parent's order. In a root menu (a right-click menu's first level, ⌘K) at
 * most `HOISTED_PER_PARENT` of them (Linear's limitSubActionsInRootMenu). Right-click menus and ⌘K both list their values from here.
 */
export function hoistedChildren(parent: ActionEntry, query: string, { root }: { root: boolean }, parents: string[] = []): Hoisted[] {
  if (!parent.children || !hoists(parent, query, root)) return [];
  const hits = parent.children.flatMap((child) => {
    const { nameAsParent = parent.name.replaceAll("…", "") } = parent;
    const path = [...parents, typeof nameAsParent === "function" ? nameAsParent(child) : nameAsParent];
    return [{ child, path, score: hoistedScore(child, query, path) }, ...hoistedChildren(child, query, { root }, path)];
  }).filter((hit) => hit.score > 0);
  return root && !parents.length ? hits.slice(0, HOISTED_PER_PARENT) : hits;
}
/** Linear's root search: the menu's own rows (a submenu row included) and the children they hoist, ranked by score together; at
 *  equal scores a menu's own row comes first. `root: false` in a submenu. */
export function searchActions(entries: ActionEntry[], query: string, { root = true }: { root?: boolean } = {}): ActionEntry[] {
  return [
    ...entries.map((entry) => ({ entry, score: score(entry, query) })),
    ...entries.flatMap((entry) =>
      hoistedChildren(entry, query, { root }).map(
        ({ child, path, score }): Ranked => ({ entry: { ...child, name: [...path, child.name].join(" › ") }, score }),
      ),
    ),
  ]
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry);
}

/** The names of the rows a menu level lists, given the ones it listed so far (`opened`): the same set while any of them is still
 *  among `entries`, so a row added beside them stays out; the new rows' names once none is left, so a menu opened on "Loading…"
 *  takes the rows that land (BJ-393). No rows keeps the old set. */
export function keptRows(opened: ReadonlySet<string>, entries: readonly ActionEntry[]): ReadonlySet<string> {
  if (!entries.length || entries.some((e) => opened.has(e.name))) return opened;
  return new Set(entries.map((e) => e.name));
}

/** Linear's `Yn.joinActionGroupsWithDividers`: each non-empty group after the first starts with a divider. */
export function joinGroups(...groups: ActionEntry[][]): ActionEntry[] {
  return groups
    .filter((group) => group.length)
    .flatMap((group, g) => group.map((entry, i) => (i === 0 ? { ...entry, divider: g > 0 } : entry)));
}

/** Linear opens an action menu 4px under its trigger, left-aligned (Issue options) or, with `align="end"`, right-aligned (row, resource
 *  and comment ⋯); a right-click opens it at `point`. Opened by a key it highlights its first row; by the pointer, none. While it is
 *  open no global shortcut runs, even with focus outside it (Linear's isActionMenuOpen): its rows' hints are not live keys. */
export function ActionMenu({
  anchor,
  entries,
  label,
  close,
  align,
  point,
  highlight,
  placeholder,
}: {
  anchor?: HTMLElement | null;
  entries: ActionEntry[];
  label: string;
  close: () => void;
  align?: "end";
  point?: { x: number; y: number };
  /** "first": open with the first row highlighted whatever opened it (Linear's select-like menus); by default a key highlights it
   *  and the pointer doesn't. */
  highlight?: "first";
  /** Shows the root search from the start with this placeholder, as Linear's filter menus do ("Add Filter…"); without it the
   *  search stays hidden until typing starts. */
  placeholder?: string;
}) {
  useOpenActionMenu(close);
  return (
    <MenuSurface
      label={label}
      anchor={anchor ?? undefined}
      close={close}
      fit
      gap={4}
      rounding="pixel"
      align={align}
      point={point}
    >
      <Level entries={entries} label={label} placeholder={placeholder} highlight={highlight} />
    </MenuSurface>
  );
}

/** One menu level. The root keeps its search hidden until typing unless it has a `placeholder`; a submenu always shows its own
 *  (Linear's searchInput always-show). Opened by a key, a submenu highlights its current value. */
function Level({
  entries,
  rows,
  label,
  nested = false,
  placeholder,
  search,
  highlight,
}: {
  entries: ActionEntry[];
  rows?: (query: string) => ReactNode;
  label: string;
  nested?: boolean;
  placeholder?: string;
  search?: "hidden";
  highlight?: "first";
}) {
  const elevation = useElevation();
  const [reveal, setReveal] = useState(false);
  const [query, setQuery] = useState("");
  // Linear lists a menu's actions as it opens. A row that appears while it is open (an edit adding "Restore mirrored Jira version")
  // would widen the menu under the pointer and hand the hover to another row, so it keeps the rows it opened with, each still live;
  // rows that replace every one it opened with (a list that was loading has landed) are taken (keptRows).
  const [opened, setOpened] = useState(() => keptRows(new Set(), entries));
  const kept = keptRows(opened, entries);
  if (kept !== opened) setOpened(kept);
  const available = entries.filter((e) => kept.has(e.name));
  const { matched: own, unmatched: hidden } = splitByMatches(
    available,
    (e) => e.matchCount,
    (e) => !!e.checkbox || !!e.selected,
  );
  const q = query.trim();
  // Revealed, the options with no matches follow a divider with the menu's name as its search placeholder (Linear's
  // subActionPlaceholder); a search looks through every option.
  const choices = rows || !q ? own : searchActions(reveal ? available : own, q, { root: !nested });
  return (
    <Menu
      search={query}
      onSearchChange={setQuery}
      // Drawn from the search, a submenu's rows are ranked by Menu; the entries are ranked by searchActions, hoisting included.
      filter={rows ? menuFilter : "none"}
      // Opened by a key it highlights its first row; by the pointer, none (Linear's keyboardInvoked).
      start={highlight ? "first" : "opener"}
      // Opened by a key, a submenu starts on its current value (Linear's focusedIndex); a multi-select one on its first row.
      defaultValue={nested ? own.find((e) => e.selected)?.name : undefined}
      {...(nested ? elevation.props : {})}
      className={nested ? `${MENU_POPUP} w-max min-w-[175px] max-w-[min(500px,calc(100vw-24px))]` : ""}
    >
      <Menu.Input
        hideWhenEmpty={(!nested && !placeholder) || search === "hidden"}
        autoFocus={!nested}
        aria-label={`Find ${label.toLowerCase()}`}
        placeholder={reveal && hidden.length ? label : (placeholder ?? "Filter…")}
      />
      {/* No height cap of its own: the surface stops 10px inside the window and scrolls (Linear's VIEWPORT_PADDING). */}
      <Menu.List>
        <Menu.Empty>No matching actions</Menu.Empty>
        {rows
          ? rows(q)
          : choices.map((entry) => [
              !q && entry.divider && <Menu.Divider key={`-${entry.name}`} />,
              <Row key={entry.name} entry={entry} />,
            ])}
        {hidden.length > 0 && !reveal && (
          <NoMatchesFooter count={hidden.length} onReveal={() => setReveal(true)} />
        )}
        {hidden.length > 0 && reveal && !q && [
          <Menu.Divider key="-no-matches" />,
          ...hidden.map((entry) => (
            <Row key={entry.name} entry={entry} />
          )),
        ]}
      </Menu.List>
    </Menu>
  );
}

/** Memoised: the level re-renders on every keystroke in its search, which re-renders a row only when its entry changes. Its
 *  submenu's open state lives in React Aria's menu (Menu.Submenu), so no row is told it. */
export const Row = memo(function Row({ entry }: { entry: ActionEntry }) {
  const surface = use(MenuSurfaceContext);
  const icon = entry.image ?? (entry.icon && <Icon name={entry.icon} size={16} />);
  const hint = entry.hint ?? entry.number;
  if (entry.children || entry.rows)
    return (
      <Menu.Submenu
        value={entry.name}
        label={<ActionLabel name={entry.name} />}
        icon={icon}
        shortcut={entry.shortcut}
        hint={hint}
      >
        <Level
          nested
          entries={entry.children ?? []}
          rows={entry.rows}
          label={entry.name}
          placeholder={entry.placeholder}
          search={entry.search}
        />
      </Menu.Submenu>
    );
  if (entry.checkbox !== undefined)
    return (
      <CheckRow
        value={entry.name}
        checked={entry.checkbox}
        icon={icon}
        hint={hint}
        onToggle={() => entry.run?.()}
        data-number={entry.number}
      >
        <ActionLabel name={entry.name} />
      </CheckRow>
    );
  return (
    <Menu.Item
      value={entry.name}
      disabled={!!entry.disabledReason}
      title={entry.disabledReason}
      icon={icon}
      checked={entry.selected}
      shortcut={entry.shortcut}
      hint={hint}
      data-number={entry.number}
      onSelect={() => {
        surface?.close();
        entry.run?.();
      }}
    >
      <ActionLabel name={entry.name} />
    </Menu.Item>
  );
});

/**
 * Linear's multi-select row (B4e with onCheckboxClick): a leading checkbox whose click toggles and keeps the menu open (preventClose),
 * while a click or Enter on the row toggles and closes it; Space and Shift+Enter toggle in place (Menu). The one checkbox row for
 * every multi-select menu: labels in Issue options and the L picker, and the inbox filter's values.
 */
export function CheckRow({
  checked,
  onToggle,
  checkboxLabel,
  children,
  ...props
}: Omit<ComponentProps<typeof Menu.Item>, "checkbox" | "onCheckboxClick" | "onSelect" | "checked"> & {
  checked: boolean;
  onToggle: () => void;
}) {
  const surface = use(MenuSurfaceContext);
  return (
    <Menu.Item
      {...props}
      checkbox={checked}
      checkboxLabel={checkboxLabel ?? `${checked ? "Remove" : "Add"} ${props.value}`}
      onCheckboxClick={onToggle}
      onSelect={() => {
        onToggle();
        surface?.close();
      }}
    >
      {children}
    </Menu.Item>
  );
}

/** A right-click on `children` opens an ActionMenu at the pointer, as Linear's row menus do; `entries` is read as it opens. While it is
 *  open the row keeps its hover background (`data-menu-open`, index.css), as Linear's does. Not React Aria's MenuTrigger
 *  `trigger="contextMenu"`: that one needs a pressable trigger element (these rows are `display: contents` around links and cards)
 *  and places its popover by React Aria's rules, where Linear's opens 4px right of and 1px above the press, clamped 10px inside the
 *  window (MenuSurface's `point`). */
export function ContextMenu({
  label,
  entries,
  children,
}: {
  label: string;
  /** Read on every render while open: rows that replace a placeholder ("Loading…") are taken (keptRows). */
  entries: () => ActionEntry[];
  children: ReactNode;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="contents"
      data-menu-open={point ? "" : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setPoint({ x: event.clientX, y: event.clientY });
      }}
    >
      {children}
      {point && <ActionMenu label={label} point={point} entries={entries()} close={() => setPoint(null)} />}
    </div>
  );
}
/** Listed descendants read "Parent › Child": the path dimmed with a chevron between parts, as in Linear (M4e's labelMuted breadcrumbs). */
export function ActionLabel({ name }: { name: string }) {
  const path = name.split(" › "),
    last = path.pop();
  return (
    <>
      {path.map((part) => (
        <span key={part} className="mr-1 inline-flex items-center gap-1 text-[var(--menu-fg-3)]">
          {part}
          <Icon name="chevron" size={12} />
        </span>
      ))}
      {last}
    </>
  );
}
