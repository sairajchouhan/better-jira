import { type Issue, type Board } from "@/shared/issue-model";
import { showNotification } from "@/client/state/app-notifications";
import { useActiveView, useOverlayFilters, saveOverlayToView } from "./saved-views";
import { clearFilters, resetDisplay, setDisplay, updateRule, useViewSettings } from "./view-settings";
import { canMergeOverlay } from "@/shared/saved-view-model";
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
import { MenuSurface, POPOVER_SURFACE, Popover } from "@/client/components/menu-surface";
import { dateValueLabel, filterChoices, plural, PropertyFilter, useFilterCatalog } from "@/client/features/filters/property-filter";
import { Menu } from "@/client/components/menu";
import { FilterBar, FilterBlock, type OpenedBy } from "@/client/components/filter-block";
import { FilterOperatorMenu } from "@/client/features/filters/filter-operator-menu";
import { Select } from "@/client/components/select";
import { DisplayProperties, SelectRow, Toggle, ViewOptions } from "@/client/components/display-options";
import { GroupOrdering } from "./group-ordering";
import { Icon } from "@/client/components/icons";
import { Button, IconButton, type ButtonSize, type ButtonVariant } from "@/client/components/button";
import { TextInput } from "@/client/components/field";
import { Text } from "@/client/components/text";
import { LoadingState } from "@/client/components/empty-state";
import { hotkeyOf } from "@/client/features/navigation/shortcuts";
import { shortcutTitle, type Keys } from "@/client/components/keycap";
import { GROUPING_ACTION, ORDERING_ACTION, groupingOptions } from "./view-choices";
import { shortDate } from "@/client/lib/due-date";
import { ME, timed, useStore } from "@/client/state/store";
import { ui } from "@/client/features/navigation/app-navigation";
import { saveDefault } from "./view-settings";
import {
  canOrderGroups,
  defaultDisplay,
  defaultPreferences,
  hasDisplayChanges,
  sameDisplay,
  filterCount,
  FIELDS,
  GROUPINGS,
  isDate,
  isNumeric,
  matchesFilters,
  newId,
  operatorLabel,
  operatorsFor,
  ORDERINGS,
  PROPERTIES,
  selectIssues,
  type Display,
  type Field,
  type FilterGroup,
  type Rule,
} from "@/shared/view-model";

type FilterMenuModule = typeof import("@/client/features/filters/filter-menu");
let filterMenu: FilterMenuModule | undefined;
const loadFilterMenu = () => import("@/client/features/filters/filter-menu").then((m) => (filterMenu = m));
// Preloaded after first paint; a loaded module resolves `lazy` synchronously, so the first F skips the Suspense round trip (R2-D6).
const FilterMenu = lazy(
  () =>
    (filterMenu
      ? // A native promise resolves a tick later, so lazy would still suspend; React only calls `then`.
        // oxlint-disable-next-line unicorn/no-thenable
        { then: (done: (m: FilterMenuModule) => void) => done(filterMenu!) }
      : loadFilterMenu()) as Promise<FilterMenuModule>,
);

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
  tooltip,
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
  /** Hover text when it differs from the name: the toolbar's "Add filter" shows "Filter (F)", as Linear's does. */
  tooltip?: string;
  shortcut?: Keys;
  variant: ButtonVariant;
  size: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  const open = useStore((s) => s.toolbar === menu);
  // A click opens the menu pristine, as Linear's pointer opens do; F and a keyboard press (detail 0) highlight the first row.
  const [byPointer, setByPointer] = useState(false);
  if (!open && byPointer) setByPointer(false);
  const own = useRef<HTMLButtonElement>(null);
  const trigger = triggerRef ?? own;
  const popup = useRef<HTMLDivElement>(null);
  return (
    <>
      <IconButton
        ref={trigger}
        label={label}
        tooltip={tooltip}
        shortcut={shortcut}
        variant={variant}
        size={size}
        aria-expanded={expanded ?? open}
        onPointerEnter={() => void loadFilterMenu()}
        onFocus={() => void loadFilterMenu()}
        onClick={(event) => {
          setByPointer(!open && event.detail > 0);
          ui.send({ type: "toolbar.toggle", toolbar: menu });
        }}
        className={className}
      >
        {children}
      </IconButton>
      {open && (
        <Popover trigger={trigger} placement={placement} popup={popup} close={closeToolbar}>
          <Suspense
            fallback={
              <div className="filter-menu w-[248px] p-3">
                <LoadingState>Opening filters…</LoadingState>
              </div>
            }
          >
            <FilterMenu
              key={board.id}
              board={board}
              container={popup}
              footer={<PropertySyncNotice />}
              // Submenus open away from the trigger's edge: right of the chip row's "+", left of the toolbar button.
              side={placement === "bottom-left" ? "right" : "left"}
              openedBy={byPointer ? "pointer" : "keyboard"}
              onAdvanced={openAdvanced}
            />
          </Suspense>
        </Popover>
      )}
    </>
  );
}

