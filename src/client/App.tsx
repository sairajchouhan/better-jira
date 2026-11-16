import "./index.css";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { router, ui } from "@/client/features/navigation/app-navigation";
import { AppRouterProvider } from "@/client/features/navigation/app-link";
import { ReminderPicker, ReminderDelivery } from "@/client/features/reminders/reminders";
import { InboxPushDelivery } from "@/client/features/inbox/desktop-notifications";
import { get, useStore } from "@/client/state/store";
import { chunkReload } from "@/client/lib/chunk-reload";
import { preloadAtIdle } from "@/client/lib/loadable";
import { load } from "@/client/state/app-load";
import {
  AddBoard,
  CreateIssue,
  IssueOptions,
  PropertyPicker,
  Relations,
  Subscribers,
} from "@/client/features/issue/personal-controls";
import { TitleTooltips } from "@/client/components/tooltip";
import { ToastViewport } from "@/client/components/toast";
import { AppLoading } from "@/client/components/empty-state";
import { Text } from "@/client/components/text";
import { BootScreen } from "@/client/boot-screen";
import { Button } from "@/client/components/button";
import { ErrorBoundary, SurfaceError } from "@/client/components/error-boundary";
import { OverlayBoundary } from "@/client/components/overlay-boundary";
import { ShortcutHelp, useLinearHotkeys } from "@/client/features/navigation/shortcuts";
import { useRecordVisits } from "@/client/features/navigation/recents";
import { RouteTitle } from "@/client/features/navigation/route-title-updater";
import { Preferences } from "@/client/features/navigation/preferences";
import { BoardView } from "@/client/routes/board-view";
import { InboxHost } from "@/client/routes/tree";
import { ViewPeek } from "@/client/features/views/view-peek";
import {
  Sidebar,
  DeleteConfirm,
  StatusBar,
  StorageNotice,
  BoardHeader,
} from "@/client/features/navigation/app-chrome";
import { IssueSearch, CommandPalette, HelpMenu, isPalettePage } from "@/client/features/navigation/palette";
function Hotkeys() {
  useLinearHotkeys();
  useRecordVisits();
  return null;
}
// Router devtools load in development only; production builds drop the import.
const Devtools =
  process.env.NODE_ENV === "production"
    ? () => null
    : lazy(() => import("@tanstack/react-router-devtools").then((m) => ({ default: m.TanStackRouterDevtools })));

/** Waits for the boards, then for the router to show the address, so the first paint is the address's screen. Until then
 *  the boot shell (index.html #loading) stays over the page. A load that can't finish hands over to the boot screen, which
 *  stays up through its retries (BJ-277): a first sync's progress, or the error with what to do. */
export function App() {
  const ready = useStore((s) => s.boards.length > 0);
  const [opened, setOpened] = useState(false);
  useEffect(() => void load(), []);
  useEffect(() => {
    // A first route load that fails is rethrown in render, so the app's error boundary shows it, not the splash forever.
    if (ready)
      router.load().then(
        () => setOpened(true),
        (error: unknown) =>
          setOpened(() => {
            throw error;
          }),
      );
  }, [ready]);
  useEffect(() => {
    if (opened) startedUp();
  }, [opened]);
  if (!ready || !opened) return <Booting />;
  return (
    <AppRouterProvider>
      <RouterProvider router={router} InnerWrap={Shell} />
    </AppRouterProvider>
  );
}

let walking = false;
/** The app is on screen (Linear's `loadingDone` and LoadApplicationLayout's `Sr`): a minute on, a chunk reload's tries
 *  renew; and every lazy chunk is fetched at idle, while no navigation is under way and no menu is open. */
function startedUp() {
  if (walking) return;
  walking = true;
  chunkReload.loadingDone();
  void preloadAtIdle({ canPreload: () => router.state.status === "idle" && !get().overlay && !get().toolbar });
}

/** Before the app: the boot shell while nothing has gone wrong, else the boot screen. */
function Booting() {
  const loadError = useStore((s) => s.loadError);
  const waiting = useStore((s) => s.loadWaiting);
  const [retrying, setRetrying] = useState(false);
  if (!loadError) return <AppLoading className="h-screen" />;
  if (waiting)
    return (
      <BootScreen role="status" title="Syncing your Jira boards">
        <Text color="muted">{loadError}</Text>
        <Text color="muted">The app opens as soon as your first board's first issues are in; the rest keep arriving.</Text>
      </BootScreen>
    );
  const retry = () => {
    setRetrying(true);
    void load().finally(() => setRetrying(false));
  };
  return (
    <BootScreen
      role="alert"
      title="Couldn't load your Jira data"
      actions={
        <Button variant="primary" size="medium" disabled={retrying} onClick={retry}>
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      }
    >
      <Text color="muted">{loadError}</Text>
      <Text color="muted">Retrying automatically…</Text>
    </BootScreen>
  );
}

