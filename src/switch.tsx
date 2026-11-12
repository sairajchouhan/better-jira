import type { ComponentProps } from "react";
import "./control-tokens.css";
import "./switch.css";

/**
 * Linear's toggle `gw` (startup-root.CnUSfl4j.js, styles `_w`, sizes `A0e`, states `k0e`): a native checkbox drawn as a
 * pill whose knob stretches toward the side it is about to take on hover. switch.css spells the sizes out.
 */
export const SWITCH = {
  SIZES: {
    normal: { WIDTH: 30, HEIGHT: 20, KNOB: 14, INSET: 3, HOVER_INSET: 11 },
    small: { WIDTH: 22, HEIGHT: 14, KNOB: 10, INSET: 2, HOVER_INSET: 9 },
  },
  HIT_AREA: 6,
  DISABLED_OPACITY: 0.5,
} as const;

/**
 * Checked state and changes are the input's own (`checked`, `onChange`); name it with `aria-label` or a wrapping
 * <label>. Enter toggles it as Space does (`gw`'s onKeyDown).
 */
export function Switch({
  size = "normal",
  className = "",
  onKeyDown,
  ...props
}: { size?: keyof typeof SWITCH.SIZES } & Omit<ComponentProps<"input">, "type" | "role" | "size">) {
  return (
    <input
      type="checkbox"
      role="switch"
      data-size={size}
      className={`ui-switch ${className}`}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) {
          e.preventDefault();
          e.currentTarget.click();
        }
      }}
      {...props}
    />
  );
}