export function BoardControls({ board }: { board: Board }) {
  const toolbar = useStore((s) => s.toolbar);
  const preferences = useViewSettings(board.id);
  const displayChanged = useDisplayChanged(board.id);
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
        tooltip={count ? undefined : "Filter"}
        shortcut={count ? undefined : hotkeyOf("filter")}
        variant="secondary"
        size="medium"
      >
        <Icon name="filter" />
      </AddFilterButton>
      <IconButton
        ref={displayRef}
        label="Display options"
        shortcut={hotkeyOf("display")}
        variant="secondary"
        size="medium"
        aria-expanded={toolbar === "display"}
        onClick={() => ui.send({ type: "toolbar.toggle", toolbar: "display" })}
      >
        <Icon name="display" />
        {displayChanged && (
          <span className="absolute top-0 right-0 size-1.5 rounded-full bg-accent" />
        )}
      </IconButton>
      {toolbar === "display" && (
        <ViewOptions.Popover label="Display options" trigger={displayRef} close={closeToolbar}>
          <DisplayMenu board={board} />
        </ViewOptions.Popover>
      )}
      {toolbar === "advanced" && (
        <Popover trigger={filterRef} placement="bottom-right" popup={popup} close={closeToolbar}>
          <AdvancedMenu board={board} />
        </Popover>
      )}
    </>
  );
}

/** The toolbar's dot and the Reset footer. On a board, whether there is anything Reset clears (against the saved default);
 *  a saved view keeps its hidden groups and order as its own, so there only a display unlike the view's counts. */
function useDisplayChanged(boardId: Board["id"]) {
  const view = useActiveView();
  const settings = useViewSettings(boardId);
  const savedDefault = useStore((s) => s.defaults[boardId]);
  return view
    ? !sameDisplay(settings.display, view.display)
    : hasDisplayChanges(settings, savedDefault ?? defaultDisplay());
}

const LAYOUTS = [
  { value: "list", label: "List", icon: <Icon name="list" size={14} /> },
  { value: "board", label: "Board", icon: <Icon name="board" size={14} /> },
] as const;

const COMPLETED_ISSUES = [
  ["all", "All"],
  ["day", "Past day"],
  ["week", "Past week"],
  ["month", "Past month"],
  ["none", "None"],
] as const;

const NESTED = [
  ["matching", "Show matching"],
  ["all", "Show all"],
  ["none", "Don't nest"],
] as const;

const OPEN_IN = [
  ["side", "Side panel"],
  ["page", "Full page"],
] as const;

/**
 * Linear's ViewOptions panel (`qxr`), inside ViewOptions.Popover: layout tabs and grouping/ordering, then sub-issues,
 * then the layout's options, each a Content section, with the footer only while the display differs from its default.
 * Group ordering opens its page in place of these sections; Back returns to them, with focus on its button again.
 */
function DisplayMenu({ board }: { board: Board }) {
  const [page, setPage] = useState<"options" | "group-ordering" | "back">("options");
  const { display: d } = useViewSettings(board.id);
  if (page === "group-ordering")
    return <GroupOrdering board={board.id} by={d.columns} onBack={() => setPage("back")} />;
  return <DisplayOptions board={board} openGroupOrdering={() => setPage("group-ordering")} returned={page === "back"} />;
}

