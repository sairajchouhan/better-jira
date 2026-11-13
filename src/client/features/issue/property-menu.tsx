import { type Board, type Issue, type User } from "@/shared/issue-model";
import { lazy, Suspense, use, useEffect, useState } from "react";
import { Avatar } from "@/client/components/avatar";
import { Icon, PriorityIcon, StatusIcon, TypeDot, hue } from "@/client/components/icons";
import {
  labelSections,
  priorityChoices,
  projectChoices,
  milestoneChoices,
  statuses,
} from "@/shared/board-catalog";
import { useStore, useAssignableUsers } from "@/client/state/store";
import { hotkeyOf } from "@/client/features/navigation/shortcuts";
import { Button } from "@/client/components/button";
import { LoadingState } from "@/client/components/empty-state";
import { kept, useCommand } from "@/client/features/navigation/commands";
import { duePresets, shortDate } from "@/client/lib/due-date";
import { MenuSurface as Modal } from "@/client/components/menu-surface";
const DateInput = lazy(() => import("./date-input").then((m) => ({ default: m.DateInput })));
import type { ReactNode } from "react";
import { Menu } from "@/client/components/menu";
import { MenuSurface, MenuSurfaceContext } from "@/client/components/menu-surface";
import { CheckRow } from "@/client/components/action-menu";
import { actions } from "@/client/state/issue-actions";
import { CommandMenu, useCommandTarget } from "@/client/components/command-menu";

/** Linear's property menu (RAJ-52 status, priority, assignee and labels): 208px wide beside the open issue's property button, a 36px
 *  filter with the key that opens it at its right, rows 6px below. Inside a `CommandTarget` (a shortcut over a card or row) the same
 *  menu is Linear's command menu on that issue instead (ISSUE-11). With an empty filter, a row's number key picks it, as in Linear. */
