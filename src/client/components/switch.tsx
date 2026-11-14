import type { ComponentProps, ReactNode } from "react";
import { Switch as AriaSwitch, type SwitchProps } from "react-aria-components";
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
 * React Aria's Switch: a <label> around a visually hidden native checkbox (`role="switch"`) and its children, so the whole row
 * (text and pill) toggles and hovers it. Place the pill with `Switch.Indicator`; name the switch by its text or `aria-label`.
 * `isSelected` and `onChange(selected)` are React Aria's. Enter toggles it as Space does (`gw`'s onKeyDown); every other key goes
 * on to the page.
 */
function SwitchRoot({
  size = "normal",
  className = "",
  title,
  onKeyDown,
  children,
  ...props
}: { size?: keyof typeof SWITCH.SIZES; className?: string; title?: string; children: ReactNode } & Omit<
  SwitchProps,
  "className" | "children"
>) {
  return (
    <AriaSwitch
      data-size={size}
      className={`ui-switch ${className}`}
      // `title` feeds TitleTooltips; React Aria's Switch passes no title through, so the label takes it here.
      render={title ? (label) => <label {...(label as ComponentProps<"label">)} title={title} /> : undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.isDefaultPrevented()) {
          event.preventDefault();
          (event.target as HTMLInputElement).click();
        } else event.continuePropagation();
      }}
      {...props}
    >
      {children}
    </AriaSwitch>
  );
}

export const Switch = Object.assign(SwitchRoot, {
  /** The drawn pill and knob. */
  Indicator: () => <span aria-hidden className="ui-switch-indicator" />,
});
