import type { ComponentProps } from "react";
import "./control-tokens.css";
import "./property-trigger.css";

/**
 * Linear's DetailButton (`v`/`y`/`C` in DetailButton.B6DQogHG.js): the property pill in an issue's sidebar, 28px, icon
 * 6px in, label 6px after it, muted while the property is empty. `variant="row"` is the 24px chip on list rows and
 * board cards (.raj/linear.md "Board"). property-trigger.css spells these out.
 */
export const PROPERTY_TRIGGER = {
  detail: { HEIGHT: 28, PADDING_LEFT: 6, PADDING_RIGHT: 10, GAP: 6, ICON: 16, FONT_SIZE: 13, FONT_WEIGHT: 500 },
  row: { HEIGHT: 24, PADDING: 8, ICON_ONLY_PADDING: 4.5, GAP: 6, ICON: 14, FONT_SIZE: 12, FONT_WEIGHT: 450 },
  HIT_AREA: { TOP: 4, RIGHT: 4, BOTTOM: 4, LEFT: 8 },
} as const;

/**
 * The button that opens a property's picker. The picker, its data and its handlers stay with the caller; this owns
 * the pill. `state="empty"` mutes it ("Set priority"); an open menu shows through `aria-expanded`.
 */
function PropertyTriggerRoot({
  variant = "detail",
  state,
  type = "button",
  className = "",
  ...props
}: { variant?: "detail" | "row"; state: "empty" | "value" } & ComponentProps<"button">) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-state={state}
      className={`ui-property-trigger ${className}`}
      {...props}
    />
  );
}

const slot = (name: string) =>
  function Slot({ className = "", ...props }: ComponentProps<"span">) {
    return <span className={`ui-property-trigger-${name} ${className}`} {...props} />;
  };

export const PropertyTrigger = Object.assign(PropertyTriggerRoot, {
  /** The status/priority/avatar glyph, centred in a 16px box (14px on rows). */
  Icon: slot("icon"),
  /** The value or placeholder, truncated. */
  Label: slot("label"),
  /** Anything after the label: a count, a caret. */
  Trailing: slot("trailing"),
});
