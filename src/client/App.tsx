import "@fontsource-variable/inter/opsz.css";
import "./index.css";
import { ViewsDirectory } from "@/client/features/views/views-navigation";
import { useEffect, useState } from "react";
import { ReminderPicker, ReminderDelivery } from "@/client/features/reminders/reminders";
import { useStore } from "@/client/state/store";
import { load } from "@/client/state/app-load";
import { firstKey } from "@/client/state/jira-sync";
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
import { InboxIssueActions, InboxList, InboxPane } from "@/client/routes/inbox";
import { BoardView } from "@/client/routes/board-view";
import {
  Sidebar,
  DeleteConfirm,
  StatusBar,
  StorageNotice,
  BoardHeader,
} from "@/client/features/navigation/app-chrome";
import { InboxIssuePane, IssuePage, IssueSidePanel } from "@/client/routes/issue-view";
import { IssueDocument } from "@/client/features/issue/issue-resources";
import { StatusPicker, AssignPicker } from "@/client/features/issue/issue-pickers";
import { IssueSearch, CommandPalette, HelpMenu, isPalettePage } from "@/client/features/navigation/palette";
function Hotkeys() {
  useLinearHotkeys();
  useRecordVisits();
  return null;
}
export function App() {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const document = useStore((s) => s.document);
  const overlay = useStore((s) => s.overlay);
  const open = useStore((s) => (s.panel && s.selected ? s.issues.get(s.selected) : undefined));
  // A menu opened by a shortcut over a sub-issue row changes that row's issue.
  const target = useStore((s) => s.target ?? s.selected);
  const current = useStore((s) => (target ? s.issues.get(target) : undefined));
  const loadError = useStore((s) => s.loadError);
  const inbox = useStore((s) => s.inbox);
  const viewsPage = useStore((s) => s.viewsPage);
  // Boards opened this session stay mounted (hidden) for scroll restoration; adjusted during render, not mutated.
  const [visited, setVisited] = useState(() => new Set([boardId]));
  if (!visited.has(boardId)) setVisited(new Set(visited).add(boardId));

  useEffect(() => void load(), []);

  if (!boards.length)
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
  const page = !!open && (view === "page" || !!document);

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
          {!page && !inbox && !viewsPage && <BoardHeader />}
          <div className="flex min-h-0 flex-1">
            {/* Retain visited boards for scroll restoration; do not render unopened boards. */}
            {boards
              .filter((b) => visited.has(b.id))
              .map((b) => (
                <BoardView
                  key={b.id}
                  board={b}
                  active={b.id === boardId}
                  shown={!page && !inbox && !viewsPage && b.id === boardId}
                  // Only the active board shows the selection, so J/K re-renders one board, not every visited one.
                  selected={b.id === boardId ? selected : null}
                />
              ))}
            {viewsPage && <ViewsDirectory />}
            {inbox && !page && <InboxList />}
            {open ? (
              document ? (
                <IssueDocument key={firstKey(open.key)} issue={open} id={document} />
              ) : page ? (
                <IssuePage
                  key={firstKey(open.key)}
                  issue={open}
                  actions={inbox && <InboxIssueActions />}
                />
              ) : inbox ? (
                <InboxIssuePane key={firstKey(open.key)} issue={open} />
              ) : (
                <IssueSidePanel key={firstKey(open.key)} issue={open} />
              )
            ) : (
              inbox && <InboxPane />
            )}
          </div>
        </main>
      </div>
      <ReminderDelivery />
      <StorageNotice />
      <StatusBar />
      <ToastViewport />
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
