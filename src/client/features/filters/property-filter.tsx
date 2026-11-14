import { type Issue, type Board, type User } from "@/shared/issue-model";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { statuses } from "@/shared/board-catalog";
import { epicOf, isEpic, lookupIn, parentOf } from "@/shared/epics";
import { FilterIcon } from "./filter-icons";
import { hue, PriorityIcon, StatusIcon, TypeDot } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { NoMatchesFooter, splitByMatches } from "@/client/components/no-matches";
import { breadcrumbKeywords, menuFilter } from "@/client/lib/fuzzy-score";
import { Select } from "@/client/components/select";
import { Button } from "@/client/components/button";
import { TextInput } from "@/client/components/field";
import { Text } from "@/client/components/text";
import { setRule, updateRule, useViewSettings } from "@/client/features/views/view-settings";
import { ME, timed, useStore } from "@/client/state/store";
import { ui } from "@/client/features/navigation/app-navigation";
import {
  isDate,
  isNumeric,
  matchesRule,
  newId,
  operatorsFor,
  parentName,
  priorityRank,
  selectIssues,
  type Field,
  type Rule,
} from "@/shared/view-model";

export type Choice = { value: string; label: string; count?: number; icon?: ReactNode };
const PEOPLE: Field[] = ["assignee", "creator", "watchers", "projectLead"];
// "No …" rows: their label and Linear glyph ("" for none; the priority row uses the no-priority icon).
const NONE: Partial<Record<Field, [string, string]>> = {
  assignee: ["No assignee", "No assignee"],
  creator: ["No creator", "No assignee"],
  watchers: ["No subscribers", "No assignee"],
  projectLead: ["No epic lead", "No assignee"],
  milestone: ["No milestone", ""],
  labels: ["No labels", "Labels"],
  priority: ["No priority", "priority"],
  project: ["No epic", "Epic"],
  parent: ["No parent", "Parent issues"],
};
const RELATIONS: [string, string, string][] = [
  ["parent", "Parent issues", "Parent issues"],
  ["child", "Sub-issues", "Sub-issues"],
  ["blocked", "Blocked issues", "Blocked issues"],
  ["blocking", "Blocking issues", "Blocking issues"],
  ["related", "Issues with relations", "Issues with relations"],
  ["duplicate", "Duplicates", "Duplicates"],
];
const dot = (name: string) => (
  <span className="grid size-4 shrink-0 place-items-center">
    <span className="size-[9px] rounded-full" style={{ background: hue(name) }} />
  </span>
);
const person = (user: User) => <Avatar user={user} size={16} />;

/** Values a field offers beyond those its issues hold: Jira's priorities and labels, as Linear lists every priority and label
 *  rather than only those in use. */
export type FilterCatalog = { priorities?: string[]; labels?: string[] };
/** The catalog of the Jira site the board is on. */
export function useFilterCatalog(): FilterCatalog {
  const options = useStore((s) => s.options);
  return useMemo(
    () => ({ priorities: options.priorities.map((p) => p.name), labels: options.labels }),
    [options],
  );
}

const BY_RANK: Field[] = ["priority", "projectPriority"];
/** Linear's order: "No …" first, then "Current user", then the values (priorities by rank, statuses by column, the rest by name).
 *  Project is the issue's epic and Project properties are the epic's own fields (shared/epics.ts): the board's epics, and any
 *  epic an issue names that the mirror doesn't hold, by its key. */
