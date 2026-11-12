import {
  useActiveView,
  useOverlayFilters,
  createViewDraft,
  editViewDraft,
  duplicateViewDraft,
  saveOverlayToView,
} from "./saved-views";
import { openViewEditor, ViewDeleteDialog } from "./view-editor";
import { canMergeOverlay } from "./saved-view-model";
import { createToolbarView } from "./view-toolbar-actions";
import { Command } from "cmdk";
import { useMemo, useState, type ReactNode } from "react";
import { StatusIcon, TypeDot } from "./icons";
import {
  get,
  navigate,
  set,
  timed,
  ui,
  useStore,
  toggleFavorite,
  type Issue,
  statusOf,
} from "./store";
import { filterCount } from "./view-model";
import { Modal } from "./personal-controls";
import { Avatar } from "./avatar";
import { matchRank } from "./search-rank";
import { hotkeyOf, runShortcut, shortcutApplies, shortcuts } from "./shortcuts";
import { Shortcut } from "./keycap";
const MENU =
  "overflow-hidden rounded-xl border border-[var(--menu-line)] bg-[var(--menu)] text-fg-2 shadow-[var(--menu-shadow)] " +
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fg-3 " +
  "[&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-default [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 " +
  "[&_[cmdk-item][data-selected=true]]:bg-sel [&_[cmdk-item][data-selected=true]]:text-fg";

function Overlay({
  children,
  label = "Search issues and commands",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <Modal label={label} close={() => ui.send({ type: "overlay.close" })}>
      {children}
    </Modal>
  );
}

/** `keys`: the hotkey that does the same thing, drawn after the name. */
type Cmd = { name: string; keys?: string | readonly string[]; icon?: ReactNode; disabled?: boolean; run: () => void };

/** Issues matching every typed word: an exact key first, then title matches, then the most recently updated (top 50). */
const matchIssues = (issues: Map<string, Issue>, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const exact = q.trim().toUpperCase();
  const rank = (i: Issue) => {
    const title = matchRank(i.summary, q);
    return i.key === exact ? -1 : title < 0 ? 6 : title;
  };
  return [...issues.values()]
    .filter((i) => words.every((w) => `${i.key} ${i.summary}`.toLowerCase().includes(w)))
    .map((i) => [rank(i), i] as const)
    .sort(([ra, a], [rb, b]) => ra - rb || (a.updated < b.updated ? 1 : -1))
    .slice(0, 50)
    .map(([, i]) => i);
};

/** The palette dialog both search and ⌘K use: the input (with the scoped issue's chip), then the result groups.
 *  Not menu.tsx on purpose: Linear's ⌘K CommandMenu renders through its own large-menu compound
 *  (`WK = {List, Item, Title, GroupHeader, Divider, TextDivider, Input, Peek}` in startup-root.CnUSfl4j.js), while IB
 *  (menu.tsx) serves only its small and contextual command menus. */
function PaletteFrame({
  label,
  q,
  setQ,
  scoped,
  onBackspace,
  children,
}: {
  label: string;
  q: string;
  setQ: (q: string) => void;
  scoped?: Issue;
  /** Runs on Backspace in an empty input. */
  onBackspace?: () => void;
  children: ReactNode;
}) {
  return (
    <Overlay label={label}>
      <Command shouldFilter={false} loop className={`w-full ${MENU}`}>
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {scoped && (
            <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-sel px-2 text-[12px] text-fg-2">
              <TypeDot type={scoped.type} />
              {scoped.key}
            </span>
          )}
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && onBackspace?.()}
            placeholder={
              scoped
                ? "Type a command, or ⌫ to search everything…"
                : "Search issues or type a command…"
            }
            className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
          />
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-3 text-fg-3">No results</Command.Empty>
          {children}
        </Command.List>
      </Command>
    </Overlay>
  );
}

/** The "Issues (n)" group; picking one opens it on its board. */
function IssueResults({ results }: { results: Issue[] }) {
  if (!results.length) return null;
  return (
    <Command.Group heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}>
      {results.map((i) => (
        <Command.Item
          key={i.key}
          value={i.key}
          onSelect={() =>
            timed(
              `open ${i.key}`,
              () => (
                ui.send({ type: "overlay.close" }),
                navigate({ board: i.board, selected: i.key, panel: true }),
                ui.send({ type: "query.set", query: "" })
              ),
            )
          }
        >
          {(() => {
            const s = statusOf(i);
            return s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />;
          })()}
          <span className="w-[88px] shrink-0 text-[12px] tracking-[-0.24px] text-fg-3">
            {i.key}
          </span>
          <span className="flex-1 truncate">{i.summary}</span>
          <Avatar user={i.assignee} size={18} />
        </Command.Item>
      ))}
    </Command.Group>
  );
}

/** Search (/): issues only, the 20 most recently updated before anything is typed. */
export function IssueSearch() {
  const issues = useStore((s) => s.issues);
  const [q, setQ] = useState("");
  const results = useMemo(
    () =>
      q.trim()
        ? matchIssues(issues, q)
        : [...issues.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 20),
    [q, issues],
  );
  return (
    <PaletteFrame label="Search issues" q={q} setQ={setQ}>
      <IssueResults results={results} />
    </PaletteFrame>
  );
}

