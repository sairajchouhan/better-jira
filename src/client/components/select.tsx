import { Children, createContext, isValidElement, use, useMemo, useState, type ReactNode } from "react";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";
import "./control-tokens.css";
import "./select.css";

/**
 * Linear's Select `Xke` (exported as `my`/`hAe`, startup-root.CnUSfl4j.js): a trigger showing the chosen option (`Zke`,
 * styles `_y`, sizes `lAe`, caret `py`) over a list of `Option`s. The list is the app's shared menu, filtered by typing
 * as Linear's action menus are, where Linear's base-ui list jumps to a typed prefix instead.
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
} as const;

export type SelectSize = keyof typeof SELECT.SIZES;

type OptionProps = { value: string; icon?: ReactNode; children: string };

const SelectContext = createContext<{ value: string; choose: (value: string) => void } | null>(null);

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

/** `$ke`: a row with the chosen one checked. */
function Option({ value, icon, children }: OptionProps) {
  const select = use(SelectContext);
  return (
    <Menu.Item value={`${children} ${value}`} icon={icon} checked={select?.value === value} onSelect={() => select?.choose(value)}>
      {children}
    </Menu.Item>
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
  /** `Select.Option`s, optionally inside Menu.Group / Menu.Divider. */
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chosen = optionsByValue(children).get(value);
  const context = useMemo(
    () => ({
      value,
      choose: (next: string) => {
        setAnchor(null);
        if (next !== value) onValueChange(next);
      },
    }),
    [value, onValueChange],
  );
  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${chosen?.children ?? placeholder ?? value}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        disabled={disabled}
        data-size={size}
        className={`ui-select ${className}`}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
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
      </button>
      {anchor && (
        <MenuSurface
          label={label}
          anchor={anchor}
          fit
          variant="select"
          align={align === "end" ? "end" : undefined}
          close={() => setAnchor(null)}
        >
          <SelectContext value={context}>
            {/* Opens on the chosen option, like Linear. */}
            <Menu defaultValue={chosen ? `${chosen.children} ${value}` : undefined} data-size={size} className="ui-select-list">
              <Menu.Input autoFocus hideWhenEmpty aria-label={`${label}…`} />
              <Menu.List maxHeight={`${SELECT.LIST_MAX_HEIGHT}px`}>
                <Menu.Empty>No matches</Menu.Empty>
                {children}
              </Menu.List>
            </Menu>
          </SelectContext>
        </MenuSurface>
      )}
    </>
  );
}

export const Select = Object.assign(SelectRoot, { Option });