const closeOverlay = () => ui.send({ type: "overlay.close" });
/** An overlay's name in a failure toast: "add-board" is "Add board". */
const overlayLabel = (overlay: string | null) => (overlay ? overlay[0]!.toUpperCase() + overlay.slice(1).replaceAll("-", " ") : "");

/** The frame every route renders inside: sidebar, the board header, the boards and the inbox kept mounted, overlays.
 *  `children` is the matched route: a side panel, an issue page or a document. */
function Shell({ children }: { children: ReactNode }) {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const overlay = useStore((s) => s.overlay);
  // A menu opened by a shortcut over a sub-issue row changes that row's issue.
  const target = useStore((s) => s.target ?? s.selected);
  const current = useStore((s) => (target ? s.issues.get(target) : undefined));
  // The boards show unless an issue page, the inbox or the views list covers them.
  const covered = useStore((s) => (s.panel && !!s.selected && (s.view === "page" || !!s.document)) || s.inbox);
  const sidebarHidden = useStore((s) => s.sidebarHidden);
  // Boards opened this session stay mounted (hidden) so switching back is instant; adjusted during render.
  const [visited, setVisited] = useState(() => new Set([boardId]));
  if (!visited.has(boardId)) setVisited(new Set(visited).add(boardId));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Hotkeys />
      <RouteTitle />
      <div className="flex min-h-0 flex-1">
        <Sidebar boards={boards} />
        <TitleTooltips />
        <main
          tabIndex={-1}
          // Linear's mainPageMargin (8px, startup-root) on every free side: with the sidebar hidden, the left too (BJ-276).
          className={`relative my-2 mr-2 ${sidebarHidden ? "ml-2" : ""} flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)`}
        >
          {!covered && <BoardHeader />}
          <div className="flex min-h-0 flex-1">
            {boards
              .filter((b) => visited.has(b.id))
              .map((b) => {
                const shown = !covered && b.id === boardId;
                return (
                  // A board that fails to render shows its error in its own place; a hidden one shows nothing.
                  <ErrorBoundary
                    key={b.id}
                    fallback={shown && <SurfaceError title={`Couldn't show ${b.name || "this board"}`} />}
                  >
                    <BoardView
                      board={b}
                      active={b.id === boardId}
                      shown={shown}
                      // Only the active board shows the selection, so J/K re-renders one board, not every visited one.
                      selected={b.id === boardId ? selected : null}
                    />
                  </ErrorBoundary>
                );
              })}
            <InboxHost />
            {children}
          </div>
        </main>
      </div>
      <ReminderDelivery />
      <InboxPushDelivery />
      <StorageNotice />
      <StatusBar />
      <ToastViewport />
      <ViewPeek />
      <Suspense>
        <Devtools position="bottom-right" />
      </Suspense>
      {/* The overlay open now; a render error in it, above its own surface's boundary too, closes it with a toast. */}
      <OverlayBoundary key={overlay} label={overlayLabel(overlay)} close={closeOverlay}>
        {overlay === "palette" && <CommandPalette />}
        {overlay === "search" && <IssueSearch />}
        {overlay === "shortcuts" && <ShortcutHelp />}
        {overlay === "add-board" && <AddBoard />}
        {overlay === "preferences" && <Preferences />}
        {overlay === "help" && <HelpMenu />}
        {overlay !== "help" && isPalettePage(overlay) && <CommandPalette page={overlay} />}
        {current && overlay === "assign" && <PropertyPicker issue={current} field="assignee" />}
        {current && overlay === "status" && <PropertyPicker issue={current} field="status" />}
        {overlay === "create" && <CreateIssue />}
        {current &&
          (overlay === "priority" ||
            overlay === "type" ||
            overlay === "labels" ||
            overlay === "project" ||
            overlay === "milestone" ||
            overlay === "due") && <PropertyPicker issue={current} field={overlay} />}
        {current && overlay === "options" && <IssueOptions issue={current} />}
        {current && overlay === "reminder" && <ReminderPicker issue={current} />}
        {current && overlay === "relations" && <Relations issue={current} />}
        {current && overlay === "subscribers" && <Subscribers issue={current} />}
      </OverlayBoundary>
      <DeleteConfirm />
    </div>
  );
}

export default App;
