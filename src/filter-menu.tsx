/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
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
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { FilterIcon } from "./filter-icons";
import { Icon, type IconName } from "./icons";
import { PropertyFilter, useFieldFilter, ValueRow } from "./property-filter";
import type { Board } from "./store";
import { type Field } from "./view-model";

/** `divider` draws Linear's separator above the entry; `glyph` is a Linear icon, `icon` ours for Jira-only fields. */
type Entry = {
  name: string;
  field?: Field;
  group?: "advanced" | "dates" | "project";
  glyph?: string;
  icon?: IconName;
  reason?: string;
  divider?: boolean;
  path?: string;
};
type Container = RefObject<HTMLDivElement | null>;
const UNAVAILABLE = "This field belongs to Linear and is not available on mirrored Jira issues.";
// Linear's order and groups (RAJ, 2026-11-11), less its AI, agent, suggested-label and template entries; Jira-only fields close the last group.
const CATEGORIES: Entry[] = [
  { name: "Advanced filter", group: "advanced" },
  { name: "Status", field: "status", divider: true },
  { name: "Assignee", field: "assignee" },
  { name: "Creator", field: "creator" },
  { name: "Priority", field: "priority" },
  { name: "Labels", field: "labels" },
  { name: "Relations", field: "relations" },
  { name: "Dates", group: "dates" },
  { name: "Project", field: "project", divider: true },
  { name: "Project properties", group: "project" },
  { name: "Subscribers", field: "watchers", divider: true },
  { name: "External source", reason: UNAVAILABLE },
  { name: "Auto-closed", reason: UNAVAILABLE },
  { name: "Content", field: "content" },
  { name: "Links", field: "links" },
  { name: "Issue type", field: "type", icon: "layers" },
  { name: "Parent issue", field: "parent", glyph: "Parent issues" },
  { name: "Pull requests", field: "pullRequests", icon: "branch" },
  { name: "Estimate", field: "estimate", glyph: "Priority" },
];
const DATE_ENTRIES: Entry[] = [
  ...(
    [
      ["due", "Due date"],
      ["created", "Created date"],
      ["updated", "Updated date"],
      ["started", "Started date"],
      ["resolved", "Completed date"],
    ] as const
  ).map(([field, name]): Entry => ({ field, name })),
  ...["Auto-closed date", "Triaged date"].map((name): Entry => ({
    name,
    reason: `${name} is not available in the mirrored Jira data.`,
  })),
  { field: "statusAge", name: "Time in current status" },
];
const PROJECT: Entry[] = [
  { name: "Project lead", field: "projectLead", glyph: "Assignee" },
  { name: "Milestone name", field: "milestone", glyph: "Project properties" },
];
// Root search also lists nested categories and the values of these fields, as Linear's does.
const NESTED = [
  ...DATE_ENTRIES.filter((e) => e.field).map((e) => ({ ...e, path: "Dates" })),
  ...PROJECT.map((e) => ({ ...e, path: "Project properties" })),
];
const SEARCHED: [Field, string][] = [
  ["status", "Status"],
  ["assignee", "Assignee"],
  ["creator", "Creator"],
  ["priority", "Priority"],
  ["labels", "Labels"],
  ["project", "Project"],
  ["watchers", "Subscribers"],
  ["type", "Issue type"],
];
const matches = (text: string, query: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.toLowerCase().includes(word));

/** The filter menu's content; the control that opens it decides what closing it and "Advanced filter" do. */
export default function FilterMenu({
  board,
  container,
  footer,
  onClose,
  onAdvanced,
}: {
  board: Board;
  container: Container;
  footer?: ReactNode;
  onClose: () => void;
  onAdvanced: () => void;
}) {
  // Linear: Enter on a value row picks it and closes the menu; clicks keep it open to pick more.
  useHotkey(
    "Enter",
    (event) => {
      const root = (event.target as Element | null)?.closest("[cmdk-root]");
      if (root?.querySelector("[cmdk-item][data-selected=true][aria-checked]"))
        setTimeout(onClose);
    },
    { target: container, ignoreInputs: false, capture: true, preventDefault: false, stopPropagation: false },
  );
  return (
    <FloatingTree>
      <FilterLevel
        board={board}
        container={container}
        entries={CATEGORIES}
        footer={footer}
        onAdvanced={onAdvanced}
      />
    </FloatingTree>
  );
}

