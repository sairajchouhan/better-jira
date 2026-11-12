import "./view-toolbar.css";
import { useActiveView, useOverlayFilters, saveOverlayToView } from "./saved-views";
import { clearFilters, resetDisplay, setDisplay, updateRule, useViewSettings } from "./view-settings";
import { canMergeOverlay } from "./saved-view-model";
import { viewShortcutId } from "./view-shortcut";
import { createToolbarView } from "./view-toolbar-actions";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { MenuSurface, MENU_POPUP as POPUP, Popover } from "./menu-surface";
import { filterChoices, PropertyFilter, ValueRow } from "./property-filter";
import { Menu } from "./menu";
import { PillSelect } from "./pill-select";
import { Icon } from "./icons";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "./button";
import { SegmentedControl } from "./segmented-control";
import { TextInput } from "./field";
import { Text } from "./text";
import { LoadingState } from "./empty-state";
import { shortDate } from "./due-date";
import {
  ME,
  saveDefault,
  timed,
  ui,
  useStore,
  type Issue,
  type Board,
} from "./store";
import {
  defaultDisplay,
  defaultPreferences,
  sameDisplay,
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
  type Display,
  type Field,
  type FilterGroup,
  type Rule,
} from "./view-model";

type FilterMenuModule = typeof import("./filter-menu");
let filterMenu: FilterMenuModule | undefined;
const loadFilterMenu = () => import("./filter-menu").then((m) => (filterMenu = m));
// Preloaded after first paint; a loaded module resolves `lazy` synchronously, so the first F skips the Suspense round trip (R2-D6).
const FilterMenu = lazy(
  () =>
    (filterMenu
      ? // A native promise resolves a tick later, so lazy would still suspend; React only calls `then`.
        // oxlint-disable-next-line unicorn/no-thenable
        { then: (done: (m: FilterMenuModule) => void) => done(filterMenu!) }
      : loadFilterMenu()) as Promise<FilterMenuModule>,
);

export { MENU_POPUP as POPUP } from "./menu-surface";

type Placement = "bottom-left" | "bottom-right";
const closeToolbar = () => ui.send({ type: "toolbar.close" });
const openAdvanced = () => ui.send({ type: "toolbar.open", toolbar: "advanced" });

/**
 * Linear's AddFilterButton: one component behind both the toolbar's Filter button and the chip row's "+". Each instance owns
 * its menu and opens it under its own trigger; `menu` names the instance in the ui machine, so only one is open at a time.
 */
function AddFilterButton({
  board,
  menu,
  placement,
  triggerRef,
  expanded,
  label,
  shortcut,
  variant,
  size,
  className,
  children,
}: {
  board: Board;
  menu: "filter" | "add-filter";
  placement: Placement;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  expanded?: boolean;
  label: string;
  shortcut?: string;
  variant: ButtonVariant;
  size: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  const open = useStore((s) => s.toolbar === menu);
  const own = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? own;
  const popup = useRef<HTMLDivElement>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        label={label}
        shortcut={shortcut}
        variant={variant}
        size={size}
        aria-expanded={expanded ?? open}
        onPointerEnter={() => void loadFilterMenu()}
        onFocus={() => void loadFilterMenu()}
        onClick={() => ui.send({ type: "toolbar.toggle", toolbar: menu })}
        className={className}
      >
        {children}
      </IconButton>
      {open && (
        <Popover trigger={trigger} placement={placement} popup={popup} close={closeToolbar}>
          <Suspense
            fallback={
              <div className={`${POPUP} w-[248px] p-3`}>
                <LoadingState>Opening filters…</LoadingState>
              </div>
            }
          >
            <FilterMenu
              key={board.id}
              board={board}
              container={popup}
              footer={<PropertySyncNotice />}
              onClose={closeToolbar}
              onAdvanced={openAdvanced}
            />
          </Suspense>
        </Popover>
      )}
    </>
  );
}

