import type { ReactNode } from "react";
import { ErrorBoundary, errorText } from "./error-boundary";
import { Toast } from "./toast";
import { toasts } from "./toast-queue";

/** The toast a failed overlay leaves: the app's failure title (AppError's), the overlay it was, and why. One at a time. */
export function showOverlayError(label: string, error: unknown) {
  toasts.show(
    <Toast role="alert" data-toast>
      <Toast.Title>Something went wrong</Toast.Title>
      <Toast.Close />
      <Toast.Subject>{label}</Toast.Subject>
      <Toast.Description>{errorText(error)}</Toast.Description>
    </Toast>,
    { id: "overlay-error", duration: 8000 },
  );
}

/**
 * Contains a render error to one overlay: a menu or picker (MenuSurface, so every command menu and the ⌘K palette), a toolbar
 * popover, a hover card, or the overlay Shell mounts. It closes, a toast says what failed, and the page under it keeps working
 * (ship bar blocker 3). Linear wraps an action menu in its ErrorBoundary with `fallback: null` (`tOe` around `Nqn`,
 * startup-root.CnUSfl4j.js), so a failed menu shows nothing; closing it is that. A dialog keeps its box and shows the failure in
 * it instead (Dialog), as Linear's fast-create modal does. Wrap the overlay's content once, inside its surface.
 */
export function OverlayBoundary({ label, close, children }: { label: string; close: () => void; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={null}
      onError={(error) => {
        showOverlayError(label, error);
        close();
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