/** ⌘K: commands for the selected issue (Backspace drops it), the open view and the app, then matching issues. */
export function CommandPalette() {
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  // The ids of the shortcuts that apply now, as a string, so the palette re-renders only when that set changes.
  const applicable = useStore((s) => shortcuts.filter((e) => shortcutApplies(e, s)).map((e) => e.id).join(" "));
  const applyingIds = new Set(applicable.split(" "));
  const applies = (entry: (typeof shortcuts)[number]) => applyingIds.has(entry.id);
  const [scope, setScope] = useState(get().document ? null : get().selected);
  const [q, setQ] = useState("");
  const scoped = scope ? issues.get(scope) : undefined;
  const activeView = useActiveView();
  const overlay = useOverlayFilters();
  const favorites = useStore(s => s.favorites);
  const [deletingView, setDeletingView] = useState(false);
  const [savingTo, setSavingTo] = useState(false);
  const viewAction = (run: () => void) => () => { ui.send({ type: "overlay.close" }); run(); };
  const viewCommands: Cmd[] = activeView ? [
    { name: "Edit view…", run: viewAction(() => openViewEditor(editViewDraft(activeView.id))) },
    { name: "Save to…", run: () => { setSavingTo(true); setQ(""); } },
    { name: favorites.includes(`view:${activeView.id}`) ? "Unfavorite view" : "Favorite view", keys: hotkeyOf("view-favorite"), run: viewAction(() => toggleFavorite(`view:${activeView.id}`)) },
    { name: "Make a copy as new view…", run: viewAction(() => openViewEditor(duplicateViewDraft(activeView.id))) },
    { name: "Delete view", run: () => setDeletingView(true) },
  ] : [];
  const results = useMemo(() => (q.trim() ? matchIssues(issues, q) : []), [q, issues]);

  const command = (entry: (typeof shortcuts)[number]): Cmd => ({
    name: entry.label?.() ?? entry.name,
    keys: hotkeyOf(entry.id),
    run: () => {
      ui.send({ type: "overlay.close" });
      runShortcut(entry.id);
    },
  });
  // Only commands that would do something now, as Linear lists them.
  const issueCmds: Cmd[] = scoped
    ? shortcuts.filter((s) => s.issue && applies(s)).map(command)
    : [];
  const general: Cmd[] = [
    ...shortcuts
      .filter(
        (s, i, a) =>
          !s.issue &&
          applies(s) &&
          s.id !== "commands" &&
          a.findIndex((other) => other.name === s.name) === i,
      )
      .map(command),
    ...boards
      .filter((b) => b.id !== boardId)
      .map((b): Cmd => ({
        name: `Switch to ${b.name}`,
        run: () => {
          ui.send({ type: "overlay.close" });
          navigate({ board: b.id, selected: null, panel: false });
        },
      })),
  ];
  // Best match first, so Enter runs the command whose name was typed.
  const ranked = (cmds: Cmd[]) =>
    cmds
      .map((c) => [q.trim() ? matchRank(c.name, q) : 0, c] as const)
      .filter(([r]) => r >= 0)
      .sort(([a], [b]) => a - b);
  // Save to… mirrors the filter row's Save menu, so it is offered even before any temporary filter exists.
  const mergeable = !!activeView && !!filterCount(overlay) && canMergeOverlay(activeView.filters, overlay);
  const groups = savingTo && activeView ? [{ heading: "Save to", rows: ranked([
    { name: filterCount(overlay) && !mergeable ? "Cannot merge these filters into the view" : "Save to this view", keys: hotkeyOf("view-save"), disabled: !mergeable, run: viewAction(() => { void saveOverlayToView().catch(e => set({ perf: String(e) })); }) },
    { name: "Create new view…", keys: hotkeyOf("view-create"), run: viewAction(createToolbarView) },
  ]) }] : [
    { heading: scoped?.key ?? "", rows: ranked(issueCmds) },
    { heading: `View · ${activeView?.name ?? ""}`, rows: ranked(viewCommands) },
    { heading: "Views", rows: ranked([{ name: "Create view…", run: viewAction(() => openViewEditor(createViewDraft("custom"))) }]) },
    { heading: "General", rows: ranked(general) },
  ]
    .filter((g) => g.rows.length)
    .sort((a, b) => a.rows[0]![0] - b.rows[0]![0]);
  const item = (c: Cmd) => (
    <Command.Item key={c.name} value={`cmd:${c.name}`} disabled={c.disabled} className="data-[disabled=true]:opacity-50" onSelect={c.run}>
      <span className="grid w-4 shrink-0 place-items-center text-fg-3">{c.icon}</span>
      <span className="flex-1 truncate">{c.name}</span>
      {c.keys?.length ? <Shortcut keys={c.keys} /> : null}
    </Command.Item>
  );

  if (deletingView && activeView) return <ViewDeleteDialog view={activeView} close={() => { setDeletingView(false); ui.send({ type: "overlay.close" }); }} />;
  return (
    <PaletteFrame
      label="Search issues and commands"
      q={q}
      setQ={setQ}
      scoped={scoped}
      onBackspace={() => (savingTo ? setSavingTo(false) : setScope(null))}
    >
      {groups.map((g) => (
        <Command.Group key={g.heading} heading={g.heading}>
          {g.rows.map(([, c]) => item(c))}
        </Command.Group>
      ))}
      <IssueResults results={results} />
    </PaletteFrame>
  );
}
