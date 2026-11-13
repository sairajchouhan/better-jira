import { createContext, use, useMemo, type ComponentProps, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { Icon } from "./icons";
import { MenuSurface } from "./menu-surface";
import "./control-tokens.css";
import "./dialog.css";

/**
 * A centred modal: MenuSurface's `dialog` variant already is one (Linear's elevated-theme box over bgModalOverlay, focus
 * trap, Escape, focus restored on close), so Dialog only adds the slots. Initial focus goes to `data-autofocus`, as Linear's
 * confirmation focuses its confirm button (`bIt.focusTrapOptions.initialFocus`).
 */
export const DIALOG = { WIDTH: 640, CONFIRM_WIDTH: 360 } as const;

const DialogContext = createContext<{ close: () => void } | null>(null);

type Placement = {
  /** `top`: 12vh down (the default). `third`: Linear's DialogPresenter, a third of the free height down. `side`: a panel along
   *  the window's right edge (Linear's keyboard shortcuts). See MenuSurface. */
  placement?: "top" | "third" | "side";
};

function DialogRoot({
  label,
  close,
  width = DIALOG.WIDTH,
  placement,
  children,
}: Placement & {
  /** The dialog's accessible name; usually its title text. */
  label: string;
  close: () => void;
  width?: number;
  children: ReactNode;
}) {
  const context = useMemo(() => ({ close }), [close]);
  return (
    <MenuSurface label={label} close={close} width={width} placement={placement} variant="dialog">
      <DialogContext value={context}>{children}</DialogContext>
    </MenuSurface>
  );
}

/** `shortcut` names the key that also closes it, in the button's tooltip (Linear's "Close" tooltip with Esc). */
function Close({ label = "Close", shortcut }: { label?: string; shortcut?: string }) {
  const dialog = use(DialogContext);
  return (
    <IconButton label={label} tooltip={shortcut ? "Close" : undefined} shortcut={shortcut} variant="muted" onClick={dialog?.close}>
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

/** Linear's confirmation (`gi`): Cancel and a confirm button that takes focus; Escape or Cancel changes nothing.
 *  It opens through DialogPresenter, so it sits a third of the way down (`placement="third"`) unlike Dialog's 12vh. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "dangerous",
  placement = "third",
  onConfirm,
  close,
}: Placement & {
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
    <Dialog label={title} close={close} width={DIALOG.CONFIRM_WIDTH} placement={placement}>
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
