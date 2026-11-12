import { useState, type ComponentType } from "react";

// Keeps its own markup: the issue composer's chips live in a chunk (FastIssueCreateEditor) missing from the bundle, so there
// is no PropertyTrigger `composer` geometry to move them to.
export const PILL_SELECT =
  "flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-line-2 bg-card px-2 text-[12px] text-fg-2 hover:bg-hover";

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
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={className}
      >
        <span className="truncate">{current}</span>
      </button>
      {anchor && <FieldMenu {...menuProps} anchor={anchor} close={() => setAnchor(null)} />}
    </>
  );
}
