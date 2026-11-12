import { type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Icon } from "./icons";
import { shortcutTitle, type Keys } from "./keycap";
import "./control-tokens.css";
import "./button.css";

/**
 * Linear's `jv` Button, `Jx` IconButton (startup-root.CnUSfl4j.js). Heights, min-widths and
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
  | "tab"
  | "link"
  | "dangerous"
  | "dangerous-borderless";

type Look = { variant?: ButtonVariant; size?: ButtonSize };
type IconButtonProps = Omit<Look, "variant"> &
  Tip & {
    /** `send` is SendButton's look only. */
    variant?: ButtonVariant | "send";
    appearance?: "comment-action" | "label";
    label: string;
    tooltip?: string | false;
    children: ReactNode;
  } & Omit<ComponentProps<"button">, "aria-label" | "title">;

/**
 * Linear's Tooltip (`$`) props as its toolbars build them (`Aze`). `tooltip` is the hover text, separate from the
 * accessible name. `shortcut` is a registry chord or sequence (`hotkeyOf(id)` for a registered one), with an optional
 * `alternate` chord; `shortcutTitle` spells them as "(keys)", which src/tooltip.tsx draws as key caps.
 * `disabledReason` is shown instead of both while the button is disabled.
 */
type Tip = { shortcut?: Keys; alternate?: string; disabledReason?: string };

const tooltipTitle = (tooltip: string | undefined, shortcut?: Keys, alternate?: string) =>
  tooltip && shortcutTitle(tooltip, shortcut, alternate);

/**
 * A disabled button gets no pointer events, so its reason hangs on a wrapper, as under Linear's tooltip trigger
 * (`_tooltipTriggerContent > button[disabled] { pointer-events: none }`). A button given a `disabledReason` (even "")
 * always sits in the wrapper, so flipping `disabled` never remounts it; one without stands alone. While disabled the
 * wrapper also carries the button's own `tip` when there is no reason, since the button can't be hovered.
 */
function DisabledReason({
  reason,
  tip,
  disabled,
  children,
}: {
  reason: string | undefined;
  tip: string | undefined;
  disabled: boolean | undefined;
  children: ReactElement;
}) {
  if (reason === undefined) return children;
  return (
    <span className="ui-tooltip-trigger" title={disabled ? reason || tip : undefined}>
      {children}
    </span>
  );
}

/**
 * A text button, optionally with a leading `icon`. Pressed/open states come from the element itself (`aria-pressed`,
 * `aria-expanded`, `data-menu-open`), so there is no `active` prop to keep in sync.
 */
export function Button({
  variant = "primary",
  size = "normal",
  icon,
  tooltip,
  shortcut,
  alternate,
  disabledReason,
  type = "button",
  className = "",
  children,
  ...props
}: Look & Tip & { icon?: ReactNode; tooltip?: string } & ComponentProps<"button">) {
  const reason = (props.disabled && disabledReason) || undefined,
    tip = tooltipTitle(tooltip, shortcut, alternate),
    wrapped = props.disabled && disabledReason !== undefined;
  return (
    <DisabledReason reason={disabledReason} tip={tip} disabled={props.disabled}>
      <button
        type={type}
        title={wrapped ? undefined : tip}
        aria-description={reason}
        data-variant={variant}
        data-size={size}
        className={`ui-button ${className}`}
        {...props}
      >
        {icon && (
          <span aria-hidden className="ui-button-icon">
            {icon}
          </span>
        )}
        {children}
      </button>
    </DisabledReason>
  );
}

/**
 * Linear's `fk`: a link with a button's looks (`Mv` variant and size), for navigation and downloads. Like `fk` it keeps
 * the full text padding beside a leading icon (no `QEe` pull-in); the icon sits 6px from the text (`Ist.iconGap`).
 */
export function ButtonLink({
  variant = "primary",
  size = "normal",
  icon,
  label,
  className = "",
  children,
  ...props
}: Look & { icon?: ReactNode; label?: string } & Omit<ComponentProps<"a">, "aria-label" | "title">) {
  // `fk onlyIcon`: no text, so the link is IconButton's square and `label` names it and titles it.
  const onlyIcon = !children;
  return (
    <a
      data-variant={variant}
      data-size={size}
      data-shape={onlyIcon ? "icon" : undefined}
      aria-label={label}
      title={onlyIcon ? label : undefined}
      className={`ui-button ${className}`}
      {...props}
    >
      {icon && (
        <span aria-hidden className="ui-button-icon">
          {icon}
        </span>
      )}
      {children}
    </a>
  );
}

/**
 * `Jx` inside Linear's Tooltip `$`: an icon-only button, borderless and medium by default. `label` names it for screen
 * readers; the hover `tooltip` defaults to it and may differ ("Filter" over "Add filter"), or be `false` when the owner
 * draws its own (the video toolbar). `shortcut` and `disabledReason` follow `Aze` (see `tooltipTitle`).
 */
export function IconButton({
  label,
  appearance,
  tooltip = label,
  shortcut,
  alternate,
  disabledReason,
  variant = "borderless",
  size = "medium",
  type = "button",
  className = "",
  children,
  ...props
}: IconButtonProps) {
  const reason = (props.disabled && disabledReason) || undefined,
    tip = tooltipTitle(tooltip || undefined, shortcut, alternate),
    wrapped = props.disabled && disabledReason !== undefined;
  return (
    <DisabledReason reason={disabledReason} tip={tip} disabled={props.disabled}>
      <button
        type={type}
        aria-label={label}
        title={wrapped ? undefined : tip}
        aria-description={reason}
        data-variant={variant}
        data-size={size}
        data-shape="icon"
        data-appearance={appearance}
        className={`ui-button ${className}`}
        {...props}
      >
        <span aria-hidden className="ui-button-icon">
          {children}
        </span>
      </button>
    </DisabledReason>
  );
}

/**
 * Linear's filled send circle, which has no Jx variant: a small round icon button painted with `--send`, hovering its
 * tooltip (the label unless given; Linear's comment composers say "Submit comment") with ⌘↵. Every composer's send is
 * this one control. It always sits in its tooltip trigger, so a disabled reason can come and go without a remount.
 */
export function SendButton({
  tooltip,
  disabledReason = "",
  ...props
}: Omit<IconButtonProps, "variant" | "size" | "shortcut" | "alternate" | "children">) {
  return (
    <IconButton
      tooltip={tooltip}
      shortcut="Mod+Enter"
      variant="send"
      size="small"
      disabledReason={disabledReason}
      {...props}
    >
      <Icon name="up" />
    </IconButton>
  );
}

