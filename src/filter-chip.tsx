import type { ComponentProps } from "react";
import { Icon } from "./icons";
import "./control-tokens.css";
import "./filter-chip.css";

/** Linear's FilterChip (`man`, styles `han`/`gan`, startup-root.CnUSfl4j.js): padding 6px 10px, gap 6, thin alpha border. */
export const FILTER_CHIP = { PADDING_BLOCK: 6, PADDING_INLINE: 10, GAP: 6 } as const;

/** An applied filter. `variant="secondary"` is the transparent, muted form. */
function FilterChipRoot({
  variant = "default",
  className = "",
  ...props
}: { variant?: "default" | "secondary" } & ComponentProps<"span">) {
  return <span data-variant={variant} className={`ui-filter-chip ${className}`} {...props} />;
}

export const FilterChip = Object.assign(FilterChipRoot, {
  /** "Status is" */
  Label: (props: ComponentProps<"span">) => <span {...props} />,
  /** "In Progress, Todo" */
  Value: ({ className = "", ...props }: ComponentProps<"span">) => (
    <span className={`ui-filter-chip-value ${className}`} {...props} />
  ),
  /** Removes the filter; `label` names it for screen readers ("Remove Status filter"). */
  Remove: ({
    label,
    type = "button",
    className = "",
    ...props
  }: { label: string } & Omit<ComponentProps<"button">, "aria-label" | "children">) => (
    <button type={type} aria-label={label} className={`ui-filter-chip-remove ${className}`} {...props}>
      <Icon name="close" size={10} />
    </button>
  ),
});
