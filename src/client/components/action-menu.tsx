import { FloatingTree } from "@floating-ui/react";
import { use, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { menuFilter } from "@/client/lib/fuzzy-score";
import { Icon, type IconName } from "./icons";
import type { Keys } from "./keycap";
import { Menu } from "./menu";
import { usePristine } from "./menu-pristine";
import { MenuSurface, MenuSurfaceContext, MENU_POPUP } from "./menu-surface";

/** One action row (Linear's action). `divider` starts a new group, drawn as a separator above the entry while the menu is unfiltered. */
export type ActionEntry = {
  name: string;
  /** Filter applicability count; zero-match choices are revealed by the footer. */
  matchCount?: number;
  run?: () => void;
  children?: ActionEntry[];
  /** Draws the submenu's rows from its search instead of `children` (Linear's recalculateOnInput: a typed date, label checkboxes
   *  with "Create new label"); `children`, when given too, then only feed the root search. cmdk filters what it draws. */
  rows?: (query: string) => ReactNode;
  /** The submenu's search placeholder (Linear's subActionPlaceholder); "Filter…" by default. */
  placeholder?: string;
  /** How many typed characters list this entry's children in its menu's search (Linear's subActionsHoisting.minInputLength):
   *  2 by default, Infinity never. */
  hoistFrom?: number;
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
  /** Other words a filter finds the entry by (a language's aliases). */
  keywords?: string[];
};
type Container = RefObject<HTMLDivElement | null>;
type Ranked = { entry: ActionEntry; score: number };

const HOIST_FROM = 2,
  // Linear's DEFAULT_MIN_APPLICABILITY_SCORE, and what a weaker hit that its parent labels contain scores instead.
  MIN_SCORE = 0.24,
  PARENT_HIT = MIN_SCORE + 0.05;
const score = (entry: ActionEntry, query: string) =>
  menuFilter(entry.name, query, entry.keywords && [entry.name, ...entry.keywords]);
/** Children listed under `parent` once the query is long enough, named by their breadcrumb and scored by their own name; a weak
 *  match that the breadcrumb contains ("remove" → "Remove › Blocking issue …") scores PARENT_HIT (Linear's secondaryString). */
function hoisted(parent: ActionEntry, query: string, prefix = ""): Ranked[] {
  if (!parent.children || query.length < (parent.hoistFrom ?? HOIST_FROM)) return [];
  return parent.children.flatMap((child) => {
    const { nameAsParent = parent.name } = parent;
    const path = `${prefix}${typeof nameAsParent === "function" ? nameAsParent(child) : nameAsParent} › `;
    const own = score(child, query),
      inPath = query.length > 2 && path.toLowerCase().includes(query.toLowerCase());
    return [
      { entry: { ...child, name: path + child.name }, score: own < MIN_SCORE && inPath ? PARENT_HIT : own },
      ...hoisted(child, query, path),
    ];
  });
}
/** Linear's root search: the menu's own rows (a submenu row included) and the children they hoist, ranked by score together; at
 *  equal scores a menu's own row comes first. */
export function searchActions(entries: ActionEntry[], query: string): ActionEntry[] {
  return [
    ...entries.map((entry) => ({ entry, score: score(entry, query) })),
    ...entries.flatMap((entry) => hoisted(entry, query)),
  ]
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry);
}

/** Linear opens an action menu 4px under its trigger, left-aligned (Issue options) or, with `align="end"`, right-aligned (row, resource
 *  and comment ⋯); a right-click opens it at `point`. Opened by a key it highlights its first row; by the pointer, none. */
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
  const container = useRef<HTMLDivElement>(null);
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
      <div ref={container}>
        <FloatingTree>
          <Level
            entries={entries}
            label={label}
            container={container}
            placeholder={placeholder}
            highlight={highlight}
          />
        </FloatingTree>
      </div>
    </MenuSurface>
  );
}

/** One menu level. The root keeps its search hidden until typing unless it has a `placeholder`; a submenu always shows its own
 *  (Linear's searchInput always-show). Opened by a key, a submenu highlights its current value. */
