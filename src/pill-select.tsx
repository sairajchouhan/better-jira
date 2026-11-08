import { Command } from "cmdk";
import { useState } from "react";
import { Icon } from "./icons";
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
        <MenuSurface label={label} anchor={anchor} width={220} close={() => setAnchor(null)}>
          <Command loop>
            <Command.Input
              autoFocus
              aria-label={`${label}…`}
              placeholder={`${label}…`}
              className="mb-1 w-full rounded-md border border-line-2 bg-card px-2 py-1.5 text-[12px] outline-none focus:border-accent"
            />
            <Command.List className="max-h-[300px] overflow-y-auto [&_[data-selected=true]]:bg-sel">
              <Command.Empty className="p-2 text-fg-3">No matches</Command.Empty>
              {options.map(([v, l]) => (
                <Command.Item
                  key={v}
                  value={`${l} ${v}`}
                  onSelect={() => {
                    onChange(v);
                    setAnchor(null);
                  }}
                  className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-[12px]"
                >
                  <span className="flex-1 truncate">{l}</span>
                  {v === value && <Icon name="check" />}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </MenuSurface>
      )}
    </>
  );
}
