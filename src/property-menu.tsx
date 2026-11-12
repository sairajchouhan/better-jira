import { lazy, Suspense, useEffect, useState } from "react";
import { Avatar } from "./avatar";
import { Icon, PriorityIcon, StatusIcon, TypeDot, hue } from "./icons";
import {
  knownLabels,
  priorityChoices,
  projectChoices,
  milestoneChoices,
  statuses,
} from "./board-catalog";
import {
  useStore,
  useAssignableUsers,
  type Board,
  type Issue,
  type User,
} from "./store";
import { shortcutLabel } from "./shortcuts";
import { kept, useCommand } from "./commands";
import { duePresets, shortDate } from "./due-date";
import { MenuSurface as Modal } from "./menu-surface";
const DateInput = lazy(() =>
  import("./date-input").then((m) => ({ default: m.DateInput })),
);
const BUTTON =
  "rounded-md px-3 py-1.5 text-fg-2 hover:bg-hover disabled:opacity-40";
import type { ReactNode } from "react";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";

/** Linear's property menu (RAJ-52 status, priority, assignee and labels): 208px wide, a 36px filter with the key that opens it at its right,
 *  rows 6px below. With an empty filter, a row's number key picks it, as in Linear. */
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
  hotkey?: string;
  anchor: HTMLElement | null;
  close: () => void;
  current?: string;
  query?: string;
  onQuery?: (value: string) => void;
  side?: "left";
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  return (
    <MenuSurface
      label={label}
      anchor={anchor}
      close={close}
      fit
      gap={4.5}
      side={side}
    >
      <Menu
        defaultValue={current}
        style={{ width: 206 }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const input =
            event.target instanceof HTMLInputElement ? event.target : null;
          if (
            /^\d$/.test(event.key) &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            input &&
            !input.value
          ) {
            const row = event.currentTarget.querySelector<HTMLElement>(
              `[cmdk-item][data-number="${event.key}"]`,
            );
            if (row) {
              event.preventDefault();
              row.click();
            }
          }
        }}
      >
        <Menu.Input
          autoFocus
          placeholder={placeholder}
          hotkey={hotkey}
          value={query}
          onValueChange={onQuery}
        />
        <Menu.List maxHeight="min(400px,calc(100vh - 80px))">
          <Menu.Empty>No results</Menu.Empty>
          {children}
        </Menu.List>
      </Menu>
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
export function StatusMenu({
  anchor,
  board,
  value,
  onChange,
  close,
}: FieldMenuProps<string>) {
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
export function AssigneeMenu({
  anchor,
  value,
  onChange,
  close,
}: FieldMenuProps<User | null>) {
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
}: FieldMenuProps<string> & { empty?: string }) {
  const { options, issues, writable } = useCatalog(board);
  const choices = [
    ...(writable && empty !== "Default priority" ? [] : [""]),
    ...priorityChoices(options, issues, writable),
  ];
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
export function LabelsMenu({
  anchor,
  board,
  value,
  onChange,
  close,
}: FieldMenuProps<string[]>) {
  const { issues, options } = useCatalog(board);
  const [query, setQuery] = useState("");
  const [order] = useState(() => ({
    checked: [...value],
    rest: knownLabels(issues, options.labels).filter((l) => !value.includes(l)),
  }));
  const toggle = (name: string) =>
    onChange(
      value.includes(name) ? value.filter((l) => l !== name) : [...value, name],
    );
  const row = (name: string) => {
    const on = value.includes(name);
    return (
      <Menu.Item
        key={name}
        value={name}
        data-label={name}
        checkbox={on}
        checkboxLabel={`${on ? "Remove" : "Add"} label ${name}`}
        onCheckboxClick={() => toggle(name)}
        icon={
          <span
            className="size-[9px] rounded-full"
            style={{ background: hue(name) }}
          />
        }
        onSelect={() => {
          toggle(name);
          close();
        }}
      >
        {name}
      </Menu.Item>
    );
  };
  // Jira labels can't contain spaces: a new label joins its words with hyphens (R2-issue-fields-D5).
  const created = query.trim().replace(/\s+/g, "-");
  const exact = [...order.checked, ...order.rest].some(
    (l) => l.toLowerCase() === created.toLowerCase(),
  );
  return (
    <PropertyMenu
      label="Change labels"
      placeholder={value.length ? "Change or add labels…" : "Add labels…"}
      hotkey="L"
      anchor={anchor}
      side={anchor?.closest("[data-properties]") ? "left" : undefined}
      close={close}
      query={query}
      onQuery={setQuery}
      onKeyDown={(event) => {
        if (event.key !== " " || query) return;
        const name = event.currentTarget.querySelector<HTMLElement>(
          "[cmdk-item][data-selected=true]",
        )?.dataset.label;
        if (name) {
          event.preventDefault();
          toggle(name);
        }
      }}
    >
      {order.checked.map(row)}
      {order.checked.length > 0 && order.rest.length > 0 && <Menu.Divider />}
      {order.checked.length > 0 && order.rest.length > 0 ? (
        <Menu.Group heading="Workspace labels">
          {order.rest.map(row)}
        </Menu.Group>
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
            close();
          }}
        >
          Create new label: "{created}"
        </Menu.Item>
      )}
    </PropertyMenu>
  );
}
export function DueMenu({
  anchor,
  value,
  onChange,
  close,
}: FieldMenuProps<string | null>) {
  const [query, setQuery] = useState("");
  const [date, setDate] = useState(value ?? "");
  const [dateValid, setDateValid] = useState(true);
  const [custom, setCustom] = useState(
    () => kept("issue-options-start") === "due",
  );
  const [parseDue, setParseDue] =
    useState<typeof import("./due-parse").parseDueDate>();
  useEffect(() => {
    let active = true;
    void import("./due-parse").then(
      ({ parseDueDate }) => active && setParseDue(() => parseDueDate),
    );
    return () => {
      active = false;
    };
  }, []);
  useCommand("issue-options-start", (start) => {
    if (start !== "due") return;
    setCustom(true);
    return true;
  });
  if (!custom) {
    // Linear (RAJ-61): a click or Enter applies at once; typed text like "24h" or "Feb 9" offers that date.
    const parsed = parseDue?.(query) ?? null,
      apply = (due: string | null) => {
        onChange(due);
        close();
      };
    return (
      <PropertyMenu
        label="Due date"
        placeholder="Try: 24h, 7 days, Feb 9"
        hotkey={shortcutLabel("due")}
        anchor={anchor}
        close={close}
        query={query}
        onQuery={setQuery}
      >
        {parsed && (
          <PickerRow
            value={`Due ${query}`}
            keywords={[query]}
            icon={<Icon name="calendar" />}
            hint={shortDate(parsed)}
            onSelect={() => apply(parsed)}
          >
            Due
          </PickerRow>
        )}
        <PickerRow
          value="Custom…"
          icon={<Icon name="calendar" />}
          onSelect={() => setCustom(true)}
        >
          Custom…
        </PickerRow>
        {duePresets().map((preset) => (
          <PickerRow
            key={preset.name}
            value={preset.name}
            icon={<Icon name="calendar" />}
            current={value === preset.due}
            hint={shortDate(preset.due)}
            onSelect={() => apply(preset.due)}
          >
            {preset.name}
          </PickerRow>
        ))}
        {value && (
          <PickerRow
            value="Remove due date"
            icon={<Icon name="close" />}
            onSelect={() => apply(null)}
          >
            Remove due date
          </PickerRow>
        )}
      </PropertyMenu>
    );
  }
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
          <Suspense fallback={<p>Loading dates…</p>}>
            <DateInput
              autoFocus
              value={date}
              onChange={setDate}
              onValidity={setDateValid}
            />
          </Suspense>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              onChange(null);
              close();
            }}
          >
            Remove due date
          </button>
          <button className={BUTTON} type="submit" disabled={!dateValid}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
