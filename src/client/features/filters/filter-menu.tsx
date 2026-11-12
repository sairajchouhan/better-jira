import { FloatingTree } from "@floating-ui/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Fragment, useState, type ReactNode, type RefObject } from "react";
import { FilterIcon } from "./filter-icons";
import { Icon, type IconName } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { Path, PropertyFilter, useFieldFilter, ValueRow } from "./property-filter";
import type { Board } from "@/client/state/store";
import { type Field } from "@/shared/view-model";

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
  return entry.icon ? <Icon name={entry.icon} size={14} /> : <FilterIcon name={entry.glyph ?? entry.name} />;
}

/** A nested entry found by the root search reads "Dates › Due date", as Linear's breadcrumb labels do. */
function EntryLabel({ entry }: { entry: Entry }) {
  return entry.path ? <Path path={entry.path}>{entry.name}</Path> : entry.name;
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
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim();
  const shown = q
    ? [...entries, ...(name ? [] : NESTED)].filter((e) => matches(`${e.path ?? ""} ${e.name}`, q))
    : entries;
  return (
    <Menu
      shouldFilter={false}
      className={`filter-menu ${name ? "filter-sub" : ""} max-h-[calc(100vh-140px)]`}
      onValueChange={(value) => setOpen((current) => (current === value ? current : null))}
    >
      <Menu.Input
        autoFocus={!name}
        aria-label={name ? `Filter ${name}` : "Add Filter…"}
        placeholder={name ? "Filter…" : "Add Filter…"}
        hotkey={name ? undefined : "F"}
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setOpen(null);
        }}
      />
      <Menu.List>
        {shown.map((entry) => (
          <Fragment key={(entry.path ?? "") + entry.name}>
            {!q && entry.divider && <Menu.Divider />}
            {entry.group === "advanced" || entry.reason ? (
              <Menu.Item
                value={entry.name}
                icon={<EntryIcon entry={entry} />}
                aria-disabled={entry.reason ? true : undefined}
                onSelect={() => {
                  setOpen(null);
                  if (entry.reason) setInfo(entry.reason);
                  else onAdvanced();
                }}
              >
                {entry.name}
              </Menu.Item>
            ) : (
              <Menu.Submenu
                value={entry.name}
                label={<EntryLabel entry={entry} />}
                icon={<EntryIcon entry={entry} />}
                side="left"
                popupLabel={`${entry.name} filter`}
                container={container}
                open={open === entry.name}
                onOpenChange={(next) =>
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
              </Menu.Submenu>
            )}
          </Fragment>
        ))}
        {!name &&
          q &&
          SEARCHED.map(([field, path]) => (
            <SearchedValues key={field} field={field} path={path} board={board} query={q} />
          ))}
        {!shown.length && !(!name && q) && <Menu.Empty always>No matching options</Menu.Empty>}
      </Menu.List>
      {footer}
      {info && (
        <div
          role="status"
          className="border-t-[0.5px] border-[var(--menu-divider)] px-3.5 py-2 text-[12px] leading-5 text-[var(--menu-fg-3)]"
        >
          {info}
        </div>
      )}
    </Menu>
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
