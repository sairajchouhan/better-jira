import {
  autoUpdate,
  flip,
  FloatingNode,
  FloatingTree,
  offset,
  safePolygon,
  shift,
  useFloating,
  useFloatingNodeId,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./icons";
import { MenuSurface, MENU_INPUT, MENU_ITEM, MENU_POPUP } from "./menu-surface";

/** `divider` starts a new group, drawn as a separator above the entry while the menu is unfiltered. */
export type ActionEntry = {
  name: string;
  run?: () => void;
  children?: ActionEntry[];
  shortcut?: string;
  danger?: boolean;
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
    [open, setOpen] = useState<string | null>(null),
    command = useRef<HTMLDivElement>(null);
  // Linear (RAJ-52 issue, comment and sub-issue row menus) opens with no row highlighted: Enter does nothing, ArrowDown highlights the first row, ArrowUp the last.
  // cmdk always selects its first row, so until a key, a filter or the pointer moves, that selection is hidden and inert.
  const [pristine, setPristine] = useState(!nested && !highlight);
  const choices = query.trim() ? searchActions(entries, query.trim()) : entries;
  useHotkey(
    "ArrowRight",
    () =>
      !command.current?.hasAttribute("data-pristine") &&
      command.current
        ?.querySelector<HTMLElement>("[cmdk-item][data-selected=true][aria-haspopup]")
        ?.click(),
    { target: command, capture: true, ignoreInputs: false },
  );
  return (
    <Command
      ref={command}
      loop
      shouldFilter={false}
      className={
        nested ? `${MENU_POPUP} w-max min-w-[174px] max-w-[min(520px,calc(100vw-24px))]` : ""
      }
      data-pristine={pristine || undefined}
      onPointerMove={() => setPristine(false)}
      onKeyDown={(event) => {
        if (!pristine) return;
        if (event.key === "ArrowDown" || event.key === "Enter") event.preventDefault();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") setPristine(false);
      }}
      onValueChange={(value) => setOpen((current) => (value === current ? current : null))}
    >
      <Command.Input
        autoFocus={!nested}
        aria-label={`Find ${label.toLowerCase()}`}
        placeholder="Filter…"
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setOpen(null);
          setPristine(false);
        }}
        className={query ? MENU_INPUT : "sr-only"}
      />
      {/* Linear keeps the filter focused but shows it only once typing starts. */}
      {/* Linear (RAJ-52 resource menu): 6px above and below the rows, and 12px separators with a centred 1px line in the menu border colour. */}
      <Command.List className="max-h-[60vh] overflow-y-auto px-1 py-1.5">
        <Command.Empty>No actions found</Command.Empty>
        {choices.map((entry) => [
          !query && entry.divider && (
            <Command.Separator
              key={`-${entry.name}`}
              className="-mx-1 my-[5.5px] h-px bg-[var(--menu-line)]"
            />
          ),
          entry.children ? (
            <Branch
              key={entry.name}
              entry={entry}
              open={open === entry.name}
              setOpen={(next) => setOpen(next ? entry.name : null)}
              parent={command}
              container={container}
              close={close}
            />
          ) : (
            <Command.Item
              key={entry.name}
              value={entry.name}
              className={`${MENU_ITEM} ${entry.danger ? "text-danger" : ""}`}
              onSelect={() => {
                close();
                entry.run?.();
              }}
            >
              <Label entry={entry} />
              {entry.shortcut && (
                <span className="ml-4 text-[11px] text-[var(--menu-fg-3)]">{entry.shortcut}</span>
              )}
            </Command.Item>
          ),
        ])}
      </Command.List>
    </Command>
  );
}
// Row colours from live Linear (Opus review 4): labels lch 91.178, keys 64.714, a small ▶ submenu arrow at 41.778.
/** Searched descendants read "Parent › Child", with the path dimmed as in Linear. */
function Label({ entry }: { entry: ActionEntry }) {
  const path = entry.name.split(" › "),
    name = path.pop();
  return (
    <span className="flex flex-1 items-center gap-2 whitespace-nowrap">
      {entry.icon && (
        <span className="text-fg-3">
          <Icon name={entry.icon} size={16} />
        </span>
      )}
      {path.map((part) => (
        <span key={part} className="text-fg-3">
          {part} ›
        </span>
      ))}
      <span className={entry.danger ? "" : "text-[var(--menu-fg)]"}>{name}</span>
    </span>
  );
}
// Like Linear (RAJ-52): a submenu opens to the right, overlapping its menu by 2px, its first row level with the row that opened it; content-sized.
function Branch({
  entry,
  open,
  setOpen,
  parent,
  container,
  close,
}: {
  entry: ActionEntry;
  open: boolean;
  setOpen: (open: boolean) => void;
  parent: Container;
  container: Container;
  close: () => void;
}) {
  const nodeId = useFloatingNodeId(),
    keyboard = useRef(false);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    nodeId,
    open,
    onOpenChange: (next) => {
      keyboard.current = false;
      setOpen(next);
    },
    placement: "right-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset({ mainAxis: 3, alignmentAxis: -7 }),
      flip({ padding: 12, fallbackAxisSideDirection: "end" }),
      shift({ padding: 12 }),
    ],
  });
  const hover = useHover(context, {
    mouseOnly: true,
    delay: { open: 75, close: 120 },
    handleClose: safePolygon({ buffer: 2 }),
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  const focus = () => refs.floating.current?.querySelector<HTMLInputElement>("input")?.focus();
  const back = () => {
    setOpen(false);
    parent.current?.querySelector<HTMLInputElement>("input")?.focus();
  };
  useHotkey(
    "ArrowLeft",
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.value && input.selectionStart !== 0) return;
      back();
    },
    { target: refs.floating, capture: true, ignoreInputs: false },
  );
  useHotkey("Escape", back, { target: refs.floating, capture: true, ignoreInputs: false });
  useEffect(() => {
    if (open && isPositioned && keyboard.current) {
      focus();
      keyboard.current = false;
    }
  }, [open, isPositioned]);
  return (
    <FloatingNode id={nodeId}>
      <Command.Item
        ref={refs.setReference}
        value={entry.name}
        aria-haspopup="dialog"
        aria-expanded={open}
        {...getReferenceProps()}
        className={`${MENU_ITEM} ${open ? "bg-sel" : ""}`}
        onSelect={() => {
          keyboard.current = true;
          if (open) focus();
          else setOpen(true);
        }}
      >
        <Label entry={entry} />
        {entry.shortcut && (
          <span className="ml-4 text-[11px] text-[var(--menu-fg-3)]">{entry.shortcut}</span>
        )}
        <span
          aria-hidden="true"
          data-submenu-arrow
          className="text-[8px] text-[var(--menu-placeholder)] before:content-['▶']"
        />
      </Command.Item>
      {open &&
        container.current &&
        createPortal(
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
            role="dialog"
            aria-label={entry.name}
            {...getFloatingProps({
              onPointerEnter: focus,
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key !== "Tab") event.stopPropagation();
              },
            })}
          >
            <Level
              nested
              entries={entry.children!}
              label={entry.name}
              container={container}
              close={close}
            />
          </div>,
          container.current,
        )}
    </FloatingNode>
  );
}
