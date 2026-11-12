/* oxlint-disable react/refs -- The submenu reads its floating node and focus target from refs in event handlers and floating-ui callbacks. */
import {
  autoUpdate,
  flip,
  FloatingNode,
  offset,
  safePolygon,
  shift,
  useFloating,
  useFloatingNodeId,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Command } from "cmdk";
import {
  useEffect,
  useId,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { Shortcut, type Keys } from "./keycap";

/**
 * Linear's one menu primitive, `IB = Object.assign(B3e, {List, Item, GroupHeader, Divider, TextDivider, Input})` in
 * startup-root.CnUSfl4j.js; every action menu, property picker and filter menu renders through it. Its geometry is `Vw`, copied
 * here. The `.menu*` classes in index.css spell these values out and are the only menu row styles; e2e/menu-geometry.pw.ts pins them.
 */
export const MENU = {
  BORDER_RADIUS: 12,
  INPUT_HEIGHT: 36,
  VIEWPORT_PADDING: 16,
  ITEM_HEIGHT: 32,
  ITEM_WITH_DESCRIPTION_HEIGHT: 64,
  ITEM_WITH_ONE_LINE_DESCRIPTION_HEIGHT: 48,
  ITEM_MIN_WIDTH_WITH_DESCRIPTION: 320,
  ITEM_MAX_WIDTH: 400,
  ITEM_MAX_WIDTH_WITH_CHECKMARK: 350,
  LIST_PADDING: 6,
  ITEM_SCROLL_MARGIN: 24,
  FOOTER_PADDING_BOTTOM: 6,
  LIST_EMPTY_STATE_HEIGHT: 42,
  DIVIDER_HEIGHT: 12,
  TEXT_DIVIDER_HEIGHT: 30,
  GROUP_HEADER_HEIGHT: 30,
  ITEM_PADDING_LEFT: 14,
  ITEM_PADDING_RIGHT: 18,
  ICON_COLUMN_WIDTH: 16,
  CHECKMARK_COLUMN_WIDTH: 16,
  INDENTATION_SLOT_WIDTH: 16,
  LABEL_GAP: 8,
} as const;

const OPENS_SUBMENU = "[cmdk-item][data-selected=true][aria-haspopup]";

/** The cmdk root: keyboard selection, filtering and looping. ArrowRight opens the highlighted row's submenu (Linear's J4e). */
function MenuRoot({ className = "", ref, ...props }: ComponentProps<typeof Command>) {
  const root = useRef<HTMLDivElement>(null);
  useHotkey(
    "ArrowRight",
    () => {
      if (!root.current?.hasAttribute("data-pristine"))
        root.current?.querySelector<HTMLElement>(OPENS_SUBMENU)?.click();
    },
    { target: root, capture: true, ignoreInputs: false },
  );
  return (
    <Command
      loop
      {...props}
      ref={(node) => {
        root.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      }}
      className={`menu ${className}`}
    />
  );
}

/** Linear's Zw: a 36px search row over a hairline, with an optional trailing `hotkey` (the registry chord that opens the menu, drawn as
 *  Linear's small Shortcut: ign's inputAdditionalContent). `hideWhenEmpty` keeps it focused but visually hidden until typing starts
 *  (B3e's hideInputWhenEmpty, used by action menus). */
function MenuInput({
  hotkey,
  hideWhenEmpty = false,
  ...props
}: ComponentProps<typeof Command.Input> & { hotkey?: string | readonly string[]; hideWhenEmpty?: boolean }) {
  const hidden = hideWhenEmpty && !props.value;
  return (
    <div className={hidden ? "sr-only" : "menu-input"}>
      <Command.Input {...props} className={hidden ? "sr-only" : undefined} />
      {hotkey && <Shortcut aria-hidden keys={hotkey} size="small" />}
    </div>
  );
}

/** Linear's N6e: the scrolling rows, 6px above and below. */
function MenuList({ maxHeight, ...props }: ComponentProps<typeof Command.List> & { maxHeight?: string }) {
  return <Command.List {...props} className="menu-list" style={{ maxHeight }} />;
}

type ItemSlots = {
  /** The 16px icon column. */
  icon?: ReactNode;
  /** A multi-select row: Linear's leading checkbox in this state. */
  checkbox?: boolean;
  /** Toggles from the checkbox itself, keeping the menu open (B4e's onCheckboxClick); `checkboxLabel` names it. */
  onCheckboxClick?: () => void;
  checkboxLabel?: string;
  /** A single-select row: the trailing checkmark when true. */
  checked?: boolean;
  /** The row's hotkey as a registry chord ("Shift+T", ["G", "I"]), drawn as Linear's small Shortcut (the action row's `detail`). */
  shortcut?: Keys;
  /** Trailing text: a number key, a count, a date. */
  hint?: ReactNode;
  /** A muted second line; the row grows to fit it. */
  description?: ReactNode;
};

/** Linear's v6e row content: [checkbox] [icon] label [checkmark] [hint ▶], in that order whatever the menu. */
function ItemContent({
  icon,
  checkbox,
  onCheckboxClick,
  checkboxLabel,
  checked,
  shortcut,
  hint,
  description,
  submenu,
  children,
}: ItemSlots & { submenu?: boolean; children: ReactNode }) {
  return (
    <>
      {checkbox !== undefined &&
        (onCheckboxClick ? (
          <input
            type="checkbox"
            tabIndex={-1}
            aria-label={checkboxLabel}
            checked={checkbox}
            onChange={onCheckboxClick}
            onClick={(event) => event.stopPropagation()}
            className="menu-checkbox"
          />
        ) : (
          <span aria-hidden className="menu-checkbox" />
        ))}
      <span className="menu-label">
        {icon && (
          <span aria-hidden className="menu-icon">
            {icon}
          </span>
        )}
        {description ? (
          <span className="menu-text">
            <span className="menu-name">{children}</span>
            <span className="menu-description">{description}</span>
          </span>
        ) : (
          <span className="menu-name">{children}</span>
        )}
        {checked && (
          <span aria-hidden className="menu-checkmark">
            <Icon name="check" size={16} />
          </span>
        )}
        {(shortcut || hint || submenu) && (
          <span className="menu-hint">
            {/* Out of the row's name, as v6e names the row by its label alone (aria-labelledby). */}
            {shortcut && <Shortcut aria-hidden keys={shortcut} size="small" />}
            {hint}
            {submenu && <span aria-hidden data-submenu-arrow className="menu-arrow" />}
          </span>
        )}
      </span>
    </>
  );
}

/** Linear's Item: a full-width 32px row owning 14/18 padding; its highlight is inset 6px with radius 8 (fT.itemContainer). */
function MenuItem({
  icon,
  checkbox,
  onCheckboxClick,
  checkboxLabel,
  checked,
  shortcut,
  hint,
  description,
  children,
  ...props
}: Omit<ComponentProps<typeof Command.Item>, "className" | "children"> &
  ItemSlots & { children: ReactNode }) {
  return (
    <Command.Item
      aria-checked={checkbox ?? props["aria-checked"]}
      {...props}
      className="menu-item"
    >
      <ItemContent
        icon={icon}
        checkbox={checkbox}
        onCheckboxClick={onCheckboxClick}
        checkboxLabel={checkboxLabel}
        checked={checked}
        shortcut={shortcut}
        hint={hint}
        description={description}
      >
        {children}
      </ItemContent>
    </Command.Item>
  );
}

/** A cmdk group under Linear's 30px GroupHeader (aT); filtering hides it with its last row. */
function MenuGroup(props: Omit<ComponentProps<typeof Command.Group>, "className">) {
  return <Command.Group {...props} className="menu-group" />;
}

/** Linear's GroupHeader (aT) outside a cmdk group. */
function MenuGroupHeader({ children }: { children: ReactNode }) {
  return (
    <div role="presentation" className="menu-group-header">
      {children}
    </div>
  );
}

/** Linear's Divider (pT): 12px with a centred hairline. Hidden while the menu is filtered. */
function MenuDivider() {
  return <Command.Separator className="menu-divider" />;
}

/** Linear's TextDivider (O6e): a 30px muted caption between rows. */
function MenuTextDivider({ children }: { children: ReactNode }) {
  return <div className="menu-text-divider">{children}</div>;
}

/** Linear's 42px empty state. `always` shows it outside cmdk's own filtering (menus with shouldFilter={false}). */
function MenuEmpty({ children, always = false }: { children: ReactNode; always?: boolean }) {
  return always ? (
    <div className="menu-empty">{children}</div>
  ) : (
    <Command.Empty className="menu-empty">{children}</Command.Empty>
  );
}

type Container = RefObject<HTMLElement | null>;

/** How far the row's edge on `side` sits inside its popup's border, so the submenu overlaps the popup by Linear's 2px. */
function edgeInset(row: Element, side: "right" | "left") {
  const box = row.getBoundingClientRect();
  for (let node = row.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (parseFloat(side === "right" ? style.borderRightWidth : style.borderLeftWidth)) {
      const edge = node.getBoundingClientRect();
      return side === "right" ? edge.right - box.right : box.left - edge.left;
    }
  }
  return 0;
}

/**
 * A row that opens a nested menu (Linear's Item `SubMenu`): hover intent with a safe pointer path, ArrowRight or Enter opens and
 * focuses it, ArrowLeft and Escape return to this menu. It opens beside the row on `side`, overlapping its menu by 2px, with its first
 * row level with this one. The nested menu is portalled into `container` so it stays inside the parent popup's focus scope.
 */
function MenuSubmenu({
  value,
  label,
  open,
  onOpenChange,
  container,
  side = "right",
  popupLabel = value,
  children,
  ...slots
}: Omit<ItemSlots, "checkbox" | "onCheckboxClick" | "checkboxLabel" | "checked" | "description"> & {
  value: string;
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: Container;
  side?: "right" | "left";
  /** The nested menu's accessible name; the row's value by default. */
  popupLabel?: string;
  children: ReactNode;
}) {
  const id = useId(),
    nodeId = useFloatingNodeId(),
    row = useRef<HTMLDivElement>(null),
    focusOnOpen = useRef(false);
  const { refs, floatingStyles, context, isPositioned } = useFloating({
    nodeId,
    open,
    onOpenChange: (next) => {
      focusOnOpen.current = false;
      onOpenChange(next);
    },
    placement: side === "right" ? "right-start" : "left-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(({ elements }) => {
        const first = elements.floating.querySelector("[cmdk-item]");
        return {
          mainAxis: edgeInset(elements.reference as Element, side) - 2,
          alignmentAxis: first
            ? elements.floating.getBoundingClientRect().top - first.getBoundingClientRect().top
            : 0,
        };
      }),
      flip({ padding: 12, fallbackAxisSideDirection: "end" }),
      shift({ padding: 12 }),
    ],
  });
  const hover = useHover(context, {
    mouseOnly: true,
    delay: { open: 75, close: 120 },
    handleClose: safePolygon({ buffer: 2 }),
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover]);
  const parentInput = () =>
    row.current?.closest("[cmdk-root]")?.querySelector<HTMLInputElement>("input");
  const focusInside = () => {
    const node = refs.floating.current;
    (node?.querySelector<HTMLElement>("input") ?? node?.querySelector<HTMLElement>("select,button"))?.focus();
  };
  const back = () => {
    onOpenChange(false);
    parentInput()?.focus();
  };
  useHotkey(
    "ArrowLeft",
    (event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.value && input.selectionStart !== 0) return;
      event.preventDefault();
      back();
    },
    { target: refs.floating, capture: true, ignoreInputs: false, preventDefault: false },
  );
  useHotkey("Escape", back, { target: refs.floating, capture: true, ignoreInputs: false });
  useEffect(() => {
    if (open && isPositioned && focusOnOpen.current) {
      focusInside();
      focusOnOpen.current = false;
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Focus only on the open/positioned transition; the render-local helper changes each render.
  }, [open, isPositioned]);
  useEffect(() => {
    if (!open) return;
    const node = refs.floating.current;
    return () => {
      if (node?.contains(document.activeElement)) parentInput()?.focus();
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Cleanup resolves the parent menu's input when the submenu closes.
  }, [open, refs.floating]);
  return (
    <FloatingNode id={nodeId}>
      <Command.Item
        ref={(node) => {
          row.current = node;
          refs.setReference(node);
        }}
        value={value}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        {...getReferenceProps()}
        onSelect={() => {
          focusOnOpen.current = true;
          if (open) focusInside();
          else onOpenChange(true);
        }}
        className="menu-item"
      >
        <ItemContent {...slots} submenu>
          {label}
        </ItemContent>
      </Command.Item>
      {open &&
        container.current &&
        createPortal(
          <div
            id={id}
            ref={refs.setFloating}
            style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
            role="dialog"
            aria-label={popupLabel}
            {...getFloatingProps({
              onPointerEnter: () => {
                if (!refs.floating.current?.contains(document.activeElement)) focusInside();
              },
              onKeyDown: (event: KeyboardEvent) => {
                if (event.key !== "Tab") event.stopPropagation();
              },
            })}
          >
            {children}
          </div>,
          container.current,
        )}
    </FloatingNode>
  );
}

export const Menu = Object.assign(MenuRoot, {
  Input: MenuInput,
  List: MenuList,
  Item: MenuItem,
  Submenu: MenuSubmenu,
  Group: MenuGroup,
  GroupHeader: MenuGroupHeader,
  Divider: MenuDivider,
  TextDivider: MenuTextDivider,
  Empty: MenuEmpty,
});