export function filterChoices(
  field: Field,
  board: Board,
  issues: Issue[],
  matching = issues,
  catalog: FilterCatalog = {},
): Choice[] {
  const opts = new Map<string, Choice>();
  const add = (value: string, label: string, icon?: ReactNode) =>
    opts.set(value, { value, label, icon, count: 0 });
  const none = NONE[field];
  if (none)
    add(
      "$none",
      none[0],
      none[1] === "priority" ? <PriorityIcon /> : none[1] && <FilterIcon name={none[1]} />,
    );
  if (PEOPLE.includes(field)) add("$me", "Current user", <FilterIcon name="Current user" />);
  if (field === "status")
    statuses(board).forEach((s) => add(s.id, s.name, <StatusIcon status={s} />));
  if (field === "relations")
    return RELATIONS.map(([value, label, glyph]) => ({
      value,
      label,
      icon: <FilterIcon name={glyph} />,
    }));
  if (field === "priority" || field === "projectPriority")
    for (const p of catalog.priorities ?? []) add(p, p, <PriorityIcon name={p} />);
  if (field === "labels") for (const l of catalog.labels ?? []) add(l, l, dot(l));
  const epics = issues.filter(isEpic);
  if (field === "projectStatus")
    statuses(board)
      .filter((s) => epics.some((e) => e.status === s.id))
      .forEach((s) => add(s.id, s.name, <StatusIcon status={s} />));
  const lookup = lookupIn(issues);
  for (const e of epics) {
    if (field === "project") add(e.key, e.summary, <FilterIcon name="Project" />);
    if (field === "projectPriority" && e.priority) add(e.priority, e.priority, <PriorityIcon name={e.priority} />);
    if (field === "projectLabels") for (const l of e.labels) add(l, l, dot(l));
    if (field === "projectLead" && e.assignee) add(e.assignee.id, e.assignee.name, person(e.assignee));
  }
  for (const i of issues) {
    if (field === "assignee" || field === "creator") {
      const u = i[field];
      if (u) add(u.id, u.name, person(u));
    }
    if (field === "labels") for (const l of i.labels) add(l, l, dot(l));
    if (field === "priority" && i.priority)
      add(i.priority, i.priority, <PriorityIcon name={i.priority} />);
    const epic = field === "project" ? epicOf(i, lookup) : undefined;
    if (epic && !opts.has(epic)) add(epic, epic, <FilterIcon name="Project" />);
    if (field === "type" && i.type) add(i.type, i.type, <TypeDot type={i.type} />);
    // Parent issues only: an epic is a Project option, never a Parent one (parentOf).
    const parent = field === "parent" ? parentOf(i, lookup) : undefined;
    if (parent) add(parent, parentName(parent, issues), <FilterIcon name="Parent issues" />);
    if (field === "milestone")
      for (const version of i.milestones ?? []) add(version.id, version.name);
    if (field === "watchers")
      for (const user of i.watchers ?? []) add(user.id, user.name, person(user));
  }
  const out = [...opts.values()];
  const special = (c: Choice) => (c.value === "$none" ? 0 : c.value === "$me" ? 1 : 2);
  const order = (a: Choice, b: Choice) =>
    BY_RANK.includes(field)
      ? priorityRank(a.label) - priorityRank(b.label) || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label);
  if (field !== "status" && field !== "projectStatus")
    out.sort((a, b) => special(a) - special(b) || (special(a) < 2 ? 0 : order(a, b)));
  // Counted against the board's issues, so an epic the other filters hide still names its issues' project.
  for (const o of out) o.count = countWhere(matching, { field, op: "is", values: [o.value] }, issues);
  return out;
}
/** How many of `issues` match `rule`; `universe` is where an issue's epic and sub-issues are looked up. */
export const countWhere = (issues: Issue[], rule: Omit<Rule, "id">, universe = issues) =>
  issues.filter((i) => matchesRule(i, { id: "count", ...rule }, universe, ME.id)).length;
/** Linear: "3 issues", "1 issue"; nothing for none. */
export const issueCount = (n?: number) => (n ? `${n} issue${n === 1 ? "" : "s"}` : "");
/** Linear's multi-value chip label noun and empty text: "2 assignees", "3 statuses", "No matching priorities". */
export const plural = (noun: string) =>
  /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(noun) ? (noun.endsWith("s") && !/(us|ss)$/.test(noun) ? noun : `${noun}es`) : `${noun}s`;
