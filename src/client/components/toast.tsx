import { createContext, use, useEffect, useMemo, useRef, type ComponentProps, type ReactNode } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import {
  Button,
  Text,
  UNSTABLE_Toast as AriaToast,
  UNSTABLE_ToastContent as AriaToastContent,
  UNSTABLE_ToastRegion as ToastRegion,
  type QueuedToast as AriaQueuedToast,
  type TextProps,
} from "react-aria-components";
import { Icon } from "./icons";
import { toasts, type QueuedToast, type ToastQueue } from "./toast-queue";
import "./control-tokens.css";
import "./toast.css";

/** Linear's ToastPresenter (`V`, `B`, `R`, ToastPresenter.DGg7fNYy.js). */
export const TOAST = { WIDTH: 384, VIEWPORT_MARGIN: 32, OFFSET: 24, MOBILE_OFFSET: 16, GAP: 8, VISIBLE: 4 } as const;

/** sonner's Toaster `hotkey` default, `["altKey","KeyT"]` (dist.DuPC_NI1.js): focuses the toasts. */
export const TOAST_HOTKEY = "Alt+[KeyT]";

const ToastContext = createContext<{ dismiss: () => void } | null>(null);

/**
 * One visible toast: React Aria's Toast (a focusable `alertdialog` that names itself from its title and description slots),
 * dismissing itself after its duration (paused while the queue is held) and giving its slots a way to close it.
 */
export function ToastEntry({ queue, toast }: { queue: ToastQueue; toast: AriaQueuedToast<QueuedToast> }) {
  const { id, duration, revision, content } = toast.content;
  const context = useMemo(() => ({ dismiss: () => queue.dismiss(id) }), [queue, id]);
  useEffect(() => {
    if (duration === Infinity) return;
    return queue.countdown(duration, context.dismiss);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- show() restarts the timer via revision; update() preserves it.
  }, [queue, context, duration, revision]);
  return (
    <AriaToast toast={toast} className="ui-toast-entry">
      <ToastContext value={context}>{content}</ToastContext>
    </AriaToast>
  );
}

/**
 * Renders the queue's visible toasts, bottom right, in React Aria's ToastRegion: a landmark (F6) that holds every deadline
 * while the pointer is on it or focus is in it, and returns focus where it came from when its toasts are gone, as sonner's
 * Toaster does (`R.current.focus({preventScroll:!0})`). Mount once.
 */
export function ToastViewport({ queue = toasts }: { queue?: ToastQueue }) {
  const region = useRef<HTMLDivElement>(null);
  // Toasts wait while the tab is hidden, as sonner's pauseWhenPageIsHidden does.
  useEffect(() => {
    const sync = () => queue.hold("hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      queue.hold("hidden", false);
      queue.hold("region", false);
    };
  }, [queue]);
  // sonner's keydown listener runs from anywhere, text fields included.
  useHotkey(TOAST_HOTKEY, () => region.current?.focus(), { ignoreInputs: false });
  return (
    <ToastRegion
      ref={region}
      queue={queue}
      // sonner's section label, `${containerAriaLabel} ${hotkey}`.
      aria-label="Notifications alt+T"
      className="ui-toast-viewport"
    >
      {({ toast }) => <ToastEntry queue={queue} toast={toast} />}
    </ToastRegion>
  );
}

/** Dismisses the toast it sits in; for an action that should also close it. */
export function useToast() {
  const context = use(ToastContext);
  if (!context) throw new Error("useToast needs a toast rendered by ToastViewport.");
  return context;
}

/** The card, React Aria's ToastContent: the part read out when the toast lands. */
function ToastRoot({ className = "", ...props }: ComponentProps<"div">) {
  return <AriaToastContent className={`ui-toast ${className}`} {...props} />;
}

/** The 14px image before a toast's title (Linear's toast `icon`); the lines under the title then start under its text. */
function ToastIcon({ className = "", ...props }: ComponentProps<"span">) {
  return <span aria-hidden className={`ui-toast-icon ${className}`} {...props} />;
}

/** React Aria's close slot: the toast's Button that closes it. */
function Close({ label = "Dismiss" }: { label?: string }) {
  return (
    <Button slot="close" aria-label={label} className="ui-toast-close">
      <Icon name="close" size={12} />
    </Button>
  );
}

type SlotText = Omit<TextProps, "slot" | "elementType" | "className"> & { className?: string; children?: ReactNode };

/** A toast's content, passed to `toasts.show(<Toast>…</Toast>)`. */
export const Toast = Object.assign(ToastRoot, {
  /** The toast's name (React Aria's title slot). */
  Title: ({ className = "", ...props }: SlotText) => (
    <Text slot="title" elementType="p" className={`ui-toast-title ${className}`} {...props} />
  ),
  Icon: ToastIcon,
  /** Linear's success image: a white check on a green disc. */
  Check: () => (
    <ToastIcon className="ui-toast-check">
      <Icon name="check" size={10} />
    </ToastIcon>
  ),
  /** What the toast is about, under the title: an issue's icon, key and title, a view's icon and name. */
  Subject: ({ className = "", ...props }: ComponentProps<"p">) => (
    <p className={`ui-toast-subject ${className}`} {...props} />
  ),
  /** The toast's description (React Aria's description slot). */
  Description: ({ className = "", ...props }: SlotText) => (
    <Text slot="description" elementType="p" className={`ui-toast-description ${className}`} {...props} />
  ),
  Actions: ({ className = "", ...props }: ComponentProps<"div">) => <div className={`ui-toast-actions ${className}`} {...props} />,
  /** A text action ("Undo", "View issue"); the toast closes after it runs. */
  Action: function Action({ className = "", onClick, type = "button", ...props }: ComponentProps<"button">) {
    const { dismiss } = useToast();
    return (
      <button
        type={type}
        className={`ui-toast-action ${className}`}
        onClick={(event) => {
          onClick?.(event);
          dismiss();
        }}
        {...props}
      />
    );
  },
  Close,
});
