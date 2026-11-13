import { Icon } from "./icons";

/**
 * Linear's issue section header button (IssueSectionComponents `n`, used for Sub-issues, Customers and Resources): a
 * 24px pill with a muted caret and a miniPlus label. It takes `jv`'s borderless look but none of its
 * pressed fill, so an expanded section never looks selected. Geometry measured on RAJ-53: caret 7px and label 24px in.
 */
export function SectionDisclosure({
  label,
  expanded,
  onToggle,
}: {
  label: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${expanded ? "Collapse" : "Expand"} ${label.toLowerCase()} section`}
      aria-expanded={expanded}
      className="flex h-6 items-center gap-0.5 rounded-full pr-[13px] pl-1.5 text-[12px] font-medium text-fg-3 hover:bg-(--control-tertiary-hover)"
      onClick={onToggle}
    >
      <span className={`grid size-4 place-items-center ${expanded ? "rotate-90" : ""}`}>
        <Icon name="chevron" size={14} />
      </span>
      <span>{label}</span>
    </button>
  );
}
