import "@fontsource-variable/inter/opsz.css";
import "./index.css";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "@/client/features/navigation/app-navigation";
import { ReminderPicker, ReminderDelivery } from "@/client/features/reminders/reminders";
import { useStore } from "@/client/state/store";
import { load } from "@/client/state/app-load";
import {
  AddBoard,
  CreateIssue,
  IssueOptions,
  PropertyPicker,
  Relations,
  Subscribers,
} from "@/client/features/issue/personal-controls";
import { Tooltips } from "@/client/components/tooltip";
import { ToastViewport } from "@/client/components/toast";
import { EmptyState, LoadingState } from "@/client/components/empty-state";
import { Button } from "@/client/components/button";
import { ShortcutHelp, useLinearHotkeys } from "@/client/features/navigation/shortcuts";
import { useRecordVisits } from "@/client/features/navigation/recents";
import { BoardView } from "@/client/routes/board-view";
import {
  Sidebar,
  DeleteConfirm,
  StatusBar,
  StorageNotice,
  BoardHeader,
} from "@/client/features/navigation/app-chrome";
import { StatusPicker, AssignPicker } from "@/client/features/issue/issue-pickers";
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

/** Waits for the boards, then hands the address to the router. */
export function App() {
  const ready = useStore((s) => s.boards.length > 0);
  const loadError = useStore((s) => s.loadError);
  useEffect(() => void load(), []);
  if (!ready)
    return loadError ? (
      <EmptyState
        role="alert"
        title={loadError}
        actions={
          <Button variant="secondary" size="medium" onClick={() => void load()}>
            Retry now
          </Button>
        }
        className="h-screen"
      >
        <p>Retrying automatically…</p>
      </EmptyState>
    ) : (
      <LoadingState className="h-screen">Loading your Jira mirror…</LoadingState>
    );
  return <RouterProvider router={router} InnerWrap={Shell} />;
}

/** The frame every route renders inside: sidebar, the board header, the boards kept mounted, overlays.
 *  `children` is the matched route: a side panel, an issue page, a document, the inbox or the views list. */
function Shell({ children }: { children: ReactNode }) {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const overlay = useStore((s) => s.overlay);
  // A menu opened by a shortcut over a sub-issue row changes that row's issue.
  const target = useStore((s) => s.target ?? s.selected);
  const current = useStore((s) => (target ? s.issues.get(target) : undefined));
  // The boards show unless an issue page, the inbox or the views list covers them.
  const covered = useStore((s) => (s.panel && !!s.selected && (s.view === "page" || !!s.document)) || s.inbox || s.viewsPage);
  // Boards opened this session stay mounted (hidden) so switching back is instant; adjusted during render.
  const [visited, setVisited] = useState(() => new Set([boardId]));
  if (!visited.has(boardId)) setVisited(new Set(visited).add(boardId));

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Hotkeys />
      <div className="flex min-h-0 flex-1">
        <Sidebar boards={boards} />
        <Tooltips />
        <main
          tabIndex={-1}
          className="relative my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)"
        >
          {!covered && <BoardHeader />}
          <div className="flex min-h-0 flex-1">
            {boards
              .filter((b) => visited.has(b.id))
              .map((b) => (
                <BoardView
                  key={b.id}
                  board={b}
                  active={b.id === boardId}
                  shown={!covered && b.id === boardId}
                  // Only the active board shows the selection, so J/K re-renders one board, not every visited one.
                  selected={b.id === boardId ? selected : null}
                />
              ))}
            {children}
          </div>
        </main>
      </div>
      <ReminderDelivery />
      <StorageNotice />
      <StatusBar />
      <ToastViewport />
      <Suspense>
        <Devtools position="bottom-right" />
      </Suspense>
      {overlay === "palette" && <CommandPalette />}
      {overlay === "search" && <IssueSearch />}
      {overlay === "shortcuts" && <ShortcutHelp />}
      {overlay === "add-board" && <AddBoard />}
      {overlay === "help" && <HelpMenu />}
      {overlay !== "help" && isPalettePage(overlay) && <CommandPalette page={overlay} />}
      {overlay === "assign" && target && <AssignPicker issueKey={target} />}
      {overlay === "status" && target && <StatusPicker issueKey={target} />}
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
      <DeleteConfirm />
    </div>
  );
}

export default App;
