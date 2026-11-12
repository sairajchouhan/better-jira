import { useState, type ComponentProps, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { PropertyTrigger } from "./property-trigger";

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
 * A composer chip (Linear's create modal property row): the row PropertyTrigger, 24px with its 14px icon, showing the
 * value, or with none set the field's name, muted. Named "<label>: <current>" either way.
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
      <PropertyTrigger
        variant="row"
        state={value === undefined ? "empty" : "value"}
        aria-label={`${label}: ${current}`}
        title={label}
        {...trigger}
      >
        {icon && <PropertyTrigger.Icon>{icon}</PropertyTrigger.Icon>}
        <PropertyTrigger.Label>{value ?? label}</PropertyTrigger.Label>
      </PropertyTrigger>
      {open}
    </>
  );
}
