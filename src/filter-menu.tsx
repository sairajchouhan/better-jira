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
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { MENU_POPUP as POPUP, MENU_ITEM as ITEM, MENU_INPUT as INPUT } from "./menu-surface";
import { PropertyFilter } from "./property-filter";
import { ui, type Board } from "./store";
import { type Field } from "./view-model";

type Entry = {
  name: string;
  field?: Field;
  group?: string;
  icon: Parameters<typeof Icon>[0]["name"];
  reason?: string;
};
type Container = RefObject<HTMLDivElement | null>;
const UNAVAILABLE = "This field belongs to Linear and is not available on mirrored Jira issues.";
const CATEGORIES: Entry[] = [
  { name: "Advanced filter", group: "advanced", icon: "filter" },
  { name: "Status", field: "status", icon: "layers" },
  { name: "Assignee", field: "assignee", icon: "user" },
  { name: "Creator", field: "creator", icon: "user" },
  { name: "Priority", field: "priority", icon: "layers" },
  { name: "Labels", field: "labels", icon: "label" },
  { name: "Relations", field: "relations", icon: "layers" },
  { name: "Dates", group: "dates", icon: "calendar" },
  { name: "Project", field: "project", icon: "layers" },
  { name: "Project properties", group: "project", icon: "layers" },
  { name: "Subscribers", field: "watchers", icon: "user" },
  { name: "External source", icon: "external", reason: UNAVAILABLE },
  { name: "Auto-closed", icon: "close", reason: UNAVAILABLE },
  { name: "Content", field: "content", icon: "pencil" },
  { name: "Links", field: "links", icon: "external" },
  { name: "Issue type", field: "type", icon: "layers" },
  { name: "Parent issue", field: "parent", icon: "layers" },
  { name: "Pull requests", field: "pullRequests", icon: "external" },
  { name: "Estimate", field: "estimate", icon: "layers" },
];
const DATES: [Field, string][] = [
  ["due", "Due date"],
  ["created", "Created date"],
  ["updated", "Updated date"],
  ["started", "Started date"],
  ["resolved", "Completed date"],
  ["statusAge", "Time in current status"],
];
const PROJECT: Entry[] = [
  { name: "Project lead", field: "projectLead", icon: "user" },
  { name: "Milestone name", field: "milestone", icon: "layers" },
];
const DATE_ENTRIES: Entry[] = [
  ...DATES.map(([field, name]): Entry => ({ field, name, icon: "calendar" })),
  ...["Auto-closed date", "Triaged date"].map((name): Entry => ({
    name,
    icon: "calendar",
    reason: `${name} is not available in the mirrored Jira data.`,
  })),
];

export default function FilterMenu({
  board,
  container,
  footer,
}: {
  board: Board;
  container: Container;
  footer?: ReactNode;
}) {
  return (
    <FloatingTree>
      <FilterLevel board={board} container={container} entries={CATEGORIES} footer={footer} />
    </FloatingTree>
  );
}

/** Each level owns its search and selection; opening a branch never unmounts its parent. */
function FilterLevel({
  board,
  container,
  entries,
  name,
  footer,
}: {
  board: Board;
  container: Container;
  entries: Entry[];
  name?: string;
  footer?: ReactNode;
}) {
  const command = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  useHotkey(
    "ArrowRight",
    () =>
      command.current
        ?.querySelector<HTMLElement>("[cmdk-item][data-selected=true][aria-haspopup]")
        ?.click(),
    { target: command, ignoreInputs: false, capture: true },
  );
  return (
    <Command
      ref={command}
      loop
      className={`${POPUP} filter-command w-[248px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto`}
      onValueChange={(value) => setOpen((current) => (current === value ? current : null))}
    >
      <Command.Input
        autoFocus={!name}
        aria-label={name ? `Filter ${name}` : "Add Filter…"}
        placeholder={name ? "Filter…" : "Add Filter…"}
        className={INPUT}
      />
      <Command.List className="p-1">
        <Command.Empty className="p-3 text-fg-3">No filters found</Command.Empty>
        {entries.map((entry) =>
          entry.group === "advanced" || entry.reason ? (
            <Command.Item
              key={entry.name}
              value={entry.name}
              onSelect={() => {
                setOpen(null);
                if (entry.reason) setInfo(entry.reason);
                else ui.send({ type: "toolbar.open", toolbar: "advanced" });
              }}
              className={`${ITEM} ${entry.reason ? "text-fg-4" : ""}`}
            >
              <Icon name={entry.icon} />
              <span className="flex-1">{entry.name}</span>
            </Command.Item>
          ) : (
            <FilterBranch
              key={entry.name}
              entry={entry}
              container={container}
              parent={command}
              open={open === entry.name}
              setOpen={(next) =>
                setOpen((current) => (next ? entry.name : current === entry.name ? null : current))
              }
            >
              {entry.group ? (
                <FilterLevel
                  board={board}
                  container={container}
                  entries={entry.group === "dates" ? DATE_ENTRIES : PROJECT}
                  name={entry.name}
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
          ),
        )}
      </Command.List>
      {footer}
      {name === "Project properties" && (
        <div className="px-3 pb-2 text-[11px] text-fg-3">Milestones use Jira fix versions.</div>
      )}
      {info && (
        <div
          role="status"
          className="border-t border-line-2 px-3 py-2 text-[12px] leading-5 text-fg-3"
        >
          {info}
        </div>
      )}
    </Command>
  );
}

/** Floating UI supplies hover intent, a safe pointer path, and collision-aware placement. */
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
    middleware: [
      offset(6),
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
  }, [open, isPositioned]);
  useEffect(() => {
    if (!open) return;
    const node = refs.floating.current;
    return () => {
      if (node?.contains(document.activeElement))
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
        className={`${ITEM} ${open ? "bg-hover text-fg" : ""}`}
      >
        <Icon name={entry.icon} />
        <span className="flex-1">{entry.name}</span>
        <Icon name="chevron" size={11} />
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
