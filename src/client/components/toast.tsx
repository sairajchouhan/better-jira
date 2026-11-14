import { createContext, use, useEffect, useMemo, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { Icon } from "./icons";
import { toasts, type ToastQueue } from "./toast-queue";
import "./control-tokens.css";
import "./toast.css";

/** Linear's ToastPresenter (`V`, `B`, `R`, ToastPresenter.DGg7fNYy.js). */
export const TOAST = { WIDTH: 384, VIEWPORT_MARGIN: 32, OFFSET: 24, MOBILE_OFFSET: 16, GAP: 8, VISIBLE: 4 } as const;

const ToastContext = createContext<{ dismiss: () => void } | null>(null);

/** One visible toast: dismisses itself after its duration (paused while the queue is held) and gives its slots a way to close it. */
function Entry({ queue, id, duration, revision, children }: { queue: ToastQueue; id: string; duration: number; revision: number; children: ReactNode }) {
  const context = useMemo(() => ({ dismiss: () => queue.dismiss(id) }), [queue, id]);
  useEffect(() => {
    if (duration === Infinity) return;
    return queue.countdown(duration, context.dismiss);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- show() restarts the timer via revision; update() preserves it.
  }, [queue, context, duration, revision]);
  return (
    <li>
      <ToastContext value={context}>{children}</ToastContext>
    </li>
  );
}

/** Renders the queue's visible toasts, bottom right, as one polite live region. Mount once. */
export function ToastViewport({ queue = toasts }: { queue?: ToastQueue }) {
  const visible = useSyncExternalStore(queue.subscribe, queue.visible, queue.visible);
  // Toasts wait while the tab is hidden, as sonner's pauseWhenPageIsHidden does.
  useEffect(() => {
    const sync = () => queue.hold("hidden", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      queue.hold("hidden", false);
      queue.hold("hover", false);
    };
  }, [queue]);
  // Always mounted, so screen readers already watch the live region when the first toast lands. The pointer on any
  // toast holds them all (sonner's Toaster onMouseEnter/onMouseLeave).
  return (
    <ol
      aria-live="polite"
      aria-label="Notifications"
      className="ui-toast-viewport"
      onMouseEnter={() => queue.hold("hover", true)}
      onMouseMove={() => queue.hold("hover", true)}
      onMouseLeave={() => queue.hold("hover", false)}
    >
      {visible.toReversed().map((toast) => (
        <Entry key={toast.id} queue={queue} id={toast.id} duration={toast.duration} revision={toast.revision}>
          {toast.content}
        </Entry>
      ))}
    </ol>
  );
}

/** Dismisses the toast it sits in; for an action that should also close it. */
export function useToast() {
  const context = use(ToastContext);
  if (!context) throw new Error("useToast needs a toast rendered by ToastViewport.");
  return context;
}

function ToastRoot({ className = "", ...props }: ComponentProps<"div">) {
  return <div className={`ui-toast ${className}`} {...props} />;
}

/** The 14px image before a toast's title (Linear's toast `icon`); the lines under the title then start under its text. */
function ToastIcon({ className = "", ...props }: ComponentProps<"span">) {
  return <span aria-hidden className={`ui-toast-icon ${className}`} {...props} />;
}

function Close({ label = "Dismiss" }: { label?: string }) {
  const { dismiss } = useToast();
  return (
    <button type="button" aria-label={label} className="ui-toast-close" onClick={dismiss}>
      <Icon name="close" size={12} />
    </button>
  );
}

/** A toast's content, passed to `toasts.show(<Toast>…</Toast>)`. */
export const Toast = Object.assign(ToastRoot, {
  Title: ({ className = "", ...props }: ComponentProps<"p">) => (
    <p className={`ui-toast-title ${className}`} {...props} />
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
  Description: ({ className = "", ...props }: ComponentProps<"p">) => (
    <p className={`ui-toast-description ${className}`} {...props} />
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
