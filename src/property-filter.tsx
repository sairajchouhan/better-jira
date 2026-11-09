import { Command } from "cmdk";
import { useMemo, useState, type ReactNode } from "react";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { MENU_POPUP as POPUP, MENU_ITEM as ITEM, MENU_INPUT as INPUT } from "./menu-surface";
import {
  changePreferences,
  ME,
  timed,
  ui,
  usePreferences,
  useStore,
  type Issue,
  type Board,
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
  updateFilter,
  type Field,
  type Rule,
} from "./view-model";

type Choice = { value: string; label: string; count?: number; icon?: ReactNode };
export function filterChoices(field: Field, board: Board, issues: Issue[]): Choice[] {
  const opts = new Map<string, Choice>();
  const add = (value: string, label: string, icon?: ReactNode) =>
    opts.set(value, { value, label, icon, count: 0 });
  if (["assignee", "creator", "watchers"].includes(field)) {
    add(
      "$none",
      field === "watchers" ? "No subscribers" : field === "assignee" ? "No assignee" : "No creator",
    );
    add("$me", "Current user");
  }
  if (field === "milestone") add("$none", "No milestone");
  if (field === "projectLead") {
    add("$none", "No project lead");
    add("$me", "Current user");
  }
  if (field === "labels") add("$none", "No labels");
  if (field === "priority") add("$none", "No priority");
  if (field === "project") add("$none", "No project");
  if (field === "parent") add("$none", "No parent");
  if (field === "status")
    board.columns
      .flatMap((c) => c.statuses)
      .forEach((s) => add(s.id, s.name, <StatusIcon status={s} />));
  if (field === "relations")
    return [
      ["parent", "Parent issues"],
      ["child", "Sub-issues"],
      ["blocked", "Blocked issues"],
      ["blocking", "Blocking issues"],
      ["related", "Issues with relations"],
      ["duplicate", "Duplicates"],
    ].map(([value, label]) => ({ value: value!, label: label! }));
  for (const i of issues) {
    if (field === "assignee" || field === "creator") {
      const u = i[field];
      if (u) add(u.id, u.name);
    }
    if (field === "labels") for (const l of i.labels) add(l, l);
    if (field === "priority" && i.priority)
      add(i.priority, i.priority, <PriorityIcon name={i.priority} />);
    if (field === "project" && i.project) add(i.project.key, i.project.name);
    if (field === "type" && i.type) add(i.type, i.type);
    if (field === "parent" && i.parent) add(i.parent, parentName(i.parent, issues));
    if (field === "milestone")
      for (const version of i.milestones ?? []) add(version.id, version.name);
    if (field === "watchers") for (const user of i.watchers ?? []) add(user.id, user.name);
    if (field === "projectLead" && i.projectLead) add(i.projectLead.id, i.projectLead.name);
  }
  const out = [...opts.values()];
  // Priorities go by rank, like Linear; other choices by name. "No …" and "Current user" lead.
  const order = (a: Choice, b: Choice) =>
    field === "priority"
      ? priorityRank(a.label) - priorityRank(b.label) || a.label.localeCompare(b.label)
      : a.label.localeCompare(b.label);
  if (field !== "status")
    out.sort((a, b) =>
      a.value.startsWith("$")
        ? b.value.startsWith("$")
          ? a.label.localeCompare(b.label)
          : -1
        : b.value.startsWith("$")
          ? 1
          : order(a, b),
    );
  for (const o of out)
    o.count = issues.filter((i) =>
      matchesRule(i, { id: "count", field, op: "is", values: [o.value] }, issues, ME.id),
    ).length;
  return out;
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
  const issuesMap = useStore((s) => s.issues);
  const prefs = usePreferences(board.id);
  const mine = useStore((s) => s.mine);
  const query = useStore((s) => s.query);
  const issues = useMemo(() => {
    const candidates = [...issuesMap.values()];
    const base = {
      ...prefs,
      filters: {
        ...prefs.filters,
        children: prefs.filters.children.filter((c) => "children" in c || c.field !== field),
      },
    };
    return selectIssues(candidates, board, base, mine, query, ME.id);
  }, [issuesMap, board, mine, query, prefs, field]);
  const rule = prefs.filters.children.find(
    (c): c is Rule => !("children" in c) && c.field === field,
  );
  const [value, setValue] = useState(rule?.values[0] ?? "");
  const [op, setOp] = useState<Rule["op"]>(
    rule?.op ?? (field === "content" || field === "links" ? "contains" : "is"),
  );
  const choices = useMemo(() => filterChoices(field, board, issues), [field, board, issues]);
  function apply(values: string[], operator = rule?.op ?? "is") {
    const next: Rule = { id: rule?.id ?? newId(), field, op: operator, values };
    changePreferences(board.id, {
      filters: {
        ...prefs.filters,
        children: rule
          ? prefs.filters.children.map((c) => (c.id === rule.id ? next : c))
          : [...prefs.filters.children, next],
      },
    });
  }
  const toggle = (v: string) => {
    const vals = rule?.values ?? [];
    const next = vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v];
    if (!next.length && rule)
      changePreferences(board.id, { filters: updateFilter(prefs.filters, rule.id, null) });
    // Picking a value leaves "is empty" for "is".
    else
      timed("filter", () =>
        apply(next, rule && !["empty", "notEmpty"].includes(rule.op) ? rule.op : "is"),
      );
  };
  const date = isDate(field);
  const numeric = isNumeric(field);
  const input = date || numeric || field === "content" || field === "links";
  return (
    <div className={inline ? "" : `${POPUP} w-[270px] max-h-[calc(100vh-140px)] overflow-y-auto`}>
      {inline && !input && rule && (
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
      {input ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim() || op === "empty" || op === "notEmpty") {
              apply(value ? [value] : [], op);
              ui.send({ type: "toolbar.close" });
              if (inline) onBack();
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
              autoFocus={autoFocus}
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
          {date && (
            <div className="border-t border-line-2 pt-1">
              {(field === "due"
                ? [
                    ["Overdue", "before", "P0D"],
                    ["1 day from now", "next", "1"],
                    ["3 days from now", "next", "3"],
                    ["1 week from now", "next", "7"],
                    ["1 month from now", "next", "30"],
                    ["3 months from now", "next", "90"],
                    ["No due date", "empty", ""],
                  ]
                : [
                    ["Last 24 hours", "within", "1"],
                    ["Last 7 days", "within", "7"],
                    ["Last 30 days", "within", "30"],
                    ["No date", "empty", ""],
                  ]
              ).map(([label, operator, v]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    apply(v ? [v] : [], operator as Rule["op"]);
                    ui.send({ type: "toolbar.close" });
                  }}
                  className={ITEM}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </form>
      ) : (
        <Command loop className="filter-command">
          <Command.Input
            autoFocus={autoFocus}
            placeholder="Filter…"
            aria-label={`Filter ${name}`}
            className={INPUT}
          />
          <Command.List className="max-h-[360px] overflow-y-auto p-1">
            <Command.Empty className="p-3 text-fg-3">No values found</Command.Empty>
            {choices.map((c) => (
              <Command.Item
                key={c.value}
                aria-checked={rule?.values.includes(c.value) ?? false}
                value={`${c.label} ${c.value}`}
                onSelect={() => toggle(c.value)}
                className={ITEM}
              >
                <span
                  aria-hidden
                  className={`grid size-3.5 shrink-0 place-items-center rounded border ${rule?.values.includes(c.value) ? "border-accent bg-accent text-white" : "border-line-3"}`}
                >
                  {rule?.values.includes(c.value) && <Icon name="check" size={11} />}
                </span>
                {c.icon}
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {!!c.count && <span className="text-[11px] text-fg-3">{c.count}</span>}
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      )}
    </div>
  );
}
