import { useState, type ComponentType } from "react";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";

export const PILL_SELECT =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-card px-2 text-[12px] text-fg-2 hover:bg-hover";
/** Linear-style pill: shows the current choice and opens a searchable menu under it, replacing a native <select>. */
export function PillSelect({
  label,
  value,
  options,
  onChange,
  className = PILL_SELECT,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = options.find(([v]) => v === value)?.[1] ?? value;
  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${current}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        title={label}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={className}
      >
        <span className="truncate">{current}</span>
      </button>
      {anchor && (
        <MenuSurface
          label={label}
          anchor={anchor}
          fit
          close={() => setAnchor(null)}
        >
          {/* Opens on the current choice, like Linear, not the first option. */}
          <Menu defaultValue={`${current} ${value}`}>
            <Menu.Input
              autoFocus
              aria-label={`${label}…`}
              placeholder={`${label}…`}
            />
            <Menu.List maxHeight="300px">
              <Menu.Empty>No matches</Menu.Empty>
              {options.map(([v, l]) => (
                <Menu.Item
                  key={v}
                  value={`${l} ${v}`}
                  checked={v === value}
                  onSelect={() => {
                    onChange(v);
                    setAnchor(null);
                  }}
                >
                  {l}
                </Menu.Item>
              ))}
            </Menu.List>
          </Menu>
        </MenuSurface>
      )}
    </>
  );
}

/** A chip owns only its anchor; the field menu owns choices and interaction. */
export function PropertyPill<P>({
  label,
  current,
  menu: FieldMenu,
  menuProps,
  className = PILL_SELECT,
}: {
  label: string;
  current: string;
  menu: ComponentType<P & { anchor: HTMLElement | null; close: () => void }>;
  menuProps: P;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${current}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        title={label}
        className={className}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <span className="truncate">{current}</span>
      </button>
      {anchor && (
        <FieldMenu
          {...menuProps}
          anchor={anchor}
          close={() => setAnchor(null)}
        />
      )}
    </>
  );
}
