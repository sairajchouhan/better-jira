import { useMemo, useState, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { statuses } from "@/shared/board-catalog";
import { FilterIcon } from "./filter-icons";
import { hue, PriorityIcon, StatusIcon, TypeDot } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { Select } from "@/client/components/select";
import { Button } from "@/client/components/button";
import { TextInput } from "@/client/components/field";
import { Text } from "@/client/components/text";
import { setRule, updateRule, useViewSettings } from "@/client/features/views/view-settings";
import { ME, timed, useStore, type Issue, type Board, type User } from "@/client/state/store";
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
export function filterChoices(field: Field, board: Board, issues: Issue[], matching = issues): Choice[] {
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
  for (const o of out) o.count = countWhere(matching, { field, op: "is", values: [o.value] });
  return out;
}
const countWhere = (issues: Issue[], rule: Omit<Rule, "id">) =>
  issues.filter((i) => matchesRule(i, { id: "count", ...rule }, issues, ME.id)).length;
/** Linear: "3 issues", "1 issue"; nothing for none. */
export const issueCount = (n?: number) => (n ? `${n} issue${n === 1 ? "" : "s"}` : "");

/** The board's issues under every filter except this field's own, its rule, its choices and the edits Linear's menu makes. */
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
  // Keep zero-result values available when another AND condition narrows this field.
  const choices = useMemo(
    () => filterChoices(field, board, [...issuesMap.values()].filter(i => i.board === board.id), issues),
    [field, board, issuesMap, issues],
  );
  function apply(values: string[], operator = rule?.op ?? "is") {
    setRule(board.id, { id: ruleId, field, op: operator, values });
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

/** "Status › Todo": a searched row's dimmed path before its name (Linear's M4e breadcrumbs). */
export function Path({ path, children }: { path: string; children: ReactNode }) {
  return (
    <>
      <span className="text-[var(--menu-fg-3)]">{path}</span>
      <svg width="5" height="9" viewBox="0 0 5 9" aria-hidden className="mx-2 inline text-[var(--menu-placeholder)]">
        <path d="m1 1 3 3.5L1 8" fill="none" stroke="currentColor" strokeLinecap="round" />
      </svg>
      {children}
    </>
  );
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
    <Menu.Item
      value={path ? `${path} ${choice.label} ${choice.value}` : `${choice.label} ${choice.value}`}
      aria-checked={checked}
      checkbox={check ? checked : undefined}
      icon={choice.icon}
      hint={issueCount(choice.count)}
      onSelect={onSelect}
    >
      {path ? <Path path={path}>{choice.label}</Path> : choice.label}
    </Menu.Item>
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
  const { issues, rule, choices, apply, toggle } = useFieldFilter(field, board, ruleId);
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
  const searchRow = (placeholder = "Filter…", label = `Filter ${name}`) => (
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
      <Menu shouldFilter={false} className="filter-menu filter-sub">
        {searchRow(field === "due" ? "Try: 1 week ago, 1 week from now…" : "Filter…", name)}
        <Menu.List maxHeight="360px">
          {!presets.length && <Menu.Empty always>No matching options</Menu.Empty>}
          {presets.map((p) => {
            const count =
              p.value || p.op === "empty"
                ? countWhere(issues, { field, op: p.op, values: p.value ? [p.value] : [] })
                : 0;
            return (
              <Menu.Item
                key={p.label}
                value={p.label}
                hint={p.typed ? `${count} issue${count === 1 ? "" : "s"}` : issueCount(count)}
                onSelect={() => {
                  if (!p.value && p.op === "is") return setCustom(true);
                  apply(p.value ? [p.value] : [], p.op);
                  done();
                }}
              >
                {p.label}
              </Menu.Item>
            );
          })}
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
      {inline && rule && (
        <div role="group" aria-label={`${name} operator`} className="flex flex-wrap gap-1 pb-2">
          {operatorsFor(field).map(([v, l]) => (
            <Button
              key={v}
              variant="borderless"
              size="small"
              aria-pressed={rule.op === v}
              onClick={() => apply(["empty", "notEmpty"].includes(v) ? [] : rule.values, v)}
            >
              {l}
            </Button>
          ))}
        </div>
      )}
      <Menu>
        {searchRow()}
        <Menu.List maxHeight="360px">
          <Menu.Empty>No matching options</Menu.Empty>
          {choices.map((c) => (
            <ValueRow
              key={c.value}
              choice={c}
              check={field !== "relations"}
              checked={rule?.values.includes(c.value) ?? false}
              onSelect={() => toggle(c.value)}
            />
          ))}
        </Menu.List>
      </Menu>
    </div>
  );
}