function DisplayOptions({
  board,
  openGroupOrdering,
  returned,
}: {
  board: Board;
  openGroupOrdering: () => void;
  /** Back from Group ordering: its button takes focus again. */
  returned: boolean;
}) {
  const { display: d } = useViewSettings(board.id);
  // Saved views and the view editor own their display, so the board-default footer stays out (Linear).
  const inView = useStore((s) => !!s.activeViewId || !!s.editorDraft);
  const changed = useDisplayChanged(board.id);
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<Display>) => timed("display", () => setDisplay(board.id, p));
  const isBoard = d.layout === "board";
  return (
    <>
      <ViewOptions.Content>
        <ViewOptions.LayoutTabs value={d.layout} layouts={LAYOUTS} onValueChange={(layout) => patch({ layout })} />
        <SelectRow
          label={isBoard ? "Columns" : "Grouping"}
          value={d.columns}
          options={groupingOptions(d.layout)}
          onChange={(v) => patch({ columns: v as Display["columns"] })}
          labelTip={shortcutTitle(GROUPING_ACTION.name, hotkeyOf("grouping"))}
        >
          {/* Linear's `Aat`: only a grouping whose groups can be custom-ordered offers Group ordering. */}
          {canOrderGroups(d.columns) && (
            <ViewOptions.SmallIconButton label="Group ordering" autoFocus={returned} onClick={openGroupOrdering}>
              <Icon name="group-order" />
            </ViewOptions.SmallIconButton>
          )}
        </SelectRow>
        <SelectRow
          label={isBoard ? "Rows" : "Sub-grouping"}
          value={d.rows}
          options={GROUPINGS.filter(([v]) => v === "none" || v !== d.columns)}
          onChange={(v) => patch({ rows: v as Display["rows"] })}
        />
        <SelectRow
          label="Ordering"
          value={d.ordering}
          options={ORDERINGS}
          onChange={(v) => patch({ ordering: v as Display["ordering"] })}
          labelTip={shortcutTitle(ORDERING_ACTION.name, hotkeyOf("ordering"))}
        >
          <ViewOptions.SmallIconButton
            label="Reverse issue order"
            tooltip="Direction"
            onClick={() => patch({ descending: !d.descending })}
          >
            {/* Linear's Direction glyphs: an arrow up beside shrinking bars when ascending (our table menu's sort-desc). */}
            <Icon name={d.descending ? "sort-asc" : "sort-desc"} />
          </ViewOptions.SmallIconButton>
        </SelectRow>
        <Toggle
          label="Order completed by recency"
          value={d.completedRecency}
          onChange={() => patch({ completedRecency: !d.completedRecency })}
        />
      </ViewOptions.Content>
      <ViewOptions.Content>
        <SelectRow
          label="Completed issues"
          value={d.completedIssues}
          options={COMPLETED_ISSUES}
          onChange={(v) => patch({ completedIssues: v as Display["completedIssues"] })}
        />
        <Toggle label="Show sub-issues" value={d.subIssues} onChange={() => patch({ subIssues: !d.subIssues })} />
      </ViewOptions.Content>
      <ViewOptions.Content>
        <ViewOptions.SectionLabel>{isBoard ? "Board" : "List"} options</ViewOptions.SectionLabel>
        {!isBoard && (
          <SelectRow
            label="Nested sub-issues"
            value={d.nested}
            options={NESTED}
            onChange={(v) => patch({ nested: v as Display["nested"] })}
          />
        )}
        <Toggle
          label={isBoard ? "Show empty columns" : "Show empty groups"}
          value={d.emptyGroups}
          onChange={() => patch({ emptyGroups: !d.emptyGroups })}
        />
        <DisplayProperties
          properties={PROPERTIES.filter(([p]) => !isBoard || p !== "creator")}
          shown={d.properties}
          onChange={(properties) => patch({ properties })}
        />
      </ViewOptions.Content>
      <PropertySyncNotice />
      <ViewOptions.Content>
        <SelectRow
          label="Open issues in"
          value={d.openIn}
          options={OPEN_IN}
          onChange={(v) => patch({ openIn: v as Display["openIn"] })}
        />
      </ViewOptions.Content>
      {!inView && changed && (
        <ViewOptions.Footer>
          <Button variant="borderless" size="small" title="Reset to your default" onClick={() => resetDisplay(board.id)}>
            Reset
          </Button>
          <Button
            variant="borderless"
            size="small"
            disabled={saving}
            title="Save your view as your default in this browser"
            onClick={async () => {
              setSaving(true);
              await saveDefault(board.id);
              setSaving(false);
            }}
          >
            <span className="ui-vo-footer-link">{saving ? "Saving…" : "Save my default"}</span>
          </Button>
        </ViewOptions.Footer>
      )}
    </>
  );
}

