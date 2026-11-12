import type { ComponentProps } from "react";
import "./control-tokens.css";
import "./label-chip.css";

/**
 * Linear's label pill (`ISn`/`iJ`, LabelsBadges.DpwfhH1r.js): 25px, radius 30, 1px bgBorder, a 9px dot then the name
 * 6px after it in smallPlus. `size="compact"` is the 24px list/board chip from .raj/linear.md.
 */
export const LABEL_CHIP = {
  normal: { HEIGHT: 25, BORDER_RADIUS: 30, PADDING: 8, TEXT_GAP: 6, FONT_SIZE: 13, FONT_WEIGHT: 500 },
  compact: { HEIGHT: 24, PADDING: 8, TEXT_GAP: 6, FONT_SIZE: 12, FONT_WEIGHT: 450 },
  ICON: 14,
  DOT: 9,
} as const;

type Look = { variant?: "bordered" | "borderless"; size?: "normal" | "compact" };

/** A label as a pill. Render `as="button"` when clicking it opens the labels picker. */
function LabelChipRoot({
  as = "span",
  variant = "bordered",
  size = "normal",
  className = "",
  ...props
}: Look & { as?: "span" | "button" } & ComponentProps<"button">) {
  const Tag = as as "button";
  return (
    <Tag
      type={as === "button" ? (props.type ?? "button") : undefined}
      data-variant={variant}
      data-size={size}
      className={`ui-label-chip ${className}`}
      {...props}
    />
  );
}

export const LabelChip = Object.assign(LabelChipRoot, {
  /** A 14px box for the dot or a label-group icon. */
  Icon: ({ className = "", ...props }: ComponentProps<"span">) => (
    <span aria-hidden className={`ui-label-chip-icon ${className}`} {...props} />
  ),
  /** The label's colour, as Linear's bare 9px dot: live Linear puts it 9px in and the name 24px in (RAJ-53), so no 14px icon box. */
  Dot: ({ color }: { color: string }) => (
    <span aria-hidden className="ui-label-chip-dot shrink-0" style={{ background: color }} />
  ),
  Text: ({ className = "", ...props }: ComponentProps<"span">) => (
    <span className={`ui-label-chip-text ${className}`} {...props} />
  ),
});
