import { Children, isValidElement, useId, type ReactNode } from "react";
import { Button, ListBox, ListBoxItem, Popover, Select as AriaSelect } from "react-aria-components";
import { Icon } from "./icons";
import { MENU_POPUP, useElevation } from "./menu-surface";
import "./control-tokens.css";
import "./select.css";

/**
 * Linear's Select `Xke` (exported as `my`/`hAe`, startup-root.CnUSfl4j.js), on Base UI's Select: a trigger showing the
 * chosen option (`Zke`, styles `_y`, sizes `lAe`, caret `py`) over a listbox of `Option`s (`gy`'s popup `eAe`, rows `$ke`).
 * Ours is React Aria's Select + Button + Popover + ListBox, the same contract: the list opens on the chosen option, arrows
 * move, typing jumps to the first option starting with what was typed, Enter or a press chooses, Escape closes.
 */
export const SELECT = {
  /** `lAe` triggers; `ROW_HEIGHT`/`ROW_FONT_SIZE` are its list's rows (`fAe`, by the same size), select.css. */
  SIZES: {
    large: { HEIGHT: 44, PADDING_LEFT: 10, PADDING_RIGHT: 28, FONT_SIZE: 13, ROW_HEIGHT: 44, ROW_FONT_SIZE: 13 },
    default: { HEIGHT: 30, PADDING_LEFT: 10, PADDING_RIGHT: 28, FONT_SIZE: 13, ROW_HEIGHT: 32, ROW_FONT_SIZE: 13 },
    medium: { HEIGHT: 26, PADDING_LEFT: 10, PADDING_RIGHT: 28, FONT_SIZE: 12, ROW_HEIGHT: 30, ROW_FONT_SIZE: 12 },
    small: { HEIGHT: 24, PADDING_LEFT: 10, PADDING_RIGHT: 24, FONT_SIZE: 12, ROW_HEIGHT: 24, ROW_FONT_SIZE: 12 },
    compact: { HEIGHT: 22, PADDING_LEFT: 8, PADDING_RIGHT: 18, FONT_SIZE: 12, ROW_HEIGHT: 24, ROW_FONT_SIZE: 12 },
  },
  RADIUS: 8,
  CARET_RIGHT: 10,
  CARET_RIGHT_TIGHT: 6,
  LIST_MAX_HEIGHT: 300,
  /** Base UI's popper `sideOffset` as `Xke` passes it whenever a `side` is given (every caller passes `bottom`). */
  OFFSET: 5,
  /** The room kept from the window's edges, as MenuSurface keeps. */
  EDGE: 12,
} as const;

export type SelectSize = keyof typeof SELECT.SIZES;

type OptionProps = { value: string; icon?: ReactNode; children: string };

/** `rAe`: every Option under `children`, through Fragments, by value. */
export function optionsByValue(children: ReactNode, found = new Map<string, OptionProps>()) {
  Children.forEach(children, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === Option) {
      const option = child.props as OptionProps;
      found.set(option.value, option);
    } else optionsByValue(child.props.children, found);
  });
  return found;
}

/** `$ke`: a row, its icon, its name, and the chosen one's check (`Hve`) 8px from the right. Typeahead matches the name. */
function Option({ value, icon, children }: OptionProps) {
  return (
    <ListBoxItem id={value} textValue={children} className="ui-select-option">
      {({ isSelected }) => (
        <span className="menu-label">
          {icon && (
            <span aria-hidden className="menu-icon">
              {icon}
            </span>
          )}
          <span className="menu-name">{children}</span>
          {isSelected && (
            <span aria-hidden className="menu-checkmark">
              <Icon name="check" size={16} />
            </span>
          )}
        </span>
      )}
    </ListBoxItem>
  );
}

/** `label` names the trigger ("Grouping: Status") and the list; `placeholder` shows while no option matches `value`. */
function SelectRoot({
  label,
  value,
  onValueChange,
  size = "default",
  placeholder,
  disabled,
  align = "start",
  className = "",
  children,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  size?: SelectSize;
  placeholder?: string;
  disabled?: boolean;
  /** Which trigger edge the list lines up with, 5px below it (base-ui `align`; ViewOptions' `Rxr` passes `end`). */
  align?: "start" | "end";
  className?: string;
  /** `Select.Option`s, through Fragments. */
  children: ReactNode;
}) {
  const nameId = useId();
  const elevation = useElevation("raised");
  const chosen = optionsByValue(children).get(value);
  const name = `${label}: ${chosen?.children ?? placeholder ?? value}`;
  return (
    <AriaSelect
      aria-label={label}
      value={chosen ? value : null}
      onChange={(next) => {
        if (next != null && next !== value) onValueChange(String(next));
      }}
      isDisabled={disabled}
      className="contents"
    >
      {/* The trigger reads "Grouping: Status", not React Aria's value-then-label. */}
      <span hidden id={nameId}>
        {name}
      </span>
      <Button aria-label={name} aria-labelledby={nameId} data-size={size} className={`ui-select ${className}`}>
        {chosen?.icon && (
          <span aria-hidden className="ui-select-icon">
            {chosen.icon}
          </span>
        )}
        <span className="ui-select-value" data-placeholder={chosen ? undefined : ""}>
          {chosen?.children ?? placeholder}
        </span>
        {/* `fy`, a 9x5 chevron in a 10px column. */}
        <svg aria-hidden className="ui-select-caret" viewBox="0 0 9 5" width="9" height="5">
          <path d="M1.915.557a.667.667 0 0 0-.943.943l2.862 2.862a.942.942 0 0 0 1.333 0L8.028 1.5a.667.667 0 0 0-.943-.943L4.5 3.14 1.915.557Z" />
        </svg>
      </Button>
      {/* `eAe`: one elevation above the surface it opened from, ringed (select.css). */}
      <Popover
        placement={align === "end" ? "bottom end" : "bottom start"}
        offset={SELECT.OFFSET}
        containerPadding={SELECT.EDGE}
        {...elevation.props}
        data-surface="select"
        className={`${MENU_POPUP} z-50 flex w-max min-w-[175px] max-w-[min(500px,calc(100vw-24px))] flex-col overflow-hidden outline-none`}
      >
        <ListBox shouldFocusWrap data-size={size} className="ui-select-list" style={{ maxHeight: SELECT.LIST_MAX_HEIGHT }}>
          {children}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}

export const Select = Object.assign(SelectRoot, { Option });