/**
 * One rule's FilterBlock: field, operator and values. Only a block with values subscribes to the issues, for their labels.
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
  onEdit: (segment: "operator" | "value", anchor: HTMLElement, openedBy: OpenedBy) => void;
  remove: () => void;
}) {
  const issues = useStore((s) => (c.values.length ? s.issues : null));
  const catalog = useFilterCatalog();
  const all = useMemo(
    () => (issues ? filterChoices(c.field, board, [...issues.values()], undefined, catalog) : []),
    [issues, c.field, board, catalog],
  );
  const name = FIELDS.find(([f]) => f === c.field)?.[1] ?? c.field;
  const picked = c.values.map((value) => ({ value, choice: all.find((v) => v.value === value) }));
  const labelOf = ({ value, choice }: (typeof picked)[number]) =>
    ["within", "next"].includes(c.op) || c.field === "statusAge"
      ? `${value} day${Number(value) === 1 ? "" : "s"}`
      : isDate(c.field)
        ? dateValueLabel(c.field, value, shortDate)
        : (choice?.label ?? value);
  return (
    <FilterBlock onRemove={remove}>
      <FilterBlock.Field>{name}</FilterBlock.Field>
      <FilterBlock.Operator
        label={`${c.field} operator`}
        expanded={open === "operator"}
        onOpen={(anchor, by) => onEdit("operator", anchor, by)}
      >
        {c.op === "within" ? "in the last" : c.op === "next" ? "in the next" : operatorLabel(c.field, c.op, c.values.length)}
      </FilterBlock.Operator>
      {!["empty", "notEmpty"].includes(c.op) && (
        <FilterBlock.Value
          label={`${c.field} value`}
          expanded={open === "value"}
          title={picked.length > 1 ? picked.map(labelOf).join(", ") : undefined}
          icons={picked.map((p) => p.choice?.icon)}
          onOpen={(anchor, by) => onEdit("value", anchor, by)}
        >
          {picked.length > 1 ? `${picked.length} ${plural(name.toLowerCase())}` : picked[0] ? labelOf(picked[0]) : ""}
        </FilterBlock.Value>
      )}
      <FilterBlock.Remove label={`Remove ${c.field} filter`} />
    </FilterBlock>
  );
}

export function ViewFilterBar({ board }: { board: Board }) {
  const { filters } = useViewSettings(board.id);
  // Inside the view editor these chips are the definition being edited; the editor owns Cancel/Save.
  const editing = useStore((s) => !!s.editorDraft);
  const [edit, setEdit] = useState<{
    rule: Rule;
    segment: "operator" | "value";
    anchor: HTMLElement;
    openedBy: OpenedBy;
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
    <FilterBar label={editing ? "View filters" : "Temporary filters"}>
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
            <FilterOperatorMenu
              name={rule.field}
              current={rule.op}
              operators={operatorsFor(rule.field, rule.values.length)}
              openedBy={edit.openedBy}
              pick={(op) => {
                patch(rule, { op, values: ["empty", "notEmpty"].includes(op) ? [] : rule.values });
                setEdit(
                  !rule.values.length && !["empty", "notEmpty"].includes(op) ? { ...edit, segment: "value" } : null,
                );
              }}
            />
          ) : (
            // The same value list as the Add-filter submenu: board-scoped counts, picked values first, the field as placeholder.
            <PropertyFilter
              ruleId={rule.id}
              inline
              field={rule.field}
              name={FIELDS.find(([f]) => f === rule.field)?.[1] ?? rule.field}
              board={board}
              onBack={close}
            />
          )}
        </MenuSurface>
      )}
      <FilterBar.Blocks>
      {filters.join === "or" && chips.length > 1 && (
        <Button variant="muted" size="small" onClick={() => ui.send({ type: "toolbar.open", toolbar: "advanced" })}>
          Any of
        </Button>
      )}
      {chips.map((c) => {
        const remove = () => updateRule(board.id, c.id, null);
        if ("children" in c)
          return (
            <FilterBlock key={c.id} onRemove={remove}>
              <FilterBlock.Value onOpen={openAdvanced}>
                {`${c.join.toUpperCase()} group · ${filterCount(c)} rule${filterCount(c) === 1 ? "" : "s"}`}
              </FilterBlock.Value>
              <FilterBlock.Remove label="Remove filter group" />
            </FilterBlock>
          );
        return (
          <RuleChip
            key={c.id}
            rule={c}
            board={board}
            open={edit?.rule.id === c.id ? edit.segment : null}
            onEdit={(segment, anchor, openedBy) => setEdit({ rule: c, segment, anchor, openedBy })}
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
        className="ui-filter-add"
      >
        <Icon name="plus" />
      </AddFilterButton>
      </FilterBar.Blocks>
      {!editing && <FilterSaveActions board={board} />}
    </FilterBar>
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
      showNotification({ text: "Could not save view. Try again." });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <FilterBar.Actions>
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
      </FilterBar.Actions>
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
                  shortcut={hotkeyOf("view-save")}
                  onSelect={() => void save()}
                >
                  Save to this view
                </Menu.Item>
              )}
              <Menu.Item
                value="create"
                shortcut={hotkeyOf("view-create")}
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
      className={`${POPOVER_SURFACE} w-[640px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-140px)] overflow-y-auto p-3`}
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
        <Select
          label={depth === 0 ? "Match conditions" : "Match group conditions"}
          size="medium"
          value={group.join}
          onValueChange={(join) => patch(group.id, { join: join as FilterGroup["join"] })}
        >
          <Select.Option value="and">all</Select.Option>
          <Select.Option value="or">any</Select.Option>
        </Select>
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
  const catalog = useFilterCatalog();
  const choices = useMemo(() => filterChoices(r.field, board, issues, undefined, catalog), [r.field, board, issues, catalog]);
  const free =
    isDate(r.field) || isNumeric(r.field) || r.field === "content" || r.field === "links";
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      <Select
        label="Filter property"
        size="medium"
        className="w-32"
        value={r.field}
        onValueChange={(v) => {
          const field = v as Field;
          patch({
            field,
            op: field === "content" || field === "links" ? "contains" : "is",
            values: [],
          });
        }}
      >
        {FIELDS.map(([v, l]) => (
          <Select.Option key={v} value={v}>
            {l}
          </Select.Option>
        ))}
      </Select>
      <Select
        label="Filter operator"
        size="medium"
        className="w-32"
        value={r.op}
        onValueChange={(op) => patch({ op: op as Rule["op"], values: [] })}
      >
        {operatorsFor(r.field, r.values.length).map(([v, l]) => (
          <Select.Option key={v} value={v}>
            {l}
          </Select.Option>
        ))}
      </Select>
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
            <Select
              label="Add filter value"
              size="medium"
              className="w-full"
              value=""
              placeholder="Select values…"
              onValueChange={(v) => patch({ values: [...r.values, v] })}
            >
              {choices
                .filter((c) => !r.values.includes(c.value))
                .map((c) => (
                  <Select.Option key={c.value} value={c.value} icon={c.icon}>
                    {c.label}
                  </Select.Option>
                ))}
            </Select>
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

/** Jira's property load under a menu or panel. It wraps to the width its menu already has and never widens it: `w-0 min-w-full`
 *  adds nothing to the menu's max-content width (R3-views-filters-D-6: the filter menu jumped from 206 to 356px, over an open submenu). */
export function PropertySyncNotice() {
  const progress = useStore((s) => s.propertySync);
  if (!progress.pending && !progress.errors) return null;
  return (
    <Text as="div" role="status" variant="micro" color="muted" className="w-0 min-w-full border-t-[length:var(--thin-pixel)] border-[var(--border-faint-thin)] px-2 py-2">
      {progress.pending
        ? `Loading Jira properties… ${progress.completed} / ${progress.total}. Results update as data arrives.`
        : `Some Jira properties could not be read on ${progress.errors} issues. Restricted watcher lists are excluded from subscriber filters.`}
    </Text>
  );
}
