import type { ComponentProps, ComponentType } from "react";
import { FieldMenuButton } from "./pill-select";
import "./control-tokens.css";
import "./badge.css";

type Menu<M> = { menu: ComponentType<M>; menuProps: Omit<M, "anchor" | "close"> };
type MenuButtonProps<M> = Menu<M> & Omit<ComponentProps<"button">, "onClick">;
type Anchored = { anchor?: HTMLElement | null; close?: () => void };

/**
 * Linear's badge `QB` (startup-root.CnUSfl4j.js): the one pill every property on a board card or list row draws, a 14px icon
 * then truncated text. `plain` is the Created / Updated date: no border, no box, no hover. Compose `Badge.Icon` and `Badge.Text`.
 */
function BadgeRoot({
  variant = "bordered",
  className = "",
  ...props
}: { variant?: "bordered" | "plain" } & ComponentProps<"span">) {
  return <span data-variant={variant} className={`ui-badge ${className}`} {...props} />;
}

/** Linear's `ZB`: the badge as the trigger of its property's menu (`FI`), anchored to the badge. It hovers, and stays lit while open. */
function BadgeMenu<M extends Anchored>({ className = "", ...props }: MenuButtonProps<M>) {
  return <FieldMenuButton {...(props as MenuButtonProps<M>)} className={`ui-badge ${className}`} />;
}

/** A badge that opens an external link in a new tab (Linear's "Open link…" on a single attachment). */
function BadgeLink({ className = "", ...props }: ComponentProps<"a">) {
  return <a target="_blank" rel="noreferrer" className={`ui-badge ${className}`} {...props} />;
}

/** A badge that runs its own action on click (opens the issue at its comments, a pull request or a menu of them). */
function BadgeButton({ className = "", ...props }: ComponentProps<"button">) {
  return <button type="button" className={`ui-badge ${className}`} {...props} />;
}

export const Badge = Object.assign(BadgeRoot, {
  Menu: BadgeMenu,
  Link: BadgeLink,
  Button: BadgeButton,
  Icon: ({ className = "", ...props }: ComponentProps<"span">) => (
    <span aria-hidden className={`ui-badge-icon ${className}`} {...props} />
  ),
  Text: ({ className = "", ...props }: ComponentProps<"span">) => (
    <span className={`ui-badge-text ${className}`} {...props} />
  ),
});

/** Linear's brightening action trigger: a bare status icon or avatar that opens its property's menu; the icon brightens on hover. */
export function IconMenuButton<M extends Anchored>({ className = "", ...props }: MenuButtonProps<M>) {
  return <FieldMenuButton {...(props as MenuButtonProps<M>)} className={`ui-icon-trigger ${className}`} />;
}