export function PropertyMenu({
  label,
  placeholder,
  hotkey,
  anchor,
  close,
  current,
  query,
  onQuery,
  side,
  onKeyDown,
  children,
}: {
  label: string;
  placeholder: string;
  /** The registry chord that opens this menu, drawn at the input's right. */
  hotkey?: string | readonly string[];
  anchor: HTMLElement | null;
  close: () => void;
  current?: string;
  query?: string;
  onQuery?: (value: string) => void;
  side?: "left";
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const target = useCommandTarget();
  const menu = (
    <Menu
      defaultValue={current}
      style={target ? undefined : { width: 206 }}
      onKeyDown={onKeyDown}
    >
      <Menu.Input
        autoFocus
        placeholder={placeholder}
        aria-label={placeholder}
        hotkey={target ? undefined : hotkey}
        value={query}
        onValueChange={onQuery}
      />
      <Menu.List maxHeight="min(400px,calc(100vh - 80px))">
        <Menu.Empty>No results</Menu.Empty>
        {children}
      </Menu.List>
    </Menu>
  );
  return target ? (
    <CommandMenu label={label} issue={target} close={close}>
      {menu}
    </CommandMenu>
  ) : (
    <MenuSurface label={label} anchor={anchor} close={close} fit gap={4.5} side={side}>
      {menu}
    </MenuSurface>
  );
}

/** One choice: its icon, name, a check when it is the current value, and its number key. */
export function PickerRow({
  value,
  icon,
  current,
  number,
  hint = number,
  keywords,
  onSelect,
  children,
}: {
  value: string;
  icon?: ReactNode;
  current?: boolean;
  number?: number;
  /** Trailing text; the number key by default. */
  hint?: ReactNode;
  keywords?: string[];
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Menu.Item
      value={value}
      keywords={keywords}
      data-number={number}
      icon={icon}
      checked={current}
      hint={hint}
      onSelect={onSelect}
    >
      {children}
    </Menu.Item>
  );
}

export type FieldMenuProps<T> = {
  anchor: HTMLElement | null;
  board: Board | undefined;
  value: T;
  onChange: (value: T) => void;
  close: () => void;
};
function useCatalog(board: Board | undefined) {
  const all = useStore((s) => s.issues);
  const options = useStore((s) => s.options);
  const writable = useStore((s) => s.writable);
  return {
    issues: [...all.values()].filter((i) => i.board === board?.id),
    options,
    writable,
  };
}
export function StatusMenu({ anchor, board, value, onChange, close }: FieldMenuProps<string>) {
  return (
    <PropertyMenu
      label="Change status"
      placeholder="Change status…"
      hotkey="S"
      anchor={anchor}
      close={close}
      current={statuses(board).find((s) => s.id === value)?.name}
    >
      {board?.columns
        .flatMap((c) => c.statuses.map((s) => ({ ...s, column: c.name })))
        .map((s, i) => (
          <PickerRow
            key={s.id}
            value={s.name}
            keywords={[s.column]}
            icon={<StatusIcon status={s} />}
            current={value === s.id}
            number={i < 9 ? i + 1 : undefined}
            onSelect={() => {
              onChange(s.id);
              close();
            }}
          >
            {s.name}
          </PickerRow>
        ))}
    </PropertyMenu>
  );
}
export function AssigneeMenu({ anchor, value, onChange, close }: FieldMenuProps<User | null>) {
  const users = useAssignableUsers();
  const key = (u: User) => `${u.name} ${u.id}`;
  return (
    <PropertyMenu
      label="Assign issue"
      placeholder="Assign to…"
      hotkey="A"
      anchor={anchor}
      close={close}
      current={value ? key(value) : "No assignee"}
    >
      <PickerRow
        value="No assignee"
        icon={<Avatar user={null} size={16} />}
        current={!value}
        number={0}
        onSelect={() => {
          onChange(null);
          close();
        }}
      >
        No assignee
      </PickerRow>
      {users.map((u, i) => (
        <PickerRow
          key={u.id}
          value={key(u)}
          icon={<Avatar user={u} size={16} />}
          current={value?.id === u.id}
          number={i < 9 ? i + 1 : undefined}
          onSelect={() => {
            onChange(u);
            close();
          }}
        >
          {u.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
export function PriorityMenu({
  anchor,
  board,
  value,
  onChange,
  close,
  empty = "No priority",
}: FieldMenuProps<string> & {
  /** The unset row's text: Linear's "No priority" (BJ-72; Jira gets `priority: null`), a draft's "Default priority". */
  empty?: string;
}) {
  const { options, issues, writable } = useCatalog(board);
  const choices = ["", ...priorityChoices(options, issues, writable)];
  return (
    <PropertyMenu
      label="Set priority"
      placeholder="Change priority to…"
      hotkey="P"
      anchor={anchor}
      close={close}
      current={value || empty}
    >
      {choices.map((p, i) => (
        <PickerRow
          key={p}
          value={p || empty}
          icon={<PriorityIcon name={p || undefined} />}
          current={p === value}
          number={i}
          onSelect={() => {
            onChange(p);
            close();
          }}
        >
          {p || empty}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
export function TypeMenu({
  anchor,
  value,
  onChange,
  close,
  choices,
}: FieldMenuProps<string> & { choices: string[] }) {
  return (
    <PropertyMenu
      label="Change issue type"
      placeholder="Change issue type to…"
      hotkey={hotkeyOf("type")}
      anchor={anchor}
      close={close}
      current={value}
    >
      {choices.map((t) => (
        <PickerRow
          key={t}
          value={t}
          icon={<TypeDot type={t} />}
          current={t === value}
          onSelect={() => {
            onChange(t);
            close();
          }}
        >
          {t}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
export function ProjectMenu({
  anchor,
  board,
  value,
  onChange,
  close,
  choices: restricted,
}: FieldMenuProps<Issue["project"]> & {
  choices?: NonNullable<Issue["project"]>[];
}) {
  const { issues, writable } = useCatalog(board);
  const choices = restricted ?? projectChoices(issues);
  return (
    <PropertyMenu
      label="Change project"
      placeholder="Change project…"
      anchor={anchor}
      close={close}
      current={value?.name ?? "No project"}
    >
      {!writable && (
        <PickerRow
          value="No project"
          current={!value}
          icon={<Icon name="layers" />}
          onSelect={() => {
            onChange(null);
            close();
          }}
        >
          No project
        </PickerRow>
      )}
      {choices.map((p) => (
        <PickerRow
          key={p.key}
          value={p.name}
          current={p.key === value?.key}
          icon={<Icon name="layers" />}
          onSelect={() => {
            onChange(p);
            close();
          }}
        >
          {p.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
export function MilestoneMenu({
  anchor,
  board,
  value,
  onChange,
  close,
  project,
}: FieldMenuProps<NonNullable<Issue["milestones"]>> & { project?: string }) {
  const { issues, options } = useCatalog(board);
  return (
    <PropertyMenu
      label="Set milestone"
      placeholder="Set milestone…"
      anchor={anchor}
      close={close}
      current={value[0]?.name ?? "No milestone"}
    >
      <PickerRow
        value="No milestone"
        current={!value.length}
        icon={<Icon name="calendar" />}
        onSelect={() => {
          onChange([]);
          close();
        }}
      >
        No milestone
      </PickerRow>
      {milestoneChoices(options, issues, project).map((m) => (
        <PickerRow
          key={m.id}
          value={m.name}
          current={value.some((v) => v.id === m.id)}
          icon={<Icon name="calendar" />}
          onSelect={() => {
            onChange([m]);
            close();
          }}
        >
          {m.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
/**
 * The label checkbox rows (Linear's labels action, multiSelectSubActions): the labels on the issue first, as the menu opened, or with
 * none "Frequently used"; then "Workspace labels", then "Create new label" for a new name. One component for the L picker and Issue options › Labels.
 */
export function LabelRows({
  board,
  value,
  onChange,
  query,
}: Omit<FieldMenuProps<string[]>, "anchor" | "close"> & { query: string }) {
  const { issues, options } = useCatalog(board);
  const surface = use(MenuSurfaceContext);
  // Sections are fixed as the menu opens, so a row never jumps while you toggle it.
  const [order] = useState(() => labelSections(issues, options.labels, value));
  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((l) => l !== name) : [...value, name]);
  const row = (name: string) => (
    <CheckRow
      key={name}
      value={name}
      data-label={name}
      checked={value.includes(name)}
      checkboxLabel={`${value.includes(name) ? "Remove" : "Add"} label ${name}`}
      onToggle={() => toggle(name)}
      icon={<span className="size-[9px] rounded-full" style={{ background: hue(name) }} />}
    >
      {name}
    </CheckRow>
  );
  // Jira labels can't contain spaces: a new label joins its words with hyphens (R2-issue-fields-D5).
  const created = query.trim().replace(/\s+/g, "-");
  const all = [...order.selected, ...order.frequent, ...order.rest];
  const exact = all.some((l) => l.toLowerCase() === created.toLowerCase());
  const above = order.selected.length > 0 || order.frequent.length > 0;
  return (
    <>
      {order.selected.map(row)}
      {order.selected.length > 0 && order.frequent.length > 0 && <Menu.Divider />}
      {order.frequent.length > 0 && <Menu.Group heading="Frequently used">{order.frequent.map(row)}</Menu.Group>}
      {above && order.rest.length > 0 && <Menu.Divider />}
      {above && order.rest.length > 0 ? (
        <Menu.Group heading="Workspace labels">{order.rest.map(row)}</Menu.Group>
      ) : (
        order.rest.map(row)
      )}
      {query.trim() && !exact && (
        <Menu.Item
          value={`Create ${query}`}
          icon={<Icon name="plus" size={14} />}
          // Like Enter on an existing label: apply it and close, so the menu never shows a list without it.
          onSelect={() => {
            toggle(created);
            surface?.close();
          }}
        >
          Create new label: "{created}"
        </Menu.Item>
      )}
    </>
  );
}
/** Issue options › Labels: LabelRows on the issue's live labels, so a checkbox reflects each toggle while the menu stays open. */
export function IssueLabelRows({ issue, query }: { issue: string; query: string }) {
  const labels = useStore((s) => s.issues.get(issue)?.labels) ?? [];
  const board = useStore((s) => s.boards.find((b) => b.id === s.issues.get(issue)?.board));
  return (
    <LabelRows
      board={board}
      value={labels}
      onChange={(next) => actions.patch(issue, { labels: next })}
      query={query}
    />
  );
}
export function LabelsMenu({ anchor, board, value, onChange, close }: FieldMenuProps<string[]>) {
  const [query, setQuery] = useState("");
  return (
    <PropertyMenu
      label="Change labels"
      placeholder={value.length ? "Change or add labels…" : "Add labels…"}
      hotkey="L"
      anchor={anchor}
      // Linear's label badges open `horizontal-left`, in the issue's properties and on a card's badge row alike.
      side={anchor?.closest("[data-properties], [data-badges]") ? "left" : undefined}
      close={close}
      query={query}
      onQuery={setQuery}
    >
      <LabelRows board={board} value={value} onChange={onChange} query={query} />
    </PropertyMenu>
  );
}
/** The due-date rows (Linear's due action, recalculateOnInput): a typed date like "24h" or "Feb 9" first, then Custom…, the presets and,
 *  with a date set, Remove. One component for the Shift+D picker and Issue options › Due date. The parser (chrono) loads with it. */
export function DueRows({
  query,
  value,
  onPick,
  onCustom,
}: {
  query: string;
  value: string | null;
  onPick: (due: string | null) => void;
  onCustom: () => void;
}) {
  const [parseDue, setParseDue] = useState<typeof import("@/client/lib/due-parse").parseDueDate>();
  useEffect(() => {
    let active = true;
    void import("@/client/lib/due-parse").then(
      ({ parseDueDate }) => active && setParseDue(() => parseDueDate),
    );
    return () => {
      active = false;
    };
  }, []);
  const parsed = parseDue?.(query) ?? null;
  return (
    <>
      {parsed && (
        <PickerRow
          value={`Due ${query}`}
          keywords={[query]}
          icon={<Icon name="calendar" />}
          hint={shortDate(parsed)}
          onSelect={() => onPick(parsed)}
        >
          Due
        </PickerRow>
      )}
      <PickerRow value="Custom…" icon={<Icon name="calendar" />} onSelect={onCustom}>
        Custom…
      </PickerRow>
      {duePresets().map((preset) => (
        <PickerRow
          key={preset.name}
          value={preset.name}
          icon={<Icon name="calendar" />}
          current={value === preset.due}
          hint={shortDate(preset.due)}
          onSelect={() => onPick(preset.due)}
        >
          {preset.name}
        </PickerRow>
      ))}
      {value && (
        <PickerRow value="Remove due date" icon={<Icon name="close" />} onSelect={() => onPick(null)}>
          Remove due date
        </PickerRow>
      )}
    </>
  );
}
export function DueMenu({ anchor, value, onChange, close }: FieldMenuProps<string | null>) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(value ?? "");
  const [dateValid, setDateValid] = useState(true);
  const [custom, setCustom] = useState(() => kept("issue-options-start") === "due");
  useCommand("issue-options-start", (start) => {
    if (start !== "due") return;
    setCustom(true);
    return true;
  });
  if (!custom)
    // Linear (RAJ-61): a click or Enter applies at once; typed text like "24h" or "Feb 9" offers that date.
    return (
      <PropertyMenu
        label="Due date"
        placeholder="Try: 24h, 7 days, Feb 9"
        hotkey={hotkeyOf("due")}
        anchor={anchor}
        close={close}
        query={query}
        onQuery={setQuery}
      >
        <DueRows
          query={query}
          value={value}
          onPick={(due) => {
            onChange(due);
            close();
          }}
          onCustom={() => setCustom(true)}
        />
      </PropertyMenu>
    );
  return (
    <Modal label="Due date" close={close} anchor={anchor} width={360}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!dateValid) return;
          onChange(date || null);
          close();
        }}
      >
        <div className="mb-3">
          <Suspense fallback={<LoadingState>Loading dates…</LoadingState>}>
            <DateInput autoFocus value={date} onChange={setDate} onValidity={setDateValid} />
          </Suspense>
        </div>
        <div className="flex justify-end gap-2">
          {/* Borderless, as before: the bundle has no footer for this picker's custom-date form. */}
          <Button
            variant="borderless"
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            Remove due date
          </Button>
          <Button variant="borderless" type="submit" disabled={!dateValid}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
