import { createContext, use, useMemo, type ComponentProps, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { Icon } from "./icons";
import { MenuSurface } from "./menu-surface";
import "./control-tokens.css";
import "./dialog.css";

/**
 * A centred modal on the shared menu surface: MenuSurface without an anchor already is one (backdrop, focus trap,
 * Escape, focus restored on close), so Dialog only adds the slots. Initial focus goes to `data-autofocus`, as Linear's
 * confirmation focuses its confirm button (`bIt.focusTrapOptions.initialFocus`).
 */
export const DIALOG = { WIDTH: 640, CONFIRM_WIDTH: 360 } as const;

const DialogContext = createContext<{ close: () => void } | null>(null);

function DialogRoot({
  label,
  close,
  width = DIALOG.WIDTH,
  children,
}: {
  /** The dialog's accessible name; usually its title text. */
  label: string;
  close: () => void;
  width?: number;
  children: ReactNode;
}) {
  const context = useMemo(() => ({ close }), [close]);
  return (
    <MenuSurface label={label} close={close} width={width}>
      <DialogContext value={context}>{children}</DialogContext>
    </MenuSurface>
  );
}

function Close({ label = "Close" }: { label?: string }) {
  const dialog = use(DialogContext);
  return (
    <IconButton label={label} variant="muted" onClick={dialog?.close}>
      <Icon name="close" />
    </IconButton>
  );
}

export const Dialog = Object.assign(DialogRoot, {
  /** Title and Close on one row. */
  Header: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-dialog-header ${className}`} {...props} />,
  Title: ({ className = "", ...props }: ComponentProps<"h2">) => <h2 className={`ui-dialog-title ${className}`} {...props} />,
  /** A div, so a description may hold several paragraphs. */
  Description: ({ className = "", ...props }: ComponentProps<"div">) => (
    <div className={`ui-dialog-description ${className}`} {...props} />
  ),
  Body: (props: ComponentProps<"div">) => <div {...props} />,
  /** Actions, right-aligned, 8px apart. */
  Footer: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-dialog-footer ${className}`} {...props} />,
  Close,
});

/** Linear's confirmation (`gi`): Cancel and a confirm button that takes focus; Escape or Cancel changes nothing. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "dangerous",
  onConfirm,
  close,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Linear's `confirmButtonType`. */
  tone?: "dangerous" | "primary";
  onConfirm: () => void;
  close: () => void;
}) {
  return (
    <Dialog label={title} close={close} width={DIALOG.CONFIRM_WIDTH}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
      <Dialog.Footer>
        <Button variant="secondary" onClick={close}>
          {cancelLabel}
        </Button>
        <Button variant={tone} data-autofocus onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </Dialog.Footer>
    </Dialog>
  );
}