function EntryIcon({ entry }: { entry: Entry }) {
  return entry.icon ? (
    <span className="filter-glyph grid size-4 shrink-0 place-items-center">
      <Icon name={entry.icon} size={14} />
    </span>
  ) : (
    <span className="filter-glyph contents">
      <FilterIcon name={entry.glyph ?? entry.name} />
    </span>
  );
}

/** Each level owns its search and selection; opening a branch never unmounts its parent. */
function FilterLevel({
  board,
  container,
  entries,
  name,
  footer,
  onAdvanced,
}: {
  board: Board;
  container: Container;
  entries: Entry[];
  name?: string;
  footer?: ReactNode;
  onAdvanced: () => void;
}) {
  const command = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim();
  useHotkey(
    "ArrowRight",
    () =>
      command.current
        ?.querySelector<HTMLElement>("[cmdk-item][data-selected=true][aria-haspopup]")
        ?.click(),
    { target: command, ignoreInputs: false, capture: true },
  );
  const shown = q
    ? [...entries, ...(name ? [] : NESTED)].filter((e) => matches(`${e.path ?? ""} ${e.name}`, q))
    : entries;
  return (
    <Command
      ref={command}
      loop
      shouldFilter={false}
      className={`filter-menu ${name ? "filter-sub" : ""} max-h-[calc(100vh-140px)]`}
      onValueChange={(value) => setOpen((current) => (current === value ? current : null))}
    >
      <div className="filter-search">
        <Command.Input
          autoFocus={!name}
          aria-label={name ? `Filter ${name}` : "Add Filter…"}
          placeholder={name ? "Filter…" : "Add Filter…"}
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setOpen(null);
          }}
        />
        {!name && <kbd aria-hidden>F</kbd>}
      </div>
      <Command.List className="filter-list">
        {shown.map((entry) => (
          <Fragment key={(entry.path ?? "") + entry.name}>
            {!q && entry.divider && <div role="separator" className="filter-separator" />}
            {entry.group === "advanced" || entry.reason ? (
              <Command.Item
                value={entry.name}
                data-disabled-reason={entry.reason ? "" : undefined}
                onSelect={() => {
                  setOpen(null);
                  if (entry.reason) setInfo(entry.reason);
                  else onAdvanced();
                }}
                className="filter-row"
              >
                <EntryIcon entry={entry} />
                <span className="flex-1">{entry.name}</span>
              </Command.Item>
            ) : (
              <FilterBranch
                entry={entry}
                container={container}
                parent={command}
                open={open === entry.name}
                setOpen={(next) =>
                  setOpen((current) =>
                    next ? entry.name : current === entry.name ? null : current,
                  )
                }
              >
                {entry.group ? (
                  <FilterLevel
                    board={board}
                    container={container}
                    entries={entry.group === "dates" ? DATE_ENTRIES : PROJECT}
                    name={entry.name}
                    onAdvanced={onAdvanced}
                  />
                ) : (
                  <PropertyFilter
                    field={entry.field!}
                    name={entry.name}
                    board={board}
                    autoFocus={false}
                    onBack={() => setOpen(null)}
                  />
                )}
              </FilterBranch>
            )}
          </Fragment>
        ))}
        {!name &&
          q &&
          SEARCHED.map(([field, path]) => (
            <SearchedValues key={field} field={field} path={path} board={board} query={q} />
          ))}
        {!shown.length && !(!name && q) && <div className="filter-empty">No matching options</div>}
      </Command.List>
      {footer}
      {info && (
        <div
          role="status"
          className="border-t-[0.5px] border-[var(--filter-divider)] px-3.5 py-2 text-[12px] leading-5 text-[var(--filter-icon)]"
        >
          {info}
        </div>
      )}
    </Command>
  );
}

