import { Component, createContext, use, type ErrorInfo, type ReactNode } from "react";
import { Text } from "@/client/components/text";
import { Button } from "@/client/components/button";
import { EmptyState } from "@/client/components/empty-state";
import { BootScreen } from "@/client/boot-screen";
import { ChunkUnreachableError } from "@/client/lib/chunk-reload";

/** What a fallback reads (`useFailure`): the error, and `reset` to render the children again. */
export type Failure = { error: unknown; reset: () => void };
const FailureContext = createContext<Failure>({ error: undefined, reset: () => {} });
/** The failure the nearest `ErrorBoundary` is showing its fallback for. */
export const useFailure = () => use(FailureContext);

/**
 * Contains a render error to one surface: the app, a board, an overlay. Without it one throw empties #root (ship bar
 * blocker 3). `fallback` renders in the failed children's place and reads the failure with `useFailure`, so it is a plain
 * element (`<AppError />`, `<SurfaceError title="…" />`), not a render function. `onError` lets an overlay close instead.
 * Wrap a surface once where it mounts, keyed by what it shows, so a different board or issue starts clean.
 */
export class ErrorBoundary extends Component<
  { children?: ReactNode; fallback: ReactNode; onError?: (error: unknown) => void },
  { error: unknown; failed: boolean }
> {
  override state = { error: undefined as unknown, failed: false };
  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[better-jira] render error", error, info.componentStack);
    this.props.onError?.(error);
  }
  reset = () => this.setState({ error: undefined, failed: false });
  override render() {
    if (!this.state.failed) return this.props.children;
    return <FailureContext value={{ error: this.state.error, reset: this.reset }}>{this.props.fallback}</FailureContext>;
  }
}

export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error ?? "")) || "Unknown error";

/** Linear's error boundary picks its screen by the error (startup-root `Rv`): code that couldn't load offline is a network
 *  error, titled so, and only a reload gets past it (TanStack keeps a failed load's error until the next preload). */
export const isNetworkError = (error: unknown) => error instanceof ChunkUnreachableError;
/** A screen whose code couldn't load offline, in its own place: Linear's full network error (startup-root `oOe`). */
export function NetworkError({ error, className }: { error: unknown; className?: string }) {
  return (
    <EmptyState
      role="alert"
      title="Network error"
      className={className}
      actions={
        <Button variant="primary" size="medium" onClick={() => location.reload()}>
          Reload
        </Button>
      }
    >
      <p>{errorText(error)}</p>
    </EmptyState>
  );
}

/** Downloads the browser's local data; loaded on demand so a broken app module graph can still offer it. */
const backup = () =>
  import("@/client/state/local-database").then(
    (m) => m.downloadLocalBackup(),
    () => undefined,
  );

/**
 * The whole app failed to render: Linear's bootstrap error layout (`BootScreen`), with what failed, Reload, and Backup
 * so local edits are safe before anything else. Self-contained: no router, store or tooltip, which may be what broke.
 * It replaces the boot splash too, since #root then holds something that isn't loading (boot-shell.ts).
 */
export function AppError() {
  const { error } = useFailure();
  return (
    <BootScreen
      role="alert"
      title="Something went wrong"
      actions={
        <>
          <Button variant="primary" size="medium" onClick={() => location.reload()}>
            Reload
          </Button>
          <Button variant="secondary" size="medium" onClick={() => void backup()}>
            Download backup
          </Button>
        </>
      }
    >
      <Text color="muted">{errorText(error)}</Text>
      <Text color="muted">Your local edits are kept. Download a backup if this happens again after reloading.</Text>
    </BootScreen>
  );
}

/** One board failed to render: the rest of the app keeps working. Try again renders the board afresh. */
export function SurfaceError({ title }: { title: string }) {
  const { error, reset } = useFailure();
  if (isNetworkError(error)) return <NetworkError error={error} className="flex-1" />;
  return (
    <EmptyState
      role="alert"
      title={title}
      className="flex-1"
      actions={
        <>
          <Button variant="secondary" size="medium" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" size="medium" onClick={() => location.reload()}>
            Reload
          </Button>
        </>
      }
    >
      <p>{errorText(error)}</p>
    </EmptyState>
  );
}
