import { Command } from "cmdk";
import { useMemo, useState, type ReactNode } from "react";
import { Avatar } from "./avatar";
import { statuses } from "./board-catalog";
import { FilterIcon } from "./filter-icons";
import { hue, PriorityIcon, StatusIcon, TypeDot } from "./icons";
import { setRule, updateRule, useViewSettings } from "./view-settings";
import {
  ME,
  timed,
  ui,
  useStore,
  type Issue,
  type Board,
  type User,
} from "./store";
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
} from "./view-model";

export type Choice = { value: string; label: string; count?: number; icon?: ReactNode };
const PEOPLE: Field[] = ["assignee", "creator", "watchers", "projectLead"];
// "No …" rows: their label and Linear glyph ("" for none; the priority row uses the no-priority icon).
const NONE: Partial<Record<Field, [string, string]>> = {
  assignee: ["No assignee", "No assignee"],
  creator: ["No creator", "No assignee"],
  watchers: ["No subscribers", "No assignee"],
  projectLead: ["No project lead", "No assignee"],
  milestone: ["No milestone", ""],
  labels: ["No labels", "Labels"],
  priority: ["No priority", "priority"],
  project: ["No project", "Project"],
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

/** Linear's order: "No …" first, then "Current user", then the values (priorities by rank, the rest by name). */
export function filterChoices(field: Field, board: Board, issues: Issue[]): Choice[] {
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
  for (const i of issues) {
    if (field === "assignee" || field === "creator") {
      const u = i[field];
      if (u) add(u.id, u.name, person(u));
    }
    if (field === "labels") for (const l of i.labels) add(l, l, dot(l));
    if (field === "priority" && i.priority)
      add(i.priority, i.priority, <PriorityIcon name={i.priority} />);
    if (field === "project" && i.project)
      add(i.project.key, i.project.name, <FilterIcon name="Project" />);
    if (field === "type" && i.type) add(i.type, i.type, <TypeDot type={i.type} />);
    if (field === "parent" && i.parent)
      add(i.parent, parentName(i.parent, issues), <FilterIcon name="Parent issues" />);
    if (field === "milestone")
      for (const version of i.milestones ?? []) add(version.id, version.name);
    if (field === "watchers")
      for (const user of i.watchers ?? []) add(user.id, user.name, person(user));
    if (field === "projectLead" && i.projectLead)
      add(i.projectLead.id, i.projectLead.name, person(i.projectLead));
  }
  const out = [...opts.values()];
  const special = (c: Choice) => (c.value === "$none" ? 0 : c.value === "$me" ? 1 : 2);
  const order = (a: Choice, b: Choice) =>
    field === "priority"
      ? priorityRank(a.label) - priorityRank(b.label) || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label);
  if (field !== "status")
    out.sort((a, b) => special(a) - special(b) || (special(a) < 2 ? 0 : order(a, b)));
  for (const o of out) o.count = countWhere(issues, { field, op: "is", values: [o.value] });
  return out;
}
const countWhere = (issues: Issue[], rule: Omit<Rule, "id">) =>
  issues.filter((i) => matchesRule(i, { id: "count", ...rule }, issues, ME.id)).length;
/** Linear: "3 issues", "1 issue"; nothing for none. */
export const issueCount = (n?: number) => (n ? `${n} issue${n === 1 ? "" : "s"}` : "");

/** The board's issues under every filter except this field's own, its rule, its choices and the edits Linear's menu makes. */
export function useFieldFilter(field: Field, board: Board) {
  const issuesMap = useStore((s) => s.issues);
  const prefs = useViewSettings(board.id);
  const mine = useStore((s) => s.mine);
  const query = useStore((s) => s.query);
  const issues = useMemo(() => {
    const base = {
      ...prefs,
      filters: {
        ...prefs.filters,
        children: prefs.filters.children.filter((c) => "children" in c || c.field !== field),
      },
    };
    return selectIssues([...issuesMap.values()], board, base, mine, query, ME.id);
  }, [issuesMap, board, mine, query, prefs, field]);
  const rule = prefs.filters.children.find(
    (c): c is Rule => !("children" in c) && c.field === field,
  );
  const choices = useMemo(() => filterChoices(field, board, issues), [field, board, issues]);
  function apply(values: string[], operator = rule?.op ?? "is") {
    setRule(board.id, { id: rule?.id ?? newId(), field, op: operator, values });
  }
  const toggle = (v: string) => {
    const vals = rule?.values ?? [];
    const next = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
    if (!next.length && rule)
      updateRule(board.id, rule.id, null);
    // Picking a value leaves "is empty" for "is".
    else
      timed("filter", () =>
        apply(next, rule && !["empty", "notEmpty"].includes(rule.op) ? rule.op : "is"),
      );
  };
  return { issues, rule, choices, apply, toggle };
}

