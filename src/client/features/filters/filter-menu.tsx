import { type Board } from "@/shared/issue-model";
import { FloatingTree } from "@floating-ui/react";
import { Fragment, useState, type ReactNode, type RefObject } from "react";
import { FilterIcon } from "./filter-icons";
import { Icon, type IconName } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { usePristine } from "@/client/components/menu-pristine";
import { menuFilter } from "@/client/lib/fuzzy-score";
import { ui } from "@/client/features/navigation/app-navigation";
import { datePresets, FieldValues, Path, PresetRow, PropertyFilter, useFieldFilter } from "./property-filter";

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
  path?: string[];
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
  { name: "Epic", field: "project", glyph: "Project", divider: true },
  { name: "Epic properties", group: "project", glyph: "Project properties" },
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
// Linear's Project properties as live RAJ lists them (`gZt`: bXt status, SXt priority, CXt labels, EXt lead, OXt milestone name),
// read off the issue's epic (shared/epics.ts); the lead is the epic's assignee. Milestone stays the issue's Jira fix version.
const PROJECT: Entry[] = [
  { name: "Epic status", field: "projectStatus", glyph: "Status" },
  { name: "Epic priority", field: "projectPriority", glyph: "Priority" },
  { name: "Epic labels", field: "projectLabels", glyph: "Labels" },
  { name: "Epic lead", field: "projectLead", glyph: "Assignee" },
  { name: "Milestone name", field: "milestone", glyph: "Project properties" },
];
// Root search also lists nested categories, every field's values and the date presets, as Linear's does.
const NESTED: Entry[] = [
  ...DATE_ENTRIES.filter((e) => e.field).map((e) => ({ ...e, path: ["Dates"] })),
  ...PROJECT.map((e) => ({ ...e, path: ["Epic properties"] })),
];
const SEARCHED: [Field, string[]][] = [
  ["status", ["Status"]],
  ["assignee", ["Assignee"]],
  ["creator", ["Creator"]],
  ["priority", ["Priority"]],
  ["labels", ["Labels"]],
  ["relations", ["Relations"]],
  ["project", ["Epic"]],
  ["projectStatus", ["Epic properties", "Epic status"]],
  ["projectPriority", ["Epic properties", "Epic priority"]],
  ["projectLabels", ["Epic properties", "Epic labels"]],
  ["projectLead", ["Epic properties", "Epic lead"]],
  ["milestone", ["Epic properties", "Milestone name"]],
  ["watchers", ["Subscribers"]],
  ["type", ["Issue type"]],
  ["parent", ["Parent issue"]],
];
const PRESETS = DATE_ENTRIES.filter((e) => e.field);
/** Linear hoists values into the root search from 2 characters (FilterBlockHelper `subActionsHoisting.minInputLength ?? 2`). */
const HOIST_FROM = 2;
const closeMenu = () => ui.send({ type: "toolbar.close" });

/**
 * The filter menu's content; the control that opens it decides what closing it and "Advanced filter" do. Submenus open on
 * `side`, the side of the trigger with room (flip still moves them near an edge). Opened by a "pointer", no row is highlighted until
 * a key or the pointer moves; opened by "keyboard" (F, Enter on the trigger) the first row is, as in Linear.
 */
export default function FilterMenu({
  board,
  container,
  footer,
  side,
  openedBy,
  onAdvanced,
}: {
  board: Board;
  container: Container;
  footer?: ReactNode;
  side: "left" | "right";
  openedBy: "pointer" | "keyboard";
  onAdvanced: () => void;
}) {
  return (
    <FloatingTree>
      <FilterLevel
        board={board}
        container={container}
        entries={CATEGORIES}
        footer={footer}
        side={side}
        openedBy={openedBy}
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

/**
 * Each level owns its search and selection; opening a branch never unmounts its parent. Its search ranks every row with Linear's
 * score (menuFilter): categories by name, and at the root also nested categories, values and date presets by their own label.
 */
function FilterLevel({
  board,
  container,
  entries,
  name,
  footer,
  side,
  openedBy = "keyboard",
  onAdvanced,
}: {
  board: Board;
  container: Container;
  entries: Entry[];
  name?: string;
  footer?: ReactNode;
  side: "left" | "right";
  openedBy?: "pointer" | "keyboard";
  onAdvanced: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [query, setQuery] = useState("");
  const start = usePristine(openedBy === "pointer");
  const q = query.trim();
  const hoist = !name && q.length >= HOIST_FROM;
  const shown = q && !name ? [...entries, ...NESTED] : entries;
  return (
    <Menu
      filter={menuFilter}
      className={`filter-menu ${name ? "filter-sub" : ""} max-h-[calc(100vh-140px)]`}
      {...start.props}
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
          start.wake();
        }}
      />
      {/* cmdk reorders rows in place while ranking; a fresh list when the search clears restores Linear's order. */}
      <Menu.List key={q ? "search" : "all"}>
        <Menu.Empty>No matching options</Menu.Empty>
        {shown.map((entry) => (
          <Fragment key={(entry.path?.join() ?? "") + entry.name}>
            {entry.divider && <Menu.Divider />}
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
                side={side}
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
                    side={side}
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
        {hoist &&
          SEARCHED.map(([field, path]) => (
            <FieldValues key={field} field={field} path={path} board={board} onDone={closeMenu} />
          ))}
        {hoist &&
          PRESETS.map((entry) => (
            <SearchedPresets key={entry.field} field={entry.field!} path={["Dates", entry.name]} board={board} />
          ))}
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

/** A date field's presets as "Dates › Due date › Overdue" rows in the root search; picking one applies it and closes, as in its submenu. */
function SearchedPresets({ field, path, board }: { field: Field; path: string[]; board: Board }) {
  const { issues, apply } = useFieldFilter(field, board);
  return datePresets(field, "")
    .filter((p) => p.value || p.op === "empty")
    .map((p) => (
      <PresetRow
        key={p.label}
        preset={p}
        field={field}
        issues={issues}
        path={path}
        onSelect={() => {
          apply(p.value ? [p.value] : [], p.op);
          closeMenu();
        }}
      />
    ));
}
