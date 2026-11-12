import { useState, type ComponentProps, type ComponentType } from "react";

// Keeps its own markup: the issue composer's chips live in a chunk (FastIssueCreateEditor) missing from the bundle, so there
// is no PropertyTrigger `composer` geometry to move them to.
export const PILL_SELECT =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-card px-2 text-[12px] text-fg-2 hover:bg-hover";

/** A button that opens a field menu and owns only its anchor; the field menu owns choices, interaction and writes. */
export function FieldMenuButton<M extends { anchor?: HTMLElement | null; close?: () => void }>({
  menu: FieldMenu,
  menuProps,
  ...props
}: {
  menu: ComponentType<M>;
  menuProps: Omit<M, "anchor" | "close">;
} & Omit<ComponentProps<"button">, "onClick">) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        {...props}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      />
      {/* Field menus differ only in whether a missing anchor is null or undefined; it is always set here. */}
      {anchor && <FieldMenu {...({ ...menuProps, anchor, close: () => setAnchor(null) } as M)} />}
    </>
  );
}

/** A composer chip: the field's current value, named "<label>: <value>". */
export function PropertyPill<M extends { anchor?: HTMLElement | null; close?: () => void }>({
  label,
  current,
  className = PILL_SELECT,
  ...props
}: {
  label: string;
  current: string;
  className?: string;
} & Pick<ComponentProps<typeof FieldMenuButton<M>>, "menu" | "menuProps">) {
  return (
    <FieldMenuButton {...props} aria-label={`${label}: ${current}`} title={label} className={className}>
      <span className="truncate">{current}</span>
    </FieldMenuButton>
  );
}
