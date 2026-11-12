import "@fontsource-variable/inter/opsz.css";
import "./index.css";
import { ViewsDirectory } from "./views-navigation";
import { useEffect, useState } from "react";
import { ReminderPicker, ReminderDelivery } from "./reminders";
import { load, useStore, firstKey } from "./store";
import {
  AddBoard,
  CreateIssue,
  IssueOptions,
  PropertyPicker,
  Relations,
  Subscribers,
} from "./personal-controls";
import { Tooltips } from "./tooltip";
import { HelpMenu, ShortcutHelp, useLinearHotkeys } from "./shortcuts";
import { InboxList, InboxPane } from "./inbox";
import { BoardView } from "./board-view";
import {
  QuickNavigation,
  Sidebar,
  DeleteConfirm,
  Toast,
  StatusBar,
  StorageNotice,
  BoardHeader,
} from "./app-chrome";
import { IssueView } from "./issue-view";
import { StatusPicker, AssignPicker } from "./issue-pickers";
import { IssueSearch, CommandPalette } from "./palette";
function Hotkeys() {
  useLinearHotkeys();
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
    return (
      <div className="p-6 text-fg-3">
        {loadError ? (
          <div role="alert">
            <p>{loadError}</p>
            <p className="mt-1">Retrying automatically…</p>
            <button className="mt-3 rounded bg-sel px-3 py-2 text-fg" onClick={() => void load()}>
              Retry now
            </button>
          </div>
        ) : (
          "Loading your Jira mirror…"
        )}
      </div>
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
              <IssueView key={firstKey(open.key)} issue={open} page={page} fill={inbox} />
            ) : (
              inbox && <InboxPane />
            )}
          </div>
        </main>
      </div>
      <ReminderDelivery />
      <StorageNotice />
      <StatusBar />
      <Toast />
      {overlay === "palette" && <CommandPalette />}
      {overlay === "search" && <IssueSearch />}
      {overlay === "shortcuts" && <ShortcutHelp />}
      {overlay === "add-board" && <AddBoard />}
      {overlay === "help" && <HelpMenu />}
      {(overlay === "favorites" || overlay === "views" || overlay === "boards") && (
        <QuickNavigation kind={overlay} />
      )}
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