/** Linear's value list empty text names the field: "No matching statuses". */
const noMatches = (name: string) => `No matching ${plural(name.toLowerCase())}`;
/** Relations are single-select in Linear (aria-multiselectable=false): picking one replaces the filter and closes the menu. */
const isSingle = (field: Field) => field === "relations";
/** Linear keeps a filter submenu at its opening width while you type in it: the first layout's width becomes its minimum. */
export const freezeWidth = (node: HTMLElement | null) => {
  if (node && !node.style.minWidth) node.style.minWidth = `${node.getBoundingClientRect().width}px`;
};

/**
 * The board's issues under every filter except this field's own, its rule, its choices and the edits Linear's menu makes.
 * `editingId` edits a chip's rule: unchecking its last value keeps the empty rule, and the chip removes it when its menu closes.
 */
export function useFieldFilter(field: Field, board: Board, editingId?: string) {
  const [newRuleId] = useState(newId);
  const ruleId = editingId ?? newRuleId;
  const issuesMap = useStore((s) => s.issues);
  const prefs = useViewSettings(board.id);
  const mine = useStore((s) => s.mine);
  const query = useStore((s) => s.query);
  const issues = useMemo(() => {
    const base = {
      ...prefs,
      filters: {
        ...prefs.filters,
        children: prefs.filters.children.filter((c) => c.id !== ruleId),
      },
    };
    return selectIssues([...issuesMap.values()], board, base, mine, query, ME.id);
  }, [issuesMap, board, mine, query, prefs, ruleId]);
  const rule = prefs.filters.children.find(
    (c): c is Rule => !("children" in c) && c.id === ruleId,
  );
  const catalog = useFilterCatalog();
  // Keep zero-result values available when another AND condition narrows this field.
  const choices = useMemo(
    () => filterChoices(field, board, [...issuesMap.values()].filter(i => i.board === board.id), issues, catalog),
    [field, board, issuesMap, issues, catalog],
  );
  function apply(values: string[], operator = rule?.op ?? "is") {
    setRule(board.id, { id: ruleId, field, op: operator, values });
  }
  // Picking a value leaves "is empty" for "is".
  const valueOp = () => (rule && !["empty", "notEmpty"].includes(rule.op) ? rule.op : "is");
  /**
   * Linear's FilterBlockHelper: a single-select field replaces its value, and so does Alt-click (`only`, its replaceSelection);
   * otherwise the value toggles. Returns true when the pick finishes the menu (single-select).
   */
  const select = (v: string, only = false) => {
    if (isSingle(field) || only) {
      timed("filter", () => apply([v], valueOp()));
      return isSingle(field);
    }
    const vals = rule?.values ?? [];
    const next = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
    if (!next.length && rule && !editingId) updateRule(board.id, rule.id, null);
    else timed("filter", () => apply(next, valueOp()));
    return false;
  };
  return { issues, rule, choices, apply, select };
}

/** "Status › Todo", "Dates › Due date › Overdue": a searched row's dimmed path before its name (Linear's M4e breadcrumbs). */
export function Path({ path, children }: { path: string[]; children: ReactNode }) {
  return (
    <>
      {path.map((crumb) => (
        <span key={crumb}>
          <span className="text-[var(--menu-fg-3)]">{crumb}</span>
          <svg width="5" height="9" viewBox="0 0 5 9" aria-hidden className="mx-2 inline text-[var(--menu-placeholder)]">
            <path d="m1 1 3 3.5L1 8" fill="none" stroke="currentColor" strokeLinecap="round" />
          </svg>
        </span>
      ))}
      {children}
    </>
  );
}

/**
 * One value row: Linear's checkbox slot, then the value's icon, its name and its issue count. It searches by its label alone.
 * `selection` is the field's: "multiple" draws the checkbox, "single" a trailing checkmark and no aria-checked. A root-search row
 * (`path`, "Status › Todo") draws neither, as Linear's hoisted rows don't. `onSelect(only)` is true for Alt-click.
 */