/** One value row: Linear's checkbox slot, then the value's icon, its name and its issue count. */
export function ValueRow({
  choice,
  checked,
  onSelect,
  check = true,
  path,
}: {
  choice: Choice;
  checked: boolean;
  onSelect: () => void;
  check?: boolean;
  path?: string;
}) {
  return (
    <Command.Item
      value={path ? `${path} ${choice.label} ${choice.value}` : `${choice.label} ${choice.value}`}
      aria-checked={checked}
      onSelect={onSelect}
      className="filter-row"
    >
      {check && <span aria-hidden className="filter-check" />}
      <span className={check ? "filter-value" : "contents"}>
        {choice.icon}
        {path && (
          <>
            <span className="filter-path">{path}</span>
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
        <span className="min-w-0 truncate">{choice.label}</span>
        <span className="filter-count">{issueCount(choice.count)}</span>
      </span>
    </Command.Item>
  );
}

type Preset = { label: string; op: Rule["op"]; value: string; typed?: boolean };
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
  name,
  board,
  onBack,
  inline = false,
  autoFocus = true,
}: {
  field: Field;
  name: string;
  board: Board;
  onBack: () => void;
  inline?: boolean;
  autoFocus?: boolean;
}) {
  const { issues, rule, choices, apply, toggle } = useFieldFilter(field, board);
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
      <select
        aria-label={`${name} operator`}
        value={op}
        onChange={(e) => setOp(e.target.value as Rule["op"])}
        className="view-select w-full"
      >
        {operatorsFor(field).map(([v, l]) => (
          <option value={v} key={v}>
            {l}
          </option>
        ))}
      </select>
      {!["empty", "notEmpty"].includes(op) && (
        <input
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
          className="view-select w-full"
          placeholder={field === "statusAge" ? "Days in current status…" : "Text to match…"}
        />
      )}
      {field === "statusAge" && (
        <div className="text-[11px] text-fg-3">Duration in days, including fractions.</div>
      )}
      <button type="submit" className="h-7 w-full rounded-md bg-accent text-[12px] text-white">
        Apply filter
      </button>
    </form>
  );
  const searchRow = (placeholder = "Filter…", label = `Filter ${name}`) => (
    <div className="filter-search">
      <Command.Input
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={label}
        value={search}
        onValueChange={setSearch}
      />
    </div>
  );
  // Linear's chip editor and the numeric Jira fields keep the operator form.
  if (inline && (dated || numeric || text)) return form;
  if (!inline && (custom || (numeric && field !== "statusAge")))
    return <div className="filter-menu filter-sub w-[248px]">{form}</div>;
  if (dated) {
    const presets = datePresets(field, search);
    return (
      <Command loop shouldFilter={false} className="filter-menu filter-sub">
        {searchRow(field === "due" ? "Try: 1 week ago, 1 week from now…" : "Filter…", name)}
        <Command.List className="filter-list max-h-[360px] overflow-y-auto">
          {!presets.length && <div className="filter-empty">No matching options</div>}
          {presets.map((p) => {
            const count =
              p.value || p.op === "empty"
                ? countWhere(issues, { field, op: p.op, values: p.value ? [p.value] : [] })
                : 0;
            return (
              <Command.Item
                key={p.label}
                value={p.label}
                className="filter-row"
                onSelect={() => {
                  if (!p.value && p.op === "is") return setCustom(true);
                  apply(p.value ? [p.value] : [], p.op);
                  done();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{p.label}</span>
                <span className="filter-count">
                  {p.typed ? `${count} issue${count === 1 ? "" : "s"}` : issueCount(count)}
                </span>
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
    );
  }
  if (text && !inline) {
    const noun = field === "content" ? "content" : "link";
    return (
      <Command loop shouldFilter={false} className="filter-menu filter-sub">
        {searchRow()}
        <Command.List className="filter-list">
          <Command.Item
            value="text"
            className="filter-row"
            onSelect={() => {
              if (!search.trim()) return;
              apply([search.trim()], "contains");
              done();
            }}
          >
            {search.trim() ? `Filter by ${noun} “${search.trim()}”` : `Filter by ${noun}…`}
          </Command.Item>
        </Command.List>
      </Command>
    );
  }
  return (
    <div className={inline ? "" : "filter-menu filter-sub"}>
      {inline && rule && (
        <div role="group" aria-label={`${name} operator`} className="flex flex-wrap gap-1 pb-2">
          {operatorsFor(field).map(([v, l]) => (
            <button
              key={v}
              aria-pressed={rule.op === v}
              onClick={() => apply(["empty", "notEmpty"].includes(v) ? [] : rule.values, v)}
              className={`rounded-full px-2 py-0.5 text-[11px] ${rule.op === v ? "bg-tab-on text-fg" : "bg-tab text-fg-3 hover:text-fg-2"}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <Command loop className={inline ? "filter-sub" : ""}>
        {searchRow()}
        <Command.List className="filter-list max-h-[360px] overflow-y-auto">
          <Command.Empty className="filter-empty">No matching options</Command.Empty>
          {choices.map((c) => (
            <ValueRow
              key={c.value}
              choice={c}
              check={field !== "relations"}
              checked={rule?.values.includes(c.value) ?? false}
              onSelect={() => toggle(c.value)}
            />
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
