import { useState, type ComponentProps, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { Button } from "./button";
import { Text } from "./text";

type FieldMenuProps<M> = {
  menu: ComponentType<M>;
  menuProps: Omit<M, "anchor" | "close">;
};

/** A field menu's open state: the props its trigger needs and the menu itself, so any trigger look can open one. The field
 *  menu owns choices, interaction and writes; the trigger owns only its anchor. */
function useFieldMenu<M extends { anchor?: HTMLElement | null; close?: () => void }>({
  menu: FieldMenu,
  menuProps,
}: FieldMenuProps<M>) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return {
    trigger: {
      "aria-haspopup": "dialog" as const,
      "aria-expanded": !!anchor,
      onClick: (e: MouseEvent<HTMLButtonElement>) => setAnchor(anchor ? null : e.currentTarget),
    },
    // Field menus differ only in whether a missing anchor is null or undefined; it is always set here.
    menu: anchor && <FieldMenu {...({ ...menuProps, anchor, close: () => setAnchor(null) } as M)} />,
  };
}

/** A plain button that opens a field menu; its look is the caller's. */
export function FieldMenuButton<M extends { anchor?: HTMLElement | null; close?: () => void }>({
  menu,
  menuProps,
  ...props
}: FieldMenuProps<M> & Omit<ComponentProps<"button">, "onClick">) {
  const { trigger, menu: open } = useFieldMenu({ menu, menuProps });
  return (
    <>
      <button type="button" aria-haspopup={trigger["aria-haspopup"]} aria-expanded={trigger["aria-expanded"]} {...props} onClick={trigger.onClick} />
      {open}
    </>
  );
}

/**
 * A composer chip: Linear's fast-create property button (`AV` → `Lj` → `jv` secondary small, startup-root.CnUSfl4j.js),
 * 24px, its 14px icon, then the value in mini text, labelBase; with none set the field's name, labelMuted. Named
 * "<label>: <current>" either way. It paints the surrounding theme's controlSecondary, so the create dialog's chip row
 * (`data-elevation="dialog-raised"`) gives it Linear's colours.
 */
export function PropertyPill<M extends { anchor?: HTMLElement | null; close?: () => void }>({
  label,
  current,
  icon,
  value,
  menu,
  menuProps,
}: {
  label: string;
  /** The value as the accessible name gives it ("Default priority", "No labels"). */
  current: string;
  icon?: ReactNode;
  /** The chip's text: the value, or with none set (undefined) the field's name, muted. */
  value: string | undefined;
} & FieldMenuProps<M>) {
  const { trigger, menu: open } = useFieldMenu({ menu, menuProps });
  return (
    <>
      <Button variant="secondary" size="small" icon={icon} aria-label={`${label}: ${current}`} title={label} {...trigger}>
        <Text variant="mini" color={value === undefined ? "muted" : "base"} wrap="truncate">
          {value ?? label}
        </Text>
      </Button>
      {open}
    </>
  );
}