export function ValueRow({
  choice,
  checked,
  onSelect,
  selection,
  path,
}: {
  choice: Choice;
  checked: boolean;
  onSelect: (only: boolean) => void;
  selection: "multiple" | "single";
  path?: string[];
}) {
  // cmdk selects on its own click handler, which carries no modifiers; the press before it does.
  const alt = useRef(false);
  const multiple = selection === "multiple";
  return (
    <Menu.Item
      value={`${path?.join(" ") ?? ""} ${choice.label} ${choice.value}`.trim()}
      keywords={path ? breadcrumbKeywords(choice.label, path) : [choice.label]}
      aria-checked={multiple ? checked : undefined}
      checkbox={multiple && !path ? checked : undefined}
      checked={!multiple && !path ? checked : undefined}
      icon={choice.icon}
      hint={issueCount(choice.count) || undefined}
      onPointerDown={(event) => {
        alt.current = event.altKey;
      }}
      onSelect={() => {
        onSelect(alt.current);
        alt.current = false;
      }}
    >
      {path ? <Path path={path}>{choice.label}</Path> : choice.label}
    </Menu.Item>
  );
}

/** A field's values as rows; the one list behind the Add-filter submenu, the chip's value menu and the root search. */
export function FieldValues({
  field,
  board,
  ruleId,
  path,
  onDone,
}: {
  field: Field;
  board: Board;
  ruleId?: string;
  path?: string[];
  onDone: () => void;
}) {
  const { rule, choices, select } = useFieldFilter(field, board, ruleId);
  // Linear lists the values already picked first, in the order the menu opened with, so rows don't jump while you toggle.
  const [picked] = useState(() => new Set(rule?.values));
  const ordered = useMemo(
    () => choices.toSorted((a, b) => Number(picked.has(b.value)) - Number(picked.has(a.value))),
    [choices, picked],
  );
  const [reveal, setReveal] = useState(false);
  // A root-search row (`path`) is listed whatever its count; a field's own menu splits off the values nothing matches.
  const { matched, unmatched } = path
    ? { matched: ordered, unmatched: [] }
    : splitByMatches(ordered, (c) => c.count, (c) => !!rule?.values.includes(c.value));
  const row = (c: Choice) => (
    <ValueRow
      key={c.value}
      choice={c}
      path={path}
      selection={isSingle(field) ? "single" : "multiple"}
      checked={rule?.values.includes(c.value) ?? false}
      onSelect={(only) => {
        // A root-search row is a plain action, as Linear's hoisted rows are: it applies its value and closes the menu.
        if (select(c.value, only) || path) onDone();
      }}
    />
  );
  return (
    <>
      {matched.map(row)}
      {unmatched.length > 0 &&
        (reveal ? (
          <>
            <Menu.Divider />
            {unmatched.map(row)}
          </>
        ) : (
          <NoMatchesFooter count={unmatched.length} onReveal={() => setReveal(true)} />
        ))}
    </>
  );
}

/** One date preset with its issue count: Linear's typed suggestions always say "0 issues", the fixed presets hide a zero. */
export function PresetRow({
  preset: p,
  field,
  issues,
  path,
  onSelect,
}: {
  preset: Preset;
  field: Field;
  issues: Issue[];
  path?: string[];
  onSelect: () => void;
}) {
  const count =
    p.value || p.op === "empty" ? countWhere(issues, { field, op: p.op, values: p.value ? [p.value] : [] }) : 0;
  return (
    <Menu.Item
      value={[...(path ?? []), p.label].join(" ")}
      keywords={path ? breadcrumbKeywords(p.label, path) : [p.label]}
      hint={p.typed ? `${count} issue${count === 1 ? "" : "s"}` : issueCount(count)}
      onSelect={onSelect}
    >
      {path ? <Path path={path}>{p.label}</Path> : p.label}
    </Menu.Item>
  );
}