/** A field's values as "Status › Todo" rows in the root search; picking one toggles it like the submenu does. */
function SearchedValues({
  field,
  path,
  board,
  query,
}: {
  field: Field;
  path: string;
  board: Board;
  query: string;
}) {
  const { choices, rule, toggle } = useFieldFilter(field, board);
  return choices
    .filter((c) => matches(`${path} ${c.label}`, query))
    .map((c) => (
      <ValueRow
        key={c.value}
        choice={c}
        path={path}
        check={false}
        checked={rule?.values.includes(c.value) ?? false}
        onSelect={() => toggle(c.value)}
      />
    ));
}

/** Floating UI supplies hover intent, a safe pointer path, and collision-aware placement.
 * Linear opens a submenu on the left, overlapping its menu by 2px, with its first row level with the row that opened it. */
function FilterBranch({
  entry,
  children,
  container,
  parent,
  open,
  setOpen,
}: {
  entry: Entry;
  children: ReactNode;
  container: Container;
  parent: Container;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const id = useId(),
    nodeId = useFloatingNodeId();
  const focusOnOpen = useRef(false);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    nodeId,
    open,
    onOpenChange: (next) => {
      focusOnOpen.current = false;
      setOpen(next);
    },
    placement: "left-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    // The row sits 6.5px inside its menu (0.5px border, 6px inset): 4.5px more leaves a 2px overlap. Its first row is 43px down (search row, 6px gap).
    middleware: [
      offset({ mainAxis: 4.5, alignmentAxis: -43 }),
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
  const focusSearch = () => {
    const node = refs.floating.current;
    (
      node?.querySelector<HTMLElement>("input") ?? node?.querySelector<HTMLElement>("select,button")
    )?.focus();
  };
  const back = () => {
    setOpen(false);
    parent.current?.querySelector<HTMLInputElement>("input")?.focus();
  };
  useHotkey(
    "ArrowLeft",
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.value && input.selectionStart !== 0) return;
      event.preventDefault();
      back();
    },
    { target: refs.floating, ignoreInputs: false, capture: true, preventDefault: false },
  );
  useEffect(() => {
    if (open && isPositioned && focusOnOpen.current) {
      focusSearch();
      focusOnOpen.current = false;
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Focus only on opening; cleanup resolves the latest parent menu after nested menus change.
  }, [open, isPositioned]);
  useEffect(() => {
    if (!open) return;
    const node = refs.floating.current;
    return () => {
      if (node?.contains(document.activeElement))
        // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Focus only on opening; cleanup resolves the latest parent menu after nested menus change.
        parent.current?.querySelector<HTMLInputElement>("input")?.focus();
    };
  }, [open, parent, refs.floating]);
  return (
    <FloatingNode id={nodeId}>
      <Command.Item
        ref={refs.setReference}
        value={entry.name}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        {...getReferenceProps()}
        onSelect={() => {
          focusOnOpen.current = true;
          if (open) focusSearch();
          else setOpen(true);
        }}
        className="filter-row"
      >
        <EntryIcon entry={entry} />
        {entry.path && (
          <>
            <span className="filter-path">{entry.path}</span>
            <svg
              width="5"
              height="9"
              viewBox="0 0 5 9"
              aria-hidden
              className="text-[var(--filter-dim)]"
            >
              <path d="m1 1 3 3.5L1 8" fill="none" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </>
        )}
        <span className="flex-1">{entry.name}</span>
        <span aria-hidden className="filter-arrow" />
      </Command.Item>
      {open &&
        container.current &&
        createPortal(
          <div
            id={id}
            ref={refs.setFloating}
            style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
            role="dialog"
            aria-label={`${entry.name} filter`}
            {...getFloatingProps({
              onPointerEnter: () => {
                if (!refs.floating.current?.contains(document.activeElement)) focusSearch();
              },
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== "Tab") event.stopPropagation();
              },
            })}
          >
            {children}
          </div>,
          container.current,
        )}
    </FloatingNode>
  );
}
