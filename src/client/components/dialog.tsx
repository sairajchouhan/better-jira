import { createContext, use, useMemo, type ComponentProps, type ReactNode } from "react";
import { Button, IconButton } from "./button";
import { Icon } from "./icons";
import { MenuSurface } from "./menu-surface";
import { Text } from "./text";
import "./control-tokens.css";
import "./dialog.css";

/**
 * A centred modal: MenuSurface's `dialog` variant already is one (Linear's elevated-theme box over bgModalOverlay, focus
 * trap, Escape, focus restored on close), so Dialog only adds the slots. The box has no padding, as Linear's DialogPresenter
 * box has none: Header, Body and Footer are Linear's Modal compound (`qF`/`JF`/`YF`) and pad themselves (dialog.css).
 * Initial focus goes to `data-autofocus`, as Linear's confirmation focuses its confirm button
 * (`bIt.focusTrapOptions.initialFocus`).
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

/** `shortcut` names the key that also closes it, in the button's tooltip (Linear's "Close" tooltip with Esc). Inside
 *  Dialog.Header it sits 16px from the right edge, centred (Linear's `closeIconButton`); elsewhere it stays in the flow. */
function Close({ label = "Close", shortcut, size }: { label?: string; shortcut?: string; size?: "small" | "medium" }) {
  const dialog = use(DialogContext);
  return (
    <IconButton
      label={label}
      tooltip={shortcut ? "Close" : undefined}
      shortcut={shortcut}
      variant="muted"
      size={size}
      className="ui-dialog-close"
      onClick={dialog?.close}
    >
      <Icon name="close" />
    </IconButton>
  );
}

export const Dialog = Object.assign(DialogRoot, {
  /** Linear's `qF`: the title row, 16px in, room on the right for a Close. */
  Header: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-dialog-header ${className}`} {...props} />,
  Title: ({ className = "", ...props }: ComponentProps<"h2">) => <h2 className={`ui-dialog-title ${className}`} {...props} />,
  /** Linear's `JF`: 12px 16px. */
  Body: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-dialog-body ${className}`} {...props} />,
  /** Linear's `YF`: actions, right-aligned, 8px apart, 12px 16px. */
  Footer: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-dialog-footer ${className}`} {...props} />,
  Close,
});

/** Linear's confirmation (`gi`, ConfirmationDialog.72izii5E.js): a title, a description, and Cancel beside a confirm button
 *  that takes focus; Escape or Cancel changes nothing. `reject` is Linear's `rejectButtonTitle`: a secondary button that
 *  leads the row, the others moving to the far end (Save to drafts' Discard). It opens through DialogPresenter, so it sits
 *  a third of the way down (`placement="third"`) unlike Dialog's 12vh. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "dangerous",
  placement = "third",
  confirmDisabled,
  reject,
  onConfirm,
  close,
}: Placement & {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Linear's `confirmButtonType`. */
  tone?: "dangerous" | "primary";
  /** Linear's `confirmButtonDisabled`. */
  confirmDisabled?: boolean;
  reject?: { label: string; onReject: () => void };
  onConfirm: () => void;
  close: () => void;
}) {
  return (
    <Dialog label={title} close={close} width={DIALOG.CONFIRM_WIDTH} placement={placement}>
      <div className="ui-confirm">
        <Text as="h2" variant="regularPlus" className="ui-confirm-title">
          {title}
        </Text>
        <div className="ui-confirm-body">
          {typeof description === "string" ? (
            <Text variant="regular" color="muted" wrap="pretty">
              {description}
            </Text>
          ) : (
            description
          )}
        </div>
        <div className="ui-confirm-footer" data-variant={reject ? "split" : "end"}>
          {reject && (
            <Button variant="secondary" onClick={reject.onReject}>
              {reject.label}
            </Button>
          )}
          <div className="ui-confirm-actions">
            <Button variant="secondary" onClick={close}>
              {cancelLabel}
            </Button>
            <Button variant={tone} data-autofocus disabled={confirmDisabled} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
