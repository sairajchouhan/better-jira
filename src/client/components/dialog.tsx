import {
  createContext,
  use,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button, IconButton } from "./button";
import { Icon } from "./icons";
import {
  DIALOG_SURFACE,
  ElevationScope,
  MENU_FOCUS,
  MenuSurfaceContext,
  SIDE_PANEL_SURFACE,
  useElevation,
  useInitialFocus,
  useReturnFocus,
} from "./menu-surface";
import { Text } from "./text";
import "./control-tokens.css";
import "./dialog.css";

/**
 * A centred modal: React Aria's ModalOverlay + Modal + Dialog (focus contained by a full tabbable walker, the page behind hidden
 * from assistive tech and inert, scroll locked) in Linear's DialogPresenter box: the elevated theme over bgModalOverlay. The box
 * has no padding, as Linear's DialogPresenter box has none: Header, Body and Footer are Linear's Modal compound (`qF`/`JF`/`YF`)
 * and pad themselves (dialog.css). Linear's dialogs trap focus with `focus-trap`; React Aria's FocusScope is the same contract.
 *
 * Ours on top of React Aria, because it has no equivalent: initial focus goes to `data-autofocus`, else a text field, else the
 * first button (Linear's confirmation focuses its confirm button, `bIt.focusTrapOptions.initialFocus`), and closing hands focus
 * back to what opened the menu that opened the dialog, or to the opener's re-rendered node (useReturnFocus). Escape and a press
 * on the backdrop are ours too, so a press closes on mousedown without landing below and `dismiss` can differ from `close`.
 */
export const DIALOG = { WIDTH: 640, CONFIRM_WIDTH: 360 } as const;

const DialogContext = createContext<{ close: () => void } | null>(null);

type Placement = {
  /** `top`: 12vh down (the default). `third`: Linear's DialogPresenter, a third of the free height down. `side`: Linear's
   *  keyboard-shortcuts panel along the window's right edge. dialog.css places each. */
  placement?: "top" | "third" | "side";
};

/** A press on the backdrop (the overlay, its layout box or a spacer, all `data-backdrop`) dismisses; nothing below is pressed and
 *  focus stays where it is until the dialog hands it back. */
function pressBackdrop(event: MouseEvent, dismiss: () => void) {
  if (!(event.target as HTMLElement).hasAttribute("data-backdrop")) return;
  event.preventDefault();
  dismiss();
}

const noSubscription = () => () => {};
/** True while rendering on the server (and in the unit tests' static renders), where React Aria's ModalOverlay renders nothing. */
const useServerRender = () =>
  useSyncExternalStore(
    noSubscription,
    () => false,
    () => true,
  );

function DialogRoot({
  label,
  close,
  dismiss = close,
  width = DIALOG.WIDTH,
  placement = "top",
  children,
}: Placement & {
  /** The dialog's accessible name; usually its title text. */
  label: string;
  close: () => void;
  /** A press on the backdrop; `close` unless given. Linear's fast-create modal minimizes there instead (`handleMinimize`). */
  dismiss?: () => void;
  width?: number;
  children: ReactNode;
}) {
  const box = useRef<HTMLElement>(null);
  const elevation = useElevation("dialog");
  const third = placement === "third";
  const boxProps = {
    "aria-label": label,
    ...elevation.props,
    "data-surface": "dialog",
    className: `${placement === "side" ? SIDE_PANEL_SURFACE : `${DIALOG_SURFACE} overflow-y-auto`} ui-modal-box`,
    style: placement === "side" ? undefined : { width: `min(${width}px, 100%)` },
  };
  // No overlay layer on the server: the box renders in place, so its content can be rendered statically.
  if (useServerRender())
    return (
      <div role="dialog" {...boxProps}>
        <DialogContent box={box} close={close} level={elevation.level}>
          {children}
        </DialogContent>
      </div>
    );
  return (
    <ModalOverlay
      isOpen
      isKeyboardDismissDisabled
      onOpenChange={(open) => {
        if (!open) close();
      }}
      data-backdrop
      data-placement={placement}
      className="ui-modal-overlay"
      onMouseDown={(event) => pressBackdrop(event, dismiss)}
    >
      <Modal data-backdrop className="ui-modal">
        {third && <div data-backdrop className="ui-modal-spacer-above" />}
        <AriaDialog ref={box} {...boxProps}>
          <DialogContent box={box} close={close} level={elevation.level}>
            {children}
          </DialogContent>
        </AriaDialog>
        {third && <div data-backdrop className="ui-modal-spacer-below" />}
      </Modal>
    </ModalOverlay>
  );
}

/**
 * Inside React Aria's FocusScope, so on close its containment is gone before useReturnFocus moves focus out. Keys stop here
 * (the page's shortcuts don't run under a dialog) except ⌘K and ⌘/, which reach the app so the command menu still toggles, and
 * Tab, which React Aria's FocusScope handles on the document; a Tab a menu inside already used moves its highlight, so it stops.
 */
function DialogContent({
  box,
  close,
  level,
  children,
}: {
  box: RefObject<HTMLElement | null>;
  close: () => void;
  level: number;
  children: ReactNode;
}) {
  useReturnFocus(box);
  useInitialFocus(box, MENU_FOCUS);
  const context = useMemo(() => ({ close }), [close]);
  return (
    <div
      className="contents"
      onKeyDown={(event) => {
        const appKey = (event.metaKey || event.ctrlKey) && ["k", "/"].includes(event.key.toLowerCase());
        if (!appKey && !(event.key === "Tab" && !event.defaultPrevented)) event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <MenuSurfaceContext value={context}>
        <DialogContext value={context}>
          <ElevationScope level={level}>{children}</ElevationScope>
        </DialogContext>
      </MenuSurfaceContext>
    </div>
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
  /** React Aria's title slot, an h2. */
  Title: ({ className = "", ...props }: Omit<ComponentProps<typeof Heading>, "slot" | "level">) => (
    <Heading slot="title" level={2} className={`ui-dialog-title ${className}`} {...props} />
  ),
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
