import type { ComponentProps, ReactNode } from "react";
import { ButtonLink, IconButton } from "./button";
import { InlineToolbar } from "./toolbar";
import "./control-tokens.css";
import "./node-toolbar.css";

/**
 * Linear's editor node toolbar (startup-root.CnUSfl4j.js): the `Px` pill (role toolbar, horizontal) of `Nx` items that a
 * rich-text node (a file, an image, a code block) shows at its edge. `reveal="hover"` is `Lze`'s reveal: hidden until
 * the pointer rests on the node that carries `data-node-toolbar-host` (100ms delay, 40ms fade), at once while focus is
 * inside it, always on a touch-only screen. Spans throughout (`InlineToolbar`), so the toolbar is valid inside a paragraph
 * (an inline node); its keys are the shared toolbar's (`Mx.handleToolbarKeyDown`, toolbar.tsx).
 */
export function NodeToolbar({
  label,
  reveal = "always",
  children,
}: {
  label: string;
  reveal?: "always" | "hover";
  children: ReactNode;
}) {
  return (
    <InlineToolbar label={label} data-reveal={reveal} className="ui-node-toolbar">
      {children}
    </InlineToolbar>
  );
}

/** Keeps the editor's selection and focus when an item is pressed, as `Fze`'s onMouseDown does. */
const keepEditorFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/** `Fze` → `Nx`: a 26px round icon button named by `label`, which is also its tooltip. */
function NodeToolbarButton({
  icon,
  ...props
}: { label: string; icon: ReactNode; disabledReason?: string } & Omit<
  ComponentProps<typeof IconButton>,
  "children" | "appearance" | "variant" | "size"
>) {
  return (
    <IconButton appearance="node-toolbar" size="small" onMouseDown={keepEditorFocus} {...props}>
      {icon}
    </IconButton>
  );
}

/** The same item as a link, for an action that is navigation (Download). */
function NodeToolbarLink({
  icon,
  ...props
}: { label: string; icon: ReactNode } & Omit<
  ComponentProps<typeof ButtonLink>,
  "children" | "appearance" | "variant" | "size" | "icon"
>) {
  return (
    <ButtonLink
      appearance="node-toolbar"
      variant="borderless"
      size="small"
      icon={icon}
      onMouseDown={keepEditorFocus}
      {...props}
    />
  );
}

NodeToolbar.Button = NodeToolbarButton;
NodeToolbar.Link = NodeToolbarLink;