export type Preset = { label: string; op: Rule["op"]; value: string; typed?: boolean };
/** A date rule's value as its chip names it: Linear's date block labels a value by its preset's name (`yF` label: Due date's
 *  `P0D` is "Overdue"), else a relative day ("today") or the date. */
export function dateValueLabel(field: Field, value: string, date: (value: string) => string) {
  return (
    datePresets(field, "").find((p) => p.value === value && !p.typed)?.label ??
    (value === "P0D" ? "today" : date(value))
  );
}
const UNIT: Record<string, [number, string]> = {
  d: [1, "day"],
  w: [7, "week"],
  m: [30, "month"],
  y: [365, "year"],
};
/** Linear's date presets, and for typed text like "2 weeks" its "2 weeks from now" and "2 weeks ago" suggestions. */
export function datePresets(field: Field, query: string): Preset[] {
  const span = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  const typed = /^(\d+)\s*([dwmy])?[a-z]*$/i.exec(query.trim());
  if (typed) {
    const n = Number(typed[1]),
      [days, unit] = UNIT[(typed[2] ?? "d").toLowerCase()]!;
    const value = String(n * days);
    if (field === "statusAge") return [{ label: span(n, unit), op: "gt", value, typed: true }];
    const later: Preset = { label: `${span(n, unit)} from now`, op: "next", value, typed: true },
      earlier: Preset = { label: `${span(n, unit)} ago`, op: "within", value, typed: true };
    return field === "due" ? [later, earlier] : [earlier, later];
  }
  const presets: Preset[] =
    field === "statusAge"
      ? (
          [
            [1, "d"],
            [1, "w"],
            [2, "w"],
            [1, "m"],
            [3, "m"],
            [6, "m"],
          ] as const
        ).map(([n, u]) => ({
          label: span(n, UNIT[u]![1]),
          op: "gt",
          value: String(n * UNIT[u]![0]),
        }))
      : field === "due"
        ? [
            { label: "Overdue", op: "before", value: "P0D" },
            ...(
              [
                [1, "d"],
                [3, "d"],
                [1, "w"],
                [1, "m"],
                [3, "m"],
              ] as const
            ).map(([n, u]): Preset => ({
              label: `${span(n, UNIT[u]![1])} from now`,
              op: "next",
              value: String(n * UNIT[u]![0]),
            })),
          ]
        : (
            [
              [1, "d"],
              [3, "d"],
              [1, "w"],
              [1, "m"],
              [3, "m"],
              [6, "m"],
              [1, "y"],
            ] as const
          ).map(([n, u]): Preset => ({
            label: `${span(n, UNIT[u]![1])} ago`,
            op: "within",
            value: String(n * UNIT[u]![0]),
          }));
  const all = [
    ...presets,
    ...(field === "statusAge"
      ? []
      : [{ label: "Custom date or timeframe…", op: "is" as const, value: "" }]),
    ...(field === "due" ? [{ label: "No due date", op: "empty" as const, value: "" }] : []),
  ];
  const q = query.trim().toLowerCase();
  return q ? all.filter((p) => p.label.toLowerCase().includes(q)) : all;
}

