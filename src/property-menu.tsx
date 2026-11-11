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
    <MenuSurface label={label} anchor={anchor} close={close} fit gap={4.5} side={side}>
      <Menu
        defaultValue={current}
        style={{ width: 206 }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;
          const input = event.target instanceof HTMLInputElement ? event.target : null;
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
        <Menu.Input autoFocus placeholder={placeholder} hotkey={hotkey} value={query} onValueChange={onQuery} />
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
