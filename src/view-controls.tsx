import { useHotkey } from "@tanstack/react-hotkeys";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MenuSurface, MENU_POPUP as POPUP } from "./menu-surface";
import { filterChoices, PropertyFilter } from "./property-filter";
import { PillSelect } from "./pill-select";
import { Icon } from "./icons";
import {
  changeDisplay,
  changePreferences,
  ME,
  preferencesFor,
  saveDefault,
  timed,
  ui,
  usePreferences,
  useStore,
  type Issue,
  type Board,
} from "./store";
import {
  defaultDisplay,
  defaultPreferences,
  filterCount,
  FIELDS,
  GROUPINGS,
  isDate,
  isNumeric,
  matchesFilters,
  newId,
  operatorsFor,
  ORDERINGS,
  PROPERTIES,
  selectIssues,
  updateFilter,
  type Display,
  type Field,
  type FilterGroup,
  type Rule,
} from "./view-model";

const loadFilterMenu = () => import("./filter-menu");
const FilterMenu = lazy(loadFilterMenu);

export { MENU_POPUP as POPUP } from "./menu-surface";
const CIRCLE =
  "relative grid size-7 shrink-0 place-items-center rounded-full bg-btn text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg";

export function BoardControls({ board }: { board: Board }) {
  const toolbar = useStore((s) => s.toolbar);
  const preferences = usePreferences(board.id);
  const filterRef = useRef<HTMLButtonElement>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState({ top: 100, right: 16 });
  const ref = toolbar === "display" ? displayRef : filterRef;
  const count = filterCount(preferences.filters);
  useHotkey(
    "Escape",
    () => {
      ui.send({ type: "toolbar.close" });
      ref.current?.focus();
    },
    { target: popup, enabled: !!toolbar, ignoreInputs: false, capture: true },
  );
  useEffect(() => {
    if (!toolbar) return;
    const position = () => {
      const r = ref.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 6, right: innerWidth - r.right });
    };
    position();
    const focusFrame = requestAnimationFrame(() =>
      popup.current
        ?.querySelector<HTMLElement>("input, [role=tab][aria-selected=true], button")
        ?.focus(),
    );
    const outside = (e: PointerEvent) => {
      if (
        !popup.current?.contains(e.target as Node) &&
        !filterRef.current?.contains(e.target as Node) &&
        !displayRef.current?.contains(e.target as Node)
      )
        ui.send({ type: "toolbar.close" });
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", position);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", position);
    };
  }, [toolbar, board.id]);
  return (
    <>
      <button
        ref={filterRef}
        aria-label="Add filter"
        title="Filter (F)"
        aria-expanded={toolbar === "filter" || toolbar === "advanced"}
        onPointerEnter={() => void loadFilterMenu()}
        onFocus={() => void loadFilterMenu()}
        onClick={() => ui.send({ type: "toolbar.toggle", toolbar: "filter" })}
        className={CIRCLE}
      >
        <Icon name="filter" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full bg-accent text-[9px] text-white">
            {count}
          </span>
        )}
      </button>
      <button
        ref={displayRef}
        aria-label="Display options"
        title="Display options (Shift+V)"
        aria-expanded={toolbar === "display"}
        onClick={() => ui.send({ type: "toolbar.toggle", toolbar: "display" })}
        className={CIRCLE}
      >
        <Icon name="display" />
        {JSON.stringify(preferences.display) !== JSON.stringify(defaultDisplay()) && (
          <span className="absolute top-0 right-0 size-1.5 rounded-full bg-accent" />
        )}
      </button>
      {toolbar &&
        createPortal(
          <div
            ref={popup}
            className="fixed z-40 max-w-[calc(100vw-24px)]"
            style={{ top: rect.top, right: rect.right }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                ui.send({ type: "toolbar.close" });
                ref.current?.focus();
              }
              if (e.key === "Tab") {
                const nodes = [
                  ...(popup.current?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input, select, [tabindex="0"]',
                  ) ?? []),
                ].filter((n) => n.getClientRects().length);
                const first = nodes[0],
                  last = nodes.at(-1);
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            {toolbar === "display" ? (
              <DisplayMenu board={board} />
            ) : toolbar === "advanced" ? (
              <AdvancedMenu board={board} />
            ) : (
              <Suspense
                fallback={
                  <div role="status" className={`${POPUP} w-[248px] p-3`}>
                    Opening filters…
                  </div>
                }
              >
                <FilterMenu
                  key={board.id}
                  board={board}
                  container={popup}
                  footer={<PropertySyncNotice />}
                />
              </Suspense>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  children,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 text-[12px] text-fg-3">
      <span>{label}</span>
      <span className="flex w-[170px] items-center gap-2">
        {children}
        <PillSelect
          label={label}
          value={value}
          options={options}
          onChange={onChange}
          className="flex h-6 min-w-0 flex-1 items-center rounded-md border border-line-2 bg-tab px-2 text-left text-[12px] text-fg-2 hover:bg-hover"
        />
      </span>
    </div>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-8 cursor-default items-center justify-between gap-4 text-[12px] text-fg-3">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={value}
        onChange={onChange}
        className="view-toggle"
      />
    </label>
  );
}
function DisplayMenu({ board }: { board: Board }) {
  const { display: d } = usePreferences(board.id);
  const defaults = useStore((s) => s.defaults);
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<Display>) => timed("display", () => changeDisplay(board.id, p));
  return (
    <div
      role="dialog"
      aria-label="Display options"
      className={`${POPUP} w-[304px] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}
    >
      <div role="tablist" aria-label="Layout" className="mb-4 grid grid-cols-2 gap-1">
        {(["list", "board"] as const).map((layout) => (
          <button
            role="tab"
            aria-selected={d.layout === layout}
            key={layout}
            onClick={() => patch({ layout })}
            className={`flex h-7 items-center justify-center gap-2 rounded-full bg-tab text-[12px] shadow-(--tab-shadow) ${d.layout === layout ? "bg-tab-on text-fg" : "text-fg-3"}`}
          >
            <Icon name={layout} />
            {layout === "list" ? "List" : "Board"}
          </button>
        ))}
      </div>
      <Select
        label={d.layout === "board" ? "Columns" : "Grouping"}
        value={d.columns}
        options={GROUPINGS.filter(([v]) => d.layout === "list" || v !== "none")}
        onChange={(v) => patch({ columns: v as Display["columns"] })}
      >
        <button
          aria-label="Group ordering"
          title="Reverse group order"
          onClick={(e) => {
            e.preventDefault();
            patch({ groupDescending: !d.groupDescending });
          }}
          className="text-fg-2"
        >
          <Icon name={d.groupDescending ? "down" : "up"} />
        </button>
      </Select>
      <Select
        label={d.layout === "board" ? "Rows" : "Sub-grouping"}
        value={d.rows}
        options={GROUPINGS.filter(([v]) => v === "none" || v !== d.columns)}
        onChange={(v) => patch({ rows: v as Display["rows"] })}
      />
      <Select
        label="Ordering"
        value={d.ordering}
        options={ORDERINGS}
        onChange={(v) => patch({ ordering: v as Display["ordering"] })}
      >
        <button
          aria-label="Direction"
          title="Reverse issue order"
          onClick={(e) => {
            e.preventDefault();
            patch({ descending: !d.descending });
          }}
          className="text-fg-2"
        >
          <Icon name={d.descending ? "down" : "up"} />
        </button>
      </Select>
      <Toggle
        label="Order completed by recency"
        value={d.completedRecency}
        onChange={() => patch({ completedRecency: !d.completedRecency })}
      />
      <div className="my-3 border-t border-line-2" />
      <Toggle
        label="Show sub-issues"
        value={d.subIssues}
        onChange={() => patch({ subIssues: !d.subIssues })}
      />
      <div className="my-3 border-t border-line-2" />
      <div className="mb-1 text-[12px] font-medium">
        {d.layout === "board" ? "Board" : "List"} options
      </div>
      {d.layout === "list" && (
        <Select
          label="Nested sub-issues"
          value={d.nested}
          options={[
            ["matching", "Show matching"],
            ["all", "Show all"],
            ["none", "Don't nest"],
          ]}
          onChange={(v) => patch({ nested: v as Display["nested"] })}
        />
      )}
      <Toggle
        label={d.layout === "board" ? "Show empty columns" : "Show empty groups"}
        value={d.emptyGroups}
        onChange={() => patch({ emptyGroups: !d.emptyGroups })}
      />
      <div className="mt-3 mb-2 text-[12px] text-fg-3">Display properties</div>
      <div className="flex flex-wrap gap-1">
        {PROPERTIES.filter(([p]) => d.layout === "list" || p !== "creator").map(([p, label]) => (
          <button
            key={p}
            aria-pressed={d.properties.includes(p)}
            onClick={() =>
              patch({
                properties: d.properties.includes(p)
                  ? d.properties.filter((v) => v !== p)
                  : [...d.properties, p],
              })
            }
            className={`rounded-full px-2 py-1 text-[11px] ${d.properties.includes(p) ? "bg-tab-on text-fg-2" : "bg-tab text-fg-3"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <PropertySyncNotice />
      <div className="my-3 border-t border-line-2" />
      <Select
        label="Open issues in"
        value={d.openIn}
        options={[
          ["side", "Side panel"],
          ["page", "Full page"],
        ]}
        onChange={(v) => patch({ openIn: v as Display["openIn"] })}
      />
      <div className="mt-3 flex justify-end gap-3 border-t border-line-2 pt-2 text-[11px]">
        <button
          title="Reset to the saved default for this board"
          onClick={() => changeDisplay(board.id, defaults[board.id] ?? defaultDisplay())}
        >
          Reset
        </button>
        <button
          className="text-accent disabled:opacity-50"
          disabled={saving}
          title="Save your display default in this browser"
          onClick={async () => {
            setSaving(true);
            await saveDefault(board.id);
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save my default"}
        </button>
      </div>
    </div>
  );
}

export function FilterChips({ board }: { board: Board }) {
  const { filters } = usePreferences(board.id);
  const issues = useStore((s) => s.issues);
  const labelFor = (field: Field, value: string) => {
    if (value === "$me") return "me";
    if (value === "$none") return "none";
    if (field === "statusAge") return `${value} days`;
    if (field === "status")
      return board.columns.flatMap((c) => c.statuses).find((s) => s.id === value)?.name ?? value;
    if (field === "assignee" || field === "creator")
      return [...issues.values()].find((i) => i[field]?.id === value)?.[field]?.name ?? value;
    if (field === "project")
      return [...issues.values()].find((i) => i.project?.key === value)?.project?.name ?? value;
    if (field === "milestone")
      return (
        [...issues.values()].flatMap((i) => i.milestones ?? []).find((v) => v.id === value)?.name ??
        value
      );
    if (field === "watchers")
      return (
        [...issues.values()].flatMap((i) => i.watchers ?? []).find((u) => u.id === value)?.name ??
        value
      );
    if (field === "projectLead")
      return (
        [...issues.values()].find((i) => i.projectLead?.id === value)?.projectLead?.name ?? value
      );
    if (field === "relations")
      return (
        (
          {
            parent: "Parent issues",
            child: "Sub-issues",
            blocked: "Blocked issues",
            blocking: "Blocking issues",
            related: "Issues with relations",
            duplicate: "Duplicates",
          } as Record<string, string>
        )[value] ?? value
      );
    return value;
  };
  const [edit, setEdit] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const editing = filters.children.find((c): c is Rule => !("children" in c) && c.id === edit?.id);
  if (!filters.children.length) return null;
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-1.5 border-t border-line px-3 py-1.5 text-[12px]">
      {/* Like Linear, a chip edits its own rule in a small picker under it; groups still open the advanced editor. */}
      {edit && editing && (
        <MenuSurface
          label={`Edit ${FIELDS.find(([f]) => f === editing.field)?.[1]} filter`}
          anchor={edit.anchor}
          width={280}
          close={() => setEdit(null)}
        >
          <PropertyFilter
            inline
            field={editing.field}
            name={FIELDS.find(([f]) => f === editing.field)?.[1] ?? editing.field}
            board={board}
            onBack={() => setEdit(null)}
          />
        </MenuSurface>
      )}
      {filters.children.map((c) => (
        <div
          key={c.id}
          className="flex h-6 max-w-[320px] items-center overflow-hidden rounded-md border border-line-2 bg-tab"
        >
          <button
            className="truncate px-2"
            onClick={(e) =>
              "children" in c
                ? ui.send({ type: "toolbar.open", toolbar: "advanced" })
                : setEdit({ id: c.id, anchor: e.currentTarget.parentElement! })
            }
          >
            {"children" in c
              ? `${c.join.toUpperCase()} group · ${filterCount(c)} rules`
              : `${FIELDS.find(([f]) => f === c.field)?.[1]} ${operatorsFor(c.field).find(([op]) => op === c.op)?.[1]} ${c.values.map((v) => labelFor(c.field, v)).join(", ")}`}
          </button>
          <button
            className="mr-1 rounded hover:bg-hover"
            aria-label={`Remove ${"children" in c ? "filter group" : c.field} filter`}
            onClick={() =>
              changePreferences(board.id, { filters: updateFilter(filters, c.id, null) })
            }
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => ui.send({ type: "toolbar.open", toolbar: "filter" })}
        className="grid size-6 place-items-center rounded hover:bg-hover"
        aria-label="Add another filter"
      >
        <Icon name="plus" />
      </button>
      <button
        className="ml-1 text-fg-3"
        onClick={() => changePreferences(board.id, { filters: { ...filters, children: [] } })}
      >
        Clear
      </button>
    </div>
  );
}

function AdvancedMenu({ board }: { board: Board }) {
  const preferences = usePreferences(board.id);
  const { filters } = preferences;
  const issues = useStore((s) => s.issues);
  const mine = useStore((s) => s.mine);
  const query = useStore((s) => s.query);
  const universe = useMemo(() => [...issues.values()], [issues]);
  const all = useMemo(
    () =>
      selectIssues(
        universe,
        board,
        { ...preferences, filters: defaultPreferences().filters },
        mine,
        query,
        ME.id,
      ),
    [universe, board, preferences, mine, query],
  );
  const patch = (id: string, change: Parameters<typeof updateFilter>[2]) =>
    timed("filter", () =>
      changePreferences(board.id, {
        filters: updateFilter(preferencesFor(board.id).filters, id, change),
      }),
    );
  return (
    <div
      role="dialog"
      aria-label="Advanced filter"
      className={`${POPUP} w-[640px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium">Advanced filter</span>
        <button
          aria-label="Close advanced filter"
          onClick={() => ui.send({ type: "toolbar.close" })}
        >
          <Icon name="close" />
        </button>
      </div>
      <FilterGroupEditor group={filters} board={board} issues={all} patch={patch} depth={0} />
      <PropertySyncNotice />
      <div className="mt-3 flex justify-between border-t border-line-2 pt-3 text-[12px] text-fg-3">
        <span>
          {all.filter((i) => matchesFilters(i, filters, universe, ME.id)).length} matching issues in
          this view
        </span>
        <button
          onClick={() => ui.send({ type: "toolbar.close" })}
          className="rounded-md bg-accent px-3 py-1 text-white"
        >
          Done
        </button>
      </div>
    </div>
  );
}
function FilterGroupEditor({
  group,
  board,
  issues,
  patch,
  depth,
}: {
  group: FilterGroup;
  board: Board;
  issues: Issue[];
  patch: (id: string, p: Parameters<typeof updateFilter>[2]) => void;
  depth: number;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-line-2 p-2">
      <div className="flex items-center gap-2 text-[12px] text-fg-3">
        Match
        <select
          aria-label={depth === 0 ? "Match conditions" : "Match group conditions"}
          value={group.join}
          onChange={(e) => patch(group.id, { join: e.target.value as FilterGroup["join"] })}
          className="view-select"
        >
          <option value="and">all</option>
          <option value="or">any</option>
        </select>
        of the following
        {depth > 0 && (
          <button
            aria-label="Remove filter group"
            className="ml-auto"
            onClick={() => patch(group.id, null)}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {group.children.map((c) =>
        "children" in c ? (
          <FilterGroupEditor
            key={c.id}
            group={c}
            board={board}
            issues={issues}
            patch={patch}
            depth={depth + 1}
          />
        ) : (
          <RuleEditor
            key={c.id}
            rule={c}
            board={board}
            issues={issues}
            patch={(p) => patch(c.id, p)}
          />
        ),
      )}
      <div className="flex gap-3 text-[12px] text-fg-3">
        <button
          aria-label={depth === 0 ? "Add filter condition" : "Add group condition"}
          onClick={() =>
            patch(group.id, {
              children: [...group.children, { id: newId(), field: "status", op: "is", values: [] }],
            })
          }
        >
          + Add filter
        </button>
        {depth < 5 && (
          <button
            aria-label={depth === 0 ? "Add filter group" : "Add nested filter group"}
            onClick={() =>
              patch(group.id, {
                children: [...group.children, { id: newId(), join: "or", children: [] }],
              })
            }
          >
            + Add filter group
          </button>
        )}
      </div>
    </div>
  );
}
function RuleEditor({
  rule: r,
  board,
  issues,
  patch,
}: {
  rule: Rule;
  board: Board;
  issues: Issue[];
  patch: (p: Partial<Rule> | null) => void;
}) {
  const choices = useMemo(() => filterChoices(r.field, board, issues), [r.field, board, issues]);
  const free =
    isDate(r.field) || isNumeric(r.field) || r.field === "content" || r.field === "links";
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <select
        className="view-select w-32"
        aria-label="Filter property"
        value={r.field}
        onChange={(e) => {
          const field = e.target.value as Field;
          patch({
            field,
            op: field === "content" || field === "links" ? "contains" : "is",
            values: [],
          });
        }}
      >
        {FIELDS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <select
        className="view-select w-32"
        aria-label="Filter operator"
        value={r.op}
        onChange={(e) => patch({ op: e.target.value as Rule["op"], values: [] })}
      >
        {operatorsFor(r.field).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {!["empty", "notEmpty"].includes(r.op) &&
        (free ? (
          <input
            className="view-select min-w-24 flex-1"
            aria-label="Filter value"
            type={
              isNumeric(r.field)
                ? "number"
                : isDate(r.field)
                  ? ["within", "next"].includes(r.op)
                    ? "number"
                    : "date"
                  : "text"
            }
            step={isNumeric(r.field) ? "any" : undefined}
            value={r.values[0] ?? ""}
            min={isNumeric(r.field) ? 0 : undefined}
            onChange={(e) => patch({ values: e.target.value ? [e.target.value] : [] })}
            placeholder={r.field === "statusAge" ? "Days…" : "Value…"}
          />
        ) : (
          <div className="min-w-32 flex-1 space-y-1">
            {r.values.map((v) => (
              <button
                key={v}
                className="mr-1 rounded bg-tab-on px-2 py-1 text-[11px]"
                title="Remove value"
                onClick={() => patch({ values: r.values.filter((x) => x !== v) })}
              >
                {choices.find((c) => c.value === v)?.label ?? v} ×
              </button>
            ))}
            <select
              aria-label="Add filter value"
              value=""
              className="view-select w-full"
              onChange={(e) => {
                if (e.target.value && !r.values.includes(e.target.value))
                  patch({ values: [...r.values, e.target.value] });
              }}
            >
              <option value="">Select values…</option>
              {choices
                .filter((c) => !r.values.includes(c.value))
                .map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
            </select>
          </div>
        ))}
      <button
        aria-label="Remove condition"
        className="grid size-7 place-items-center text-fg-3"
        onClick={() => patch(null)}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  );
}

function PropertySyncNotice() {
  const progress = useStore((s) => s.propertySync);
  if (!progress.pending && !progress.errors) return null;
  return (
    <div role="status" className="border-t border-line-2 px-2 py-2 text-[11px] leading-4 text-fg-3">
      {progress.pending
        ? `Loading Jira properties… ${progress.completed} / ${progress.total}. Results update as data arrives.`
        : `Some Jira properties could not be read on ${progress.errors} issues. Restricted watcher lists are excluded from subscriber filters.`}
    </div>
  );
}