export function BoardControls({ board }: { board: Board }) {
  const view = useActiveView();
  const toolbar = useStore((s) => s.toolbar);
  const preferences = useViewSettings(board.id);
  const savedDefault = useStore((s) => s.defaults[board.id]);
  const filterRef = useRef<HTMLButtonElement>(null);
  const displayRef = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const count = filterCount(preferences.filters);
  useEffect(() => {
    (window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(
      () => void loadFilterMenu(),
    );
  }, []);
  return (
    <>
      <AddFilterButton
        board={board}
        menu="filter"
        placement="bottom-right"
        triggerRef={filterRef}
        expanded={toolbar === "filter" || toolbar === "advanced"}
        label={count ? "Add another filter" : "Add filter"}
        shortcut={count ? undefined : "F"}
        variant="secondary"
        size="medium"
      >
        <Icon name="filter" />
      </AddFilterButton>
      <IconButton
        ref={displayRef}
        label="Display options"
        shortcut="Shift+V"
        variant="secondary"
        size="medium"
        aria-expanded={toolbar === "display"}
        onClick={() => ui.send({ type: "toolbar.toggle", toolbar: "display" })}
      >
        <Icon name="display" />
        {!sameDisplay(preferences.display, view?.display ?? savedDefault ?? defaultDisplay()) && (
          <span className="absolute top-0 right-0 size-1.5 rounded-full bg-accent" />
        )}
      </IconButton>
      {(toolbar === "display" || toolbar === "advanced") && (
        <Popover
          key={toolbar}
          trigger={toolbar === "display" ? displayRef : filterRef}
          placement="bottom-right"
          popup={popup}
          close={closeToolbar}
        >
          {toolbar === "display" ? <DisplayMenu board={board} /> : <AdvancedMenu board={board} />}
        </Popover>
      )}
    </>
  );
}

/** A display-options row: label on the left, a pill select on the right (Linear's Display menu). */
export function Select({
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
    <div className="flex min-h-8 items-center justify-between gap-2">
      <Text variant="mini" color="muted">{label}</Text>
      <span className="flex w-[170px] items-center gap-2">
        {children}
        {/* PillSelect (P0's file) owns its trigger's look; this keeps the display menu's compact size until it renders a Button. */}
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
/** A display-options row: label on the left, a switch on the right. No Switch primitive exists yet, so the input keeps `view-toggle`. */
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex min-h-8 cursor-default items-center justify-between gap-4">
      <Text variant="mini" color="muted">{label}</Text>
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
  const { display: d } = useViewSettings(board.id);
  // Saved views and the view editor own their display, so the board-default footer stays out (Linear).
  const inView = useStore((s) => !!s.activeViewId || !!s.editorDraft);
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<Display>) => timed("display", () => setDisplay(board.id, p));
  return (
    <div
      role="dialog"
      aria-label="Display options"
      className={`${POPUP} w-[304px] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}
    >
      <SegmentedControl
        aria-label="Layout"
        size="medium"
        width="full"
        value={d.layout}
        onValueChange={(layout) => patch({ layout: layout as Display["layout"] })}
        className="mb-4"
      >
        {(["list", "board"] as const).map((layout) => (
          // ponytail: gap is layout inside the segment until SegmentedControl spaces an icon from its label (Q8).
          // tabIndex 0 keeps both segments tabbable: MenuSurface's Tab trap counts tabindex=-1 buttons as its ends, so a
          // roving stop lets Shift+Tab escape the popup. Drop it once that trap skips tabindex=-1 (follow-up).
          <SegmentedControl.Segment key={layout} value={layout} tabIndex={0} className="gap-1.5">
            <Icon name={layout} />
            {layout === "list" ? "List" : "Board"}
          </SegmentedControl.Segment>
        ))}
      </SegmentedControl>
      <Select
        label={d.layout === "board" ? "Columns" : "Grouping"}
        value={d.columns}
        options={GROUPINGS.filter(([v]) => d.layout === "list" || v !== "none")}
        onChange={(v) => patch({ columns: v as Display["columns"] })}
      >
        <IconButton
          label="Reverse group order"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            patch({ groupDescending: !d.groupDescending });
          }}
        >
          <Icon name={d.groupDescending ? "down" : "up"} />
        </IconButton>
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
        <IconButton
          label="Reverse issue order"
          size="small"
          onClick={(e) => {
            e.preventDefault();
            patch({ descending: !d.descending });
          }}
        >
          <Icon name={d.descending ? "down" : "up"} />
        </IconButton>
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
      <Text as="div" variant="miniPlus" className="mb-1">
        {d.layout === "board" ? "Board" : "List"} options
      </Text>
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
      <Text as="div" variant="mini" color="muted" className="mt-3 mb-2">
        Display properties
      </Text>
      <div className="flex flex-wrap gap-1">
        {PROPERTIES.filter(([p]) => d.layout === "list" || p !== "creator").map(([p, label]) => (
          <Button
            key={p}
            variant="borderless"
            size="small"
            aria-pressed={d.properties.includes(p)}
            onClick={() =>
              patch({
                properties: d.properties.includes(p)
                  ? d.properties.filter((v) => v !== p)
                  : [...d.properties, p],
              })
            }
          >
            {label}
          </Button>
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
      {!inView && <div className="mt-3 flex justify-end gap-1 border-t border-line-2 pt-2">
        <Button
          variant="borderless"
          size="small"
          title="Reset to the saved default for this board"
          onClick={() => resetDisplay(board.id)}
        >
          Reset
        </Button>
        <Button
          variant="secondary"
          size="small"
          disabled={saving}
          title="Save your display default in this browser"
          onClick={async () => {
            setSaving(true);
            await saveDefault(board.id);
            setSaving(false);
          }}
        >
          {saving ? "Saving…" : "Save my default"}
        </Button>
      </div>}
    </div>
  );
}

/** Linear's multi-value chip label noun: "2 assignees", "3 statuses", "2 priorities". */
const plural = (noun: string) =>
  /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : /(s|x|ch|sh)$/.test(noun) ? (noun.endsWith("s") && !/(us|ss)$/.test(noun) ? noun : `${noun}es`) : `${noun}s`;

/** Linear's chip: Backspace or Delete on a focused chip removes its filter. */
const removeOnKey = (remove: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Backspace" || e.key === "Delete") {
    e.preventDefault();
    remove();
  }
};

/**
 * One rule's chip: field, operator and values. Only a chip with values subscribes to the issues, for their labels.
 * Linear's view filter is the segmented FilterBlock (FilterBlockHelper), not the single-pill FilterChip (`man`), so it
 * keeps its own markup in view-toolbar.css.
 */
function RuleChip({
  rule: c,
  board,
  open,
  onEdit,
  remove,
}: {
  rule: Rule;
  board: Board;
  open: "operator" | "value" | null;
  onEdit: (segment: "operator" | "value", anchor: HTMLElement) => void;
  remove: () => void;
}) {
  const issues = useStore((s) => (c.values.length ? s.issues : null));
  const all = useMemo(() => (issues ? filterChoices(c.field, board, [...issues.values()]) : []), [issues, c.field, board]);
  const name = FIELDS.find(([f]) => f === c.field)?.[1] ?? c.field;
  const picked = c.values.map((value) => ({ value, choice: all.find((v) => v.value === value) }));
  const labelOf = ({ value, choice }: (typeof picked)[number]) =>
    ["within", "next"].includes(c.op) || c.field === "statusAge"
      ? `${value} day${Number(value) === 1 ? "" : "s"}`
      : isDate(c.field)
        ? value === "P0D" ? "today" : shortDate(value)
        : (choice?.label ?? value);
  return (
    <div className="view-filter-chip" onKeyDown={removeOnKey(remove)}>
      <span className="view-filter-segment">
        <span>{name}</span>
      </span>
      <button
        className="view-filter-segment view-filter-operator"
        aria-label={`${c.field} operator`}
        aria-expanded={open === "operator"}
        onClick={(e) => onEdit("operator", e.currentTarget)}
      >
        <span>
          {c.op === "within" ? "in the last" : c.op === "next" ? "in the next" : operatorsFor(c.field).find(([op]) => op === c.op)?.[1]}
        </span>
      </button>
      {!["empty", "notEmpty"].includes(c.op) && (
        <button
          className="view-filter-segment"
          aria-label={`${c.field} value`}
          aria-expanded={open === "value"}
          title={picked.length > 1 ? picked.map(labelOf).join(", ") : undefined}
          onClick={(e) => onEdit("value", e.currentTarget)}
        >
          {picked.some((p) => p.choice?.icon) && (
            <span className="view-filter-icons">
              {picked.slice(0, 3).map((p) => p.choice?.icon && <span key={p.value}>{p.choice.icon}</span>)}
            </span>
          )}
          <span>{picked.length > 1 ? `${picked.length} ${plural(name.toLowerCase())}` : picked[0] ? labelOf(picked[0]) : ""}</span>
        </button>
      )}
      <button className="view-filter-segment view-filter-remove" aria-label={`Remove ${c.field} filter`} onClick={remove}>
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

/** A chip's value list. Its own component so only an open value menu subscribes to the issues (for the counts). */
function ChipValues({ rule, board, toggle }: { rule: Rule; board: Board; toggle: (value: string) => void }) {
  const issues = useStore((s) => s.issues);
  const choices = useMemo(() => filterChoices(rule.field, board, [...issues.values()]), [rule.field, board, issues]);
  return (
    <Menu>
      <Menu.Input
        autoFocus
        aria-label={`Filter ${FIELDS.find(([f]) => f === rule.field)?.[1]}`}
        placeholder="Filter…"
      />
      <Menu.List maxHeight="300px">
        <Menu.Empty>No matches</Menu.Empty>
        {choices.map((c) => (
          <ValueRow
            key={c.value}
            choice={c}
            checked={rule.values.includes(c.value)}
            onSelect={() => toggle(c.value)}
          />
        ))}
      </Menu.List>
    </Menu>
  );
}

export function FilterChips({ board }: { board: Board }) {
  const { filters } = useViewSettings(board.id);
  // Inside the view editor these chips are the definition being edited; the editor owns Cancel/Save.
  const editing = useStore((s) => !!s.editorDraft);
  const [edit, setEdit] = useState<{
    rule: Rule;
    segment: "operator" | "value";
    anchor: HTMLElement;
  } | null>(null);
  const rule = filters.children.find(
    (c): c is Rule => !("children" in c) && c.id === edit?.rule.id,
  );
  const patch = (r: Rule, change: Partial<Rule>) => updateRule(board.id, r.id, change);
  const close = () => {
    if (rule && !rule.values.length && !["empty", "notEmpty"].includes(rule.op))
      updateRule(board.id, rule.id, null);
    setEdit(null);
  };
  const chips = filters.children.filter(
    (c) => !("children" in c) || filterCount(c),
  );
  if (!chips.length) return null;
  // Dates, numbers and text edit through PropertyFilter's operator form rather than a value list.
  const form =
    edit?.segment === "value" &&
    !!rule &&
    (isDate(rule.field) || isNumeric(rule.field) || ["content", "links"].includes(rule.field));
  return (
    <div className="view-filter-row" aria-label={editing ? "View filters" : "Temporary filters"}>
      {edit && rule && (
        <MenuSurface
          label={`${FIELDS.find(([f]) => f === rule.field)?.[1]} ${edit.segment}`}
          anchor={edit.anchor}
          // The free-value form keeps its 248px; the operator and value lists are content-sized menus.
          fit={!form}
          width={248}
          close={close}
        >
          {edit.segment === "operator" ? (
            <Menu tabIndex={0} defaultValue={rule.op}>
              <Menu.List>
                {operatorsFor(rule.field).map(([op, label]) => (
                  <Menu.Item
                    key={op}
                    value={op}
                    checked={rule.op === op}
                    onSelect={() => {
                      patch(rule, {
                        op,
                        values: ["empty", "notEmpty"].includes(op)
                          ? []
                          : rule.values,
                      });
                      setEdit(
                        !rule.values.length &&
                          !["empty", "notEmpty"].includes(op)
                          ? { ...edit, segment: "value" }
                          : null,
                      );
                    }}
                  >
                    {label}
                  </Menu.Item>
                ))}
              </Menu.List>
            </Menu>
          ) : form ? (
            <PropertyFilter
              inline
              field={rule.field}
              name={FIELDS.find(([f]) => f === rule.field)?.[1] ?? rule.field}
              board={board}
              onBack={close}
            />
          ) : (
            <ChipValues
              rule={rule}
              board={board}
              toggle={(value) =>
                patch(rule, {
                  values: rule.values.includes(value)
                    ? rule.values.filter((v) => v !== value)
                    : [...rule.values, value],
                })
              }
            />
          )}
        </MenuSurface>
      )}
      <div className="view-filter-chips">
      {filters.join === "or" && chips.length > 1 && (
        <Button variant="muted" size="small" onClick={() => ui.send({ type: "toolbar.open", toolbar: "advanced" })}>
          Any of
        </Button>
      )}
      {chips.map((c) => {
        const remove = () => updateRule(board.id, c.id, null);
        if ("children" in c)
          return (
            <div key={c.id} className="view-filter-chip" onKeyDown={removeOnKey(remove)}>
              <button className="view-filter-segment" onClick={() => ui.send({ type: "toolbar.open", toolbar: "advanced" })}>
                <span>{`${c.join.toUpperCase()} group · ${filterCount(c)} rule${filterCount(c) === 1 ? "" : "s"}`}</span>
              </button>
              <button className="view-filter-segment view-filter-remove" aria-label="Remove filter group" onClick={remove}>
                <Icon name="x" size={12} />
              </button>
            </div>
          );
        return (
          <RuleChip
            key={c.id}
            rule={c}
            board={board}
            open={edit?.rule.id === c.id ? edit.segment : null}
            onEdit={(segment, anchor) => setEdit({ rule: c, segment, anchor })}
            remove={remove}
          />
        );
      })}
      <AddFilterButton
        board={board}
        menu="add-filter"
        placement="bottom-left"
        label="Add another filter"
        variant="borderless"
        size="small"
        className="view-filter-add"
      >
        <Icon name="plus" />
      </AddFilterButton>
      </div>
      {!editing && <FilterSaveActions board={board} />}
    </div>
  );
}

/** Save/create state belongs to this menu instance, independently of chip editing. */
function FilterSaveActions({ board }: { board: Board }) {
  const view = useActiveView();
  const overlay = useOverlayFilters();
  const mergeable = !view || canMergeOverlay(view.filters, overlay);
  const [saveAnchor, setSaveAnchor] = useState<HTMLElement | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveOverlayToView();
      setSaveAnchor(null);
    } catch {
      ui.send({ type: "toast.show", text: "Could not save view. Try again." });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="view-filter-actions">
        <Button variant="borderless" size="small" onClick={() => clearFilters(board.id)}>
          Clear
        </Button>
        <Button
          variant="secondary"
          size="small"
          className="view-filter-save"
          aria-haspopup="dialog"
          aria-expanded={!!saveAnchor}
          onClick={(e) => setSaveAnchor(e.currentTarget)}
        >
          Save
        </Button>
      </div>
      {saveAnchor && (
        <MenuSurface
          label="Save filters"
          anchor={saveAnchor}
          align="end"
          fit
          close={() => setSaveAnchor(null)}
        >
          <Menu
            tabIndex={0}
            onKeyDownCapture={(event) => {
              const id = viewShortcutId(event);
              if (id === "view-create" || (id === "view-save" && view && mergeable)) {
                event.preventDefault();
                event.stopPropagation();
                if (id === "view-save") void save();
                else {
                  setSaveAnchor(null);
                  createToolbarView();
                }
              }
            }}
          >
            <Menu.List>
              {view && (
                <Menu.Item
                  value="save"
                  disabled={saving || !mergeable}
                  title={mergeable ? undefined : "Cannot merge these filters into the view"}
                  description={mergeable ? undefined : "Cannot merge these filters into the view"}
                  hint="⌥S"
                  onSelect={() => void save()}
                >
                  Save to this view
                </Menu.Item>
              )}
              <Menu.Item
                value="create"
                hint="⌥V"
                onSelect={() => {
                  setSaveAnchor(null);
                  createToolbarView();
                }}
              >
                Create new view…
              </Menu.Item>
            </Menu.List>
          </Menu>
        </MenuSurface>
      )}
    </>
  );
}

function AdvancedMenu({ board }: { board: Board }) {
  const preferences = useViewSettings(board.id);
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
  const patch = (id: string, change: Parameters<typeof updateRule>[2]) =>
    timed("filter", () => updateRule(board.id, id, change));
  return (
    <div
      role="dialog"
      aria-label="Advanced filter"
      className={`${POPUP} w-[640px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}
    >
      <div className="mb-3 flex items-center justify-between">
        <Text variant="smallPlus">Advanced filter</Text>
        <IconButton label="Close advanced filter" variant="muted" size="small" onClick={() => ui.send({ type: "toolbar.close" })}>
          <Icon name="close" />
        </IconButton>
      </div>
      <FilterGroupEditor group={filters} board={board} issues={all} patch={patch} depth={0} />
      <PropertySyncNotice />
      <div className="mt-3 flex items-center justify-between border-t border-line-2 pt-3">
        <Text variant="mini" color="muted">
          {all.filter((i) => matchesFilters(i, filters, universe, ME.id)).length} matching issues in
          this view
        </Text>
        <Button size="small" onClick={() => ui.send({ type: "toolbar.close" })}>
          Done
        </Button>
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
  patch: (id: string, p: Parameters<typeof updateRule>[2]) => void;
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
          <IconButton label="Remove filter group" variant="muted" size="small" className="ml-auto" onClick={() => patch(group.id, null)}>
            <Icon name="close" />
          </IconButton>
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
      <div className="flex gap-1">
        <Button
          variant="muted"
          size="small"
          icon={<Icon name="plus" />}
          aria-label={depth === 0 ? "Add filter condition" : "Add group condition"}
          onClick={() =>
            patch(group.id, {
              children: [...group.children, { id: newId(), field: "status", op: "is", values: [] }],
            })
          }
        >
          Add filter
        </Button>
        {depth < 5 && (
          <Button
            variant="muted"
            size="small"
            icon={<Icon name="plus" />}
            aria-label={depth === 0 ? "Add filter group" : "Add nested filter group"}
            onClick={() =>
              patch(group.id, {
                children: [...group.children, { id: newId(), join: "or", children: [] }],
              })
            }
          >
            Add filter group
          </Button>
        )}
      </div>
    </div>
  );
}
/** The advanced editor's native <select>s keep index.css's `view-select`: there is no Select primitive yet. */
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
          <TextInput
            size="medium"
            className="min-w-24 flex-1"
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
            min={isNumeric(r.field) || ["within", "next"].includes(r.op) ? 0 : undefined}
            onChange={(e) => patch({ values: e.target.value ? [e.target.value] : [] })}
            placeholder={r.field === "statusAge" ? "Days…" : "Value…"}
          />
        ) : (
          <div className="min-w-32 flex-1 space-y-1">
            {r.values.map((v) => (
              <Button
                key={v}
                variant="secondary"
                size="small"
                className="mr-1"
                title="Remove value"
                onClick={() => patch({ values: r.values.filter((x) => x !== v) })}
              >
                {choices.find((c) => c.value === v)?.label ?? v}
                <Icon name="x" size={12} />
              </Button>
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
      {Number(r.values[0]) < 0 && (isNumeric(r.field) || ["within", "next"].includes(r.op)) && (
        <span role="alert" className="self-center text-[11px] text-red-500">
          Use 0 or more
        </span>
      )}
      <IconButton label="Remove condition" variant="muted" onClick={() => patch(null)}>
        <Icon name="close" />
      </IconButton>
    </div>
  );
}

function PropertySyncNotice() {
  const progress = useStore((s) => s.propertySync);
  if (!progress.pending && !progress.errors) return null;
  return (
    <Text as="div" role="status" variant="micro" color="muted" className="border-t border-line-2 px-2 py-2">
      {progress.pending
        ? `Loading Jira properties… ${progress.completed} / ${progress.total}. Results update as data arrives.`
        : `Some Jira properties could not be read on ${progress.errors} issues. Restricted watcher lists are excluded from subscriber filters.`}
    </Text>
  );
}
