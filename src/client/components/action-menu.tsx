import { FloatingTree } from "@floating-ui/react";
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./icons";
import type { Keys } from "./keycap";
import { Menu } from "./menu";
import { MenuSurface, MENU_POPUP } from "./menu-surface";

/** `divider` starts a new group, drawn as a separator above the entry while the menu is unfiltered. */
export type ActionEntry = {
  name: string;
  run?: () => void;
  children?: ActionEntry[];
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
function searchActions(entries: ActionEntry[], query: string, prefix = ""): ActionEntry[] {
  return entries.flatMap((entry) => {
    const name = prefix + entry.name;
    if (entry.children) return searchActions(entry.children, query, name + " › ");
    const q = query.toLowerCase();
    return name.toLowerCase().includes(q) || entry.keywords?.some((k) => k.toLowerCase().includes(q))
      ? [{ ...entry, name }]
      : [];
  });
}
/** Linear opens an action menu 4px under its trigger, left-aligned (Issue options) or, with `align="end"`, right-aligned (row, resource and comment ⋯); a right-click opens it at `point`. */
export function ActionMenu({
  anchor,
  entries,
  label,
  close,
  align,
  point,
  highlight = false,
  placeholder,
}: {
  anchor?: HTMLElement | null;
  entries: ActionEntry[];
  label: string;
  close: () => void;
  align?: "end";
  point?: { x: number; y: number };
  /** Open with the first row highlighted, as Linear's filter menu does, instead of its row menus' none. */
  highlight?: boolean;
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
            close={close}
            highlight={highlight}
            placeholder={placeholder}
          />
        </FloatingTree>
      </div>
    </MenuSurface>
  );
}
function Level({
  entries,
  label,
  container,
  close,
  nested = false,
  highlight = false,
  placeholder,
}: {
  entries: ActionEntry[];
  label: string;
  container: Container;
  close: () => void;
  nested?: boolean;
  highlight?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState<string | null>(null);
  // Linear (RAJ-52 issue, comment and sub-issue row menus) opens with no row highlighted: Enter does nothing, ArrowDown highlights the first row, ArrowUp the last.
  // cmdk always selects its first row, so until a key, a filter or the pointer moves, that selection is hidden and inert.
  const [pristine, setPristine] = useState(!nested && !highlight);
  const choices = query.trim() ? searchActions(entries, query.trim()) : entries;
  return (
    <Menu
      shouldFilter={false}
      className={nested ? `${MENU_POPUP} w-max min-w-[175px] max-w-[min(500px,calc(100vw-24px))]` : ""}
      data-pristine={pristine || undefined}
      onPointerMove={() => setPristine(false)}
      onKeyDown={(event) => {
        if (!pristine) return;
        if (event.key === "ArrowDown" || event.key === "Enter") event.preventDefault();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") setPristine(false);
      }}
    >
      {/* Linear keeps the filter focused but shows it only once typing starts. */}
      <Menu.Input
        hideWhenEmpty={!placeholder}
        autoFocus={!nested}
        aria-label={`Find ${label.toLowerCase()}`}
        placeholder={placeholder ?? "Filter…"}
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setOpen(null);
          setPristine(false);
        }}
      />
      <Menu.List maxHeight="60vh">
        <Menu.Empty>No actions found</Menu.Empty>
        {choices.map((entry) => [
          !query && entry.divider && <Menu.Divider key={`-${entry.name}`} />,
          entry.children ? (
            <Menu.Submenu
              key={entry.name}
              value={entry.name}
              label={<Label name={entry.name} />}
              icon={entry.image ?? (entry.icon && <Icon name={entry.icon} size={16} />)}
              shortcut={entry.shortcut}
              hint={entry.hint}
              open={open === entry.name}
              onOpenChange={(next) =>
                setOpen((cur) => (next ? entry.name : cur === entry.name ? null : cur))
              }
              container={container}
            >
              <Level
                nested
                entries={entry.children}
                label={entry.name}
                container={container}
                close={close}
              />
            </Menu.Submenu>
          ) : (
            <Menu.Item
              key={entry.name}
              value={entry.name}
              icon={entry.image ?? (entry.icon && <Icon name={entry.icon} size={16} />)}
              checked={entry.selected}
              shortcut={entry.shortcut}
              hint={entry.hint}
              onSelect={() => {
                close();
                entry.run?.();
              }}
            >
              <Label name={entry.name} />
            </Menu.Item>
          ),
        ])}
      </Menu.List>
    </Menu>
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
      {point && (
        <ActionMenu label={label} point={point} entries={entries()} close={() => setPoint(null)} />
      )}
    </div>
  );
}
/** Searched descendants read "Parent › Child", with the path dimmed as in Linear (M4e's labelMuted breadcrumbs). */
function Label({ name }: { name: string }) {
  const path = name.split(" › "),
    last = path.pop();
  return (
    <>
      {path.map((part) => (
        <span key={part} className="mr-2 text-[var(--menu-fg-3)]">
          {part} ›
        </span>
      ))}
      {last}
    </>
  );
}
