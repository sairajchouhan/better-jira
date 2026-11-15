import { type Board } from "@/shared/issue-model";
import { memo, useState, type ReactNode } from "react";
import { FilterIcon } from "./filter-icons";
import { Icon, type IconName } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { ui } from "@/client/features/navigation/app-navigation";
import { datePresets, FieldValues, Path, PresetRow, PropertyFilter, useFieldFilter } from "./property-filter";
import { useBoardHasEstimates } from "@/client/features/views/view-settings";

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
/** A board without estimates keeps Estimate in place but disabled, as Linear's estimate filter (`qXt`: applicable only where
 *  `estimationEnabled`, disabledReason "Estimation is disabled"). */
const WITHOUT_ESTIMATES: Entry[] = CATEGORIES.map((e) =>
  e.field === "estimate" ? { name: e.name, glyph: e.glyph, reason: "Estimation is disabled: this board's issues have no story points." } : e,
);
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
  footer,
  side,
  openedBy,
  onAdvanced,
}: {
  board: Board;
  footer?: ReactNode;
  side: "left" | "right";
  openedBy: "pointer" | "keyboard";
  onAdvanced: () => void;
}) {
  const estimates = useBoardHasEstimates(board.id);
  return (
    <FilterLevel board={board} entries={estimates ? CATEGORIES : WITHOUT_ESTIMATES} footer={footer} side={side} openedBy={openedBy} onAdvanced={onAdvanced} />
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
  entries,
  name,
  footer,
  side,
  openedBy = "keyboard",
  onAdvanced,
}: {
  board: Board;
  entries: Entry[];
  name?: string;
  footer?: ReactNode;
  side: "left" | "right";
  openedBy?: "pointer" | "keyboard";
  onAdvanced: () => void;
}) {
  const [info, setInfo] = useState("");
  const [query, setQuery] = useState("");
  const q = query.trim();
  const hoist = !name && q.length >= HOIST_FROM;
  const shown = q && !name ? [...entries, ...NESTED] : entries;
  return (
    <Menu
      search={query}
      onSearchChange={setQuery}
      start={openedBy === "pointer" ? "none" : "first"}
      // A submenu's room is its row's (Menu.Submenu); the root's toolbar popover has no room of its own, so it keeps this cap.
      className={name ? "filter-menu filter-sub" : "filter-menu max-h-[calc(100vh-140px)]"}
    >
      <Menu.Input
        autoFocus={!name}
        aria-label={name ? `Filter ${name}` : "Add Filter…"}
        placeholder={name ? "Filter…" : "Add Filter…"}
        hotkey={name ? undefined : "F"}
      />
      <Menu.List>
        <Menu.Empty>No matching options</Menu.Empty>
        {shown.map((entry) => (
          <FilterEntry
            key={(entry.path?.join() ?? "") + entry.name}
            entry={entry}
            board={board}
            side={side}
            onAdvanced={onAdvanced}
            onInfo={setInfo}
          />
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

/**
 * One category row. Memoised: its level re-renders on each keystroke in its search and on each info line, which re-renders a row
 * only when its entry changes. Which submenu is open lives in React Aria's menu (Menu.Submenu), so no row is told it.
 */
export const FilterEntry = memo(function FilterEntry({
  entry,
  board,
  side,
  onAdvanced,
  onInfo,
}: {
  entry: Entry;
  board: Board;
  side: "left" | "right";
  onAdvanced: () => void;
  onInfo: (reason: string) => void;
}) {
  return (
    <>
      {entry.divider && <Menu.Divider />}
      {entry.group === "advanced" || entry.reason ? (
        <Menu.Item
          value={entry.name}
          icon={<EntryIcon entry={entry} />}
          aria-disabled={entry.reason ? true : undefined}
          onSelect={() => {
            if (entry.reason) onInfo(entry.reason);
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
        >
          {entry.group ? (
            <FilterLevel
              board={board}
              entries={entry.group === "dates" ? DATE_ENTRIES : PROJECT}
              name={entry.name}
              side={side}
              onAdvanced={onAdvanced}
            />
          ) : (
            <PropertyFilter field={entry.field!} name={entry.name} board={board} autoFocus={false} />
          )}
        </Menu.Submenu>
      )}
    </>
  );
});

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
