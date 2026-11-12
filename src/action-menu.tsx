import { FloatingTree } from "@floating-ui/react";
import { useRef, useState, type RefObject } from "react";
import { Icon, type IconName } from "./icons";
import { Menu } from "./menu";
import { Keycap } from "./keycap";
import { MenuSurface, MENU_POPUP } from "./menu-surface";

/** `divider` starts a new group, drawn as a separator above the entry while the menu is unfiltered. */
export type ActionEntry = {
  name: string;
  run?: () => void;
  children?: ActionEntry[];
  shortcut?: string;
  selected?: boolean;
  icon?: IconName;
  divider?: boolean;
};
type Container = RefObject<HTMLDivElement | null>;
function searchActions(entries: ActionEntry[], query: string, prefix = ""): ActionEntry[] {
  return entries.flatMap((entry) => {
    const name = prefix + entry.name;
    if (entry.children) return searchActions(entry.children, query, name + " › ");
    return name.toLowerCase().includes(query.toLowerCase()) ? [{ ...entry, name }] : [];
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
}: {
  anchor?: HTMLElement | null;
  entries: ActionEntry[];
  label: string;
  close: () => void;
  align?: "end";
  point?: { x: number; y: number };
  /** Open with the first row highlighted, as Linear's filter menu does, instead of its row menus' none. */
  highlight?: boolean;
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
}: {
  entries: ActionEntry[];
  label: string;
  container: Container;
  close: () => void;
  nested?: boolean;
  highlight?: boolean;
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
      onValueChange={(value) => setOpen((current) => (value === current ? current : null))}
    >
      {/* Linear keeps the filter focused but shows it only once typing starts. */}
      <Menu.Input
        hideWhenEmpty
        autoFocus={!nested}
        aria-label={`Find ${label.toLowerCase()}`}
        placeholder="Filter…"
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
              icon={entry.icon && <Icon name={entry.icon} size={16} />}
              hint={entry.shortcut && <ActionHint hint={entry.shortcut} />}
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
              icon={entry.icon && <Icon name={entry.icon} size={16} />}
              checked={entry.selected}
              hint={entry.shortcut && <ActionHint hint={entry.shortcut} />}
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

/** The legacy shortcut slot also carries dates and counts; only keyboard hints get caps. */
function ActionHint({ hint }: { hint: string }) {
  const chords = hint.split(/ (?:then|or) /);
  const keyboard = chords.every((chord) =>
    /^(?:(?:Ctrl|Control|Alt|Shift|Meta|⌘|⌥|⇧|⌃)[+ ]*)*(?:[A-Z0-9]|[^\w\s]|Esc|Enter|Tab|Space|Backspace|Delete)$/.test(chord),
  );
  return keyboard ? <Keycap size="small" type="borderless">{hint}</Keycap> : hint;
}
