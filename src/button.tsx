import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from "react";
import "./control-tokens.css";
import "./button.css";

/**
 * Linear's `jv` Button, `Jx` IconButton and `wBe` ButtonGroup (startup-root.CnUSfl4j.js). Heights, min-widths and
 * fonts are `GEe`, text padding `ZEe`, leading-icon padding `QEe`, icon-only widths `qEe`, colours `UEe`/`WEe`.
 * button.css spells these out.
 */
export const BUTTON = {
  SIZES: {
    small: { HEIGHT: 24, MIN_WIDTH: 24, FONT_SIZE: 12, PADDING: 8, ICON_PADDING_LEFT: 6, ICON_PADDING_RIGHT: 8, ICON: 14 },
    medium: { HEIGHT: 28, MIN_WIDTH: 28, FONT_SIZE: 12, PADDING: 10, ICON_PADDING_LEFT: 8, ICON_PADDING_RIGHT: 10, ICON: 14 },
    normal: { HEIGHT: 32, MIN_WIDTH: 32, FONT_SIZE: 13, PADDING: 12, ICON_PADDING_LEFT: 10, ICON_PADDING_RIGHT: 12, ICON: 16 },
    large: { HEIGHT: 44, MIN_WIDTH: 32, FONT_SIZE: 13, PADDING: 18, ICON_PADDING_LEFT: 14, ICON_PADDING_RIGHT: 16, ICON: 16 },
  },
  ICON_GAP: 6,
  DISABLED_OPACITY: 0.6,
  TRANSITION_MS: 150,
} as const;

export type ButtonSize = keyof typeof BUTTON.SIZES;
export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "borderless"
  | "muted"
  | "link"
  | "dangerous"
  | "dangerous-borderless";

type Look = { variant?: ButtonVariant; size?: ButtonSize };

/**
 * A text button, optionally with a leading `icon`. Pressed/open states come from the element itself (`aria-pressed`,
 * `aria-expanded`, `data-menu-open`), so there is no `active` prop to keep in sync.
 */
export function Button({
  variant = "primary",
  size = "normal",
  icon,
  type = "button",
  className = "",
  children,
  ...props
}: Look & { icon?: ReactNode } & ComponentProps<"button">) {
  return (
    <button type={type} data-variant={variant} data-size={size} className={`ui-button ${className}`} {...props}>
      {icon && (
        <span aria-hidden className="ui-button-icon">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}

/**
 * `Jx`: an icon-only button, borderless and medium by default. `label` names it for screen readers and becomes the
 * hover tooltip; `shortcut` (display text such as "⌘K" or "G then I") is appended as "(keys)", which src/tooltip.tsx
 * draws as key caps.
 */
export function IconButton({
  label,
  shortcut,
  variant = "borderless",
  size = "medium",
  type = "button",
  className = "",
  children,
  ...props
}: Look & { label: string; shortcut?: string; children: ReactNode } & Omit<ComponentProps<"button">, "aria-label" | "title">) {
  return (
    <button
      type={type}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      data-variant={variant}
      data-size={size}
      data-shape="icon"
      className={`ui-button ${className}`}
      {...props}
    >
      <span aria-hidden className="ui-button-icon">
        {children}
      </span>
    </button>
  );
}

/** `wBe`: buttons joined into one pill, a hairline between each (`divider="mini"` insets it 4px). */
export function ButtonGroup({
  variant = "secondary",
  divider = "full",
  className = "",
  children,
  ...props
}: { variant?: "secondary" | "ghost" | "borderless"; divider?: "full" | "mini" } & ComponentProps<"div">) {
  return (
    <div role="group" data-variant={variant} data-divider={divider} className={`ui-button-group ${className}`} {...props}>
      {Children.toArray(children).map((child, index) => (
        <Fragment key={isValidElement(child) && child.key !== null ? child.key : index}>
          {index > 0 && <span aria-hidden className="ui-button-group-divider" />}
          {child}
        </Fragment>
      ))}
    </div>
  );
}