/** `inline`: opened from a filter chip, with the operator as pills and no back button. */
export function PropertyFilter({
  field,
  ruleId,
  name,
  board,
  onBack,
  inline = false,
  autoFocus = true,
}: {
  field: Field;
  ruleId?: string;
  name: string;
  board: Board;
  onBack: () => void;
  inline?: boolean;
  autoFocus?: boolean;
}) {
  const { issues, rule, apply } = useFieldFilter(field, board, ruleId);
  const [value, setValue] = useState(rule?.values[0] ?? "");
  const [op, setOp] = useState<Rule["op"]>(
    rule?.op ?? (field === "content" || field === "links" ? "contains" : "is"),
  );
  const [search, setSearch] = useState("");
  const [custom, setCustom] = useState(inline);
  const date = isDate(field);
  const numeric = isNumeric(field);
  const dated = date || field === "statusAge";
  const text = field === "content" || field === "links";
  const done = () => {
    ui.send({ type: "toolbar.close" });
    if (inline) onBack();
  };
  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim() || op === "empty" || op === "notEmpty") {
          apply(value ? [value] : [], op);
          done();
        }
      }}
      className="space-y-2 p-3"
    >
      <Select
        label={`${name} operator`}
        size="medium"
        className="w-full"
        value={op}
        onValueChange={(v) => setOp(v as Rule["op"])}
      >
        {operatorsFor(field).map(([v, l]) => (
          <Select.Option value={v} key={v}>
            {l}
          </Select.Option>
        ))}
      </Select>
      {!["empty", "notEmpty"].includes(op) && (
        <TextInput
          size="medium"
          autoFocus={autoFocus || !inline}
          aria-label={name}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type={
            numeric
              ? "number"
              : date
                ? ["within", "next"].includes(op)
                  ? "number"
                  : "date"
                : "text"
          }
          min={numeric || op === "within" || op === "next" ? 0 : undefined}
          step={numeric ? "any" : undefined}
          className="w-full"
          placeholder={field === "statusAge" ? "Days in current status…" : "Text to match…"}
        />
      )}
      {field === "statusAge" && (
        <Text as="div" variant="micro" color="muted">
          Duration in days, including fractions.
        </Text>
      )}
      <Button type="submit" size="medium" className="w-full">
        Apply filter
      </Button>
    </form>
  );
  // A chip's value menu is titled by its field, as Linear's is.
  const searchRow = (placeholder = inline ? name : "Filter…", label = `Filter ${name}`) => (
    <Menu.Input
      autoFocus={autoFocus}
      placeholder={placeholder}
      aria-label={label}
      value={search}
      onValueChange={setSearch}
    />
  );
  // Linear's chip editor and the numeric Jira fields keep the operator form.
  if (inline && (dated || numeric || text)) return form;
  if (!inline && (custom || (numeric && field !== "statusAge")))
    return <div className="filter-menu filter-sub w-[248px]">{form}</div>;
  if (dated) {
    const presets = datePresets(field, search);
    return (
      <Menu ref={freezeWidth} shouldFilter={false} className="filter-menu filter-sub">
        {searchRow(field === "due" ? "Try: 1 week ago, 1 week from now…" : "Filter…", name)}
        <Menu.List maxHeight="360px">
          {!presets.length && <Menu.Empty always>{noMatches(name)}</Menu.Empty>}
          {presets.map((p) => (
            <PresetRow
              key={p.label}
              preset={p}
              field={field}
              issues={issues}
              onSelect={() => {
                if (!p.value && p.op === "is") return setCustom(true);
                apply(p.value ? [p.value] : [], p.op);
                done();
              }}
            />
          ))}
        </Menu.List>
      </Menu>
    );
  }
  if (text && !inline) {
    const noun = field === "content" ? "content" : "link";
    return (
      <Menu shouldFilter={false} className="filter-menu filter-sub">
        {searchRow()}
        <Menu.List>
          <Menu.Item
            value="text"
            onSelect={() => {
              if (!search.trim()) return;
              apply([search.trim()], "contains");
              done();
            }}
          >
            {search.trim() ? `Filter by ${noun} “${search.trim()}”` : `Filter by ${noun}…`}
          </Menu.Item>
        </Menu.List>
      </Menu>
    );
  }
  return (
    <div className={inline ? "" : "filter-menu filter-sub"}>
      <Menu ref={freezeWidth} filter={menuFilter}>
        {searchRow()}
        <Menu.List maxHeight={inline ? "300px" : "360px"}>
          <Menu.Empty>{noMatches(name)}</Menu.Empty>
          <FieldValues field={field} board={board} ruleId={ruleId} onDone={done} />
        </Menu.List>
      </Menu>
    </div>
  );
}