function Level({
  entries,
  rows,
  label,
  container,
  nested = false,
  placeholder,
  highlight,
}: {
  entries: ActionEntry[];
  rows?: (query: string) => ReactNode;
  label: string;
  container: Container;
  nested?: boolean;
  placeholder?: string;
  highlight?: "first";
}) {
  const [reveal, setReveal] = useState(false);
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState<string | null>(null);
  const start = usePristine(highlight ? false : undefined);
  // Linear lists a menu's actions as it opens. A row that appears while it is open (an edit adding "Restore mirrored Jira version")
  // would widen the menu under the pointer and hand the hover to another row, so it keeps the rows it opened with, each still live.
  const [opened] = useState(() => new Set(entries.map((e) => e.name)));
  const available = entries.filter((e) => opened.has(e.name));
  const hidden = available.filter((e) => e.matchCount === 0 && !e.checkbox);
  const own = reveal ? available : available.filter((e) => !hidden.includes(e));
  const q = query.trim();
  const choices = rows || !q ? own : searchActions(own, q);
  return (
    <Menu
      shouldFilter={!!rows}
      filter={menuFilter}
      // Opened by a key, a submenu starts on its current value (Linear's focusedIndex); a multi-select one on its first row.
      defaultValue={nested ? own.find((e) => e.selected)?.name : undefined}
      className={nested ? `${MENU_POPUP} w-max min-w-[175px] max-w-[min(500px,calc(100vw-24px))]` : ""}
      {...start.props}
    >
      <Menu.Input
        hideWhenEmpty={!nested && !placeholder}
        autoFocus={!nested}
        aria-label={`Find ${label.toLowerCase()}`}
        placeholder={placeholder ?? "Filter…"}
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setOpen(null);
          start.wake();
        }}
      />
      {/* No height cap of its own: the surface stops 10px inside the window and scrolls (Linear's VIEWPORT_PADDING). */}
      <Menu.List>
        <Menu.Empty>No matching actions</Menu.Empty>
        {rows
          ? rows(q)
          : choices.map((entry) => [
              !q && entry.divider && <Menu.Divider key={`-${entry.name}`} />,
              <Row key={entry.name} entry={entry} container={container} open={open} setOpen={setOpen} />,
            ])}
        {!reveal && hidden.length > 0 ? <>
          <Menu.Divider />
          <Menu.Item value={`Show ${hidden.length} option${hidden.length === 1 ? "" : "s"} with no matches`} onSelect={() => { setReveal(true); start.wake(); }}>
            Show {hidden.length} option{hidden.length === 1 ? "" : "s"} with no matches
          </Menu.Item>
        </> : null}
      </Menu.List>
    </Menu>
  );
}

function Row({
  entry,
  container,
  open,
  setOpen,
}: {
  entry: ActionEntry;
  container: Container;
  open: string | null;
  setOpen: (update: (current: string | null) => string | null) => void;
}) {
  const surface = use(MenuSurfaceContext);
  const icon = entry.image ?? (entry.icon && <Icon name={entry.icon} size={16} />);
  const hint = entry.hint ?? entry.number;
  if (entry.children || entry.rows)
    return (
      <Menu.Submenu
        value={entry.name}
        label={<Label name={entry.name} />}
        icon={icon}
        shortcut={entry.shortcut}
        hint={hint}
        open={open === entry.name}
        onOpenChange={(next) => setOpen((cur) => (next ? entry.name : cur === entry.name ? null : cur))}
        container={container}
      >
        <Level
          nested
          entries={entry.children ?? []}
          rows={entry.rows}
          label={entry.name}
          placeholder={entry.placeholder}
          container={container}
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
        <Label name={entry.name} />
      </CheckRow>
    );
  return (
    <Menu.Item
      value={entry.name}
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
      <Label name={entry.name} />
    </Menu.Item>
  );
}

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
 *  open the row keeps its hover background (`data-menu-open`, index.css), as Linear's does. */
export function ContextMenu({
  label,
  entries,
  children,
}: {
  label: string;
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
function Label({ name }: { name: string }) {
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
