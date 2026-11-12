import { FavoriteButton } from "./favorite-button";
import { navigationChoices } from "./quick-navigation";
import { useActiveView, useSavedViews, createViewDraft } from "./saved-views";
import { setScope, useViewSettings } from "./view-settings";
import { openViewEditor, ViewMenu, ViewContextMenu, ViewEditorPage } from "./view-editor";
import { ViewFavorites, SavedViewIcon } from "./views-navigation";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useRef, type ReactNode } from "react";
import { Icon, TypeDot } from "./icons";
import {
  actions,
  navigate,
  set,
  timed,
  ui,
  useStore,
  dismissRecoveryNotice,
  openSavedView,
  openAllIssues as openBoardIssues,
  beginCreate,
  downloadLocalBackup,
  issueURL,
  retryLocalStorage,
  dismissWriteError,
  undoEdit,
  redoEdit,
  removeBoard,
  type Board,
  type Issue,
} from "./store";
import { ContextMenu, type ActionEntry } from "./action-menu";
import { showNotification } from "./app-notifications";
import { BoardControls, FilterChips } from "./view-controls";
import { Modal } from "./personal-controls";
import { hotkeyOf, runShortcut } from "./shortcuts";
import { Button, IconButton } from "./button";
import { Shortcut } from "./keycap";
import { Text } from "./text";
import { TextInput } from "./field";
import { ConfirmDialog, Dialog } from "./dialog";
import { useCommand, focusNode } from "./commands";
import { useInboxBadge } from "./inbox";
import { Menu } from "./menu";
import { SectionDisclosure } from "./section-disclosure";
import { SelectRow } from "./display-options";
import { useStoredState } from "./stored-state";

/** Linear's sidebar preferences (BJ-76): collapsed sections, and when Inbox and My issues show (Customize sidebar). */
const VISIBILITY = {
  Always: "Always show",
  WithNotifications: "Show when badged",
  MoreMenu: "Don't show",
} as const;
type Visibility = keyof typeof VISIBILITY;
type SidebarPrefs = { collapsed: string[]; inbox: Visibility; myIssues: Visibility };
const SIDEBAR_PREFS: SidebarPrefs = { collapsed: [], inbox: "Always", myIssues: "Always" };
const visibility = (v: unknown): Visibility =>
  typeof v === "string" && v in VISIBILITY ? (v as Visibility) : "Always";
const parseSidebarPrefs = (raw: unknown): SidebarPrefs => {
  const r = (raw ?? {}) as Partial<Record<keyof SidebarPrefs, unknown>>;
  return {
    collapsed: Array.isArray(r.collapsed) ? r.collapsed.filter((c) => typeof c === "string") : [],
    inbox: visibility(r.inbox),
    myIssues: visibility(r.myIssues) === "WithNotifications" ? "Always" : visibility(r.myIssues),
  };
};

export function QuickNavigation({ kind }: { kind: "favorites" | "views" | "boards" }) {
  const boards = useStore((s) => s.boards);
  const savedViews = useStore((s) => s.savedViews);
  const favorites = useStore((s) => s.favorites);
  const issues = useStore((s) => s.issues);
  const close = () => ui.send({ type: "overlay.close" });
  const title =
    kind === "views" ? "Open view" : kind === "boards" ? "Open a team / board" : "Open a favorite";
  const choices = navigationChoices(kind, { boards, savedViews, favorites, issues });
  return (
    <Modal label={title} close={close} fit>
      <Menu>
        <Menu.Input autoFocus aria-label="Find view or favorite" placeholder="Search…" />
        <Menu.List maxHeight="60vh">
          <Menu.Empty>No saved {kind}</Menu.Empty>
          {choices.map((choice) => (
            <Menu.Item
              key={choice.id}
              value={choice.name}
              onSelect={() => {
                close();
                const to = choice.destination;
                if ("view" in to) openSavedView(to.view);
                else {
                  const { scope, ...route } = to;
                  navigate(route);
                  if (scope) setScope(to.board, scope);
                }
              }}
            >
              {choice.name}
            </Menu.Item>
          ))}
        </Menu.List>
      </Menu>
    </Modal>
  );
}

// --- chrome ---

export function Sidebar({ boards }: { boards: Board[] }) {
  const boardId = useStore((s) => s.board);
  const activeView = useActiveView();
  const views = useSavedViews();
  const viewsPage = useStore((s) => s.viewsPage);
  const mine = useStore((s) => s.mine);
  const hidden = useStore((s) => s.sidebarHidden);
  const open = useStore((s) => s.sidebarOpen);
  const inbox = useStore((s) => s.inbox);
  const badge = useInboxBadge();
  const [prefs, setPrefs] = useStoredState("better-jira:sidebar:v1", parseSidebarPrefs, SIDEBAR_PREFS);
  const customizing = useStore((s) => s.overlay === "customize-sidebar");
  const dialog = customizing && <CustomizeSidebar prefs={prefs} setPrefs={setPrefs} />;
  if (hidden && !open) return dialog || null;
  const close = () => set({ sidebarOpen: false });
  const expanded = (section: string) => !prefs.collapsed.includes(section);
  const toggle = (section: string) =>
    setPrefs({
      ...prefs,
      collapsed: expanded(section)
        ? [...prefs.collapsed, section]
        : prefs.collapsed.filter((c) => c !== section),
    });
  return (
    <>
      {open && (
        <button
          aria-label="Close menu"
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
        />
      )}
      <nav
        aria-label="Main navigation"
        // Below 768px the sidebar opens over the page from the Menu button or [, and closes after a pick.
        onClick={(e) => open && (e.target as Element).closest("button") && close()}
        className={`flex w-[244px] shrink-0 flex-col gap-px overflow-y-auto p-2 font-medium ${open ? "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:bg-panel max-md:shadow-lg" : "max-md:hidden"}`}
      >
        <div className="mb-1 flex h-11 items-center gap-2 px-2 text-fg">
          <span className="grid size-[18px] place-items-center rounded-[5px] bg-accent text-[10px] font-semibold text-white">
            bj
          </span>
          better-jira
        </div>
        {(prefs.inbox === "Always" || inbox || (prefs.inbox === "WithNotifications" && badge > 0)) && (
          <SideItem active={inbox} onClick={() => timed("open inbox", () => runShortcut("inbox"))}>
            <Icon name="inbox" /> Inbox
            {badge > 0 && (
              <Text data-inbox-badge variant="mini" color="base" className="ml-auto">
                {badge}
              </Text>
            )}
          </SideItem>
        )}
        <SideItem onClick={() => runShortcut("search")}>
          <Icon name="search" /> Search <Shortcut className="ml-auto" keys={hotkeyOf("search")} size="small" />
        </SideItem>
        <SideItem onClick={() => beginCreate()}>
          <Icon name="plus" /> New issue <Shortcut className="ml-auto" keys={hotkeyOf("new")} size="small" />
        </SideItem>
        {/* Like Linear, My issues is a sidebar view rather than a tab beside Active/Backlog/All. */}
        {prefs.myIssues === "Always" && (
          <SideItem
            active={mine && !inbox && !activeView && !viewsPage}
            onClick={() => timed("open my issues", () => navigate({ mine: true, selected: null, panel: false }))}
          >
            <Icon name="user" /> My issues <Shortcut className="ml-auto" keys={hotkeyOf("mine")} size="small" />
          </SideItem>
        )}

        <div className="group mt-5 mb-1 flex items-center">
          <SectionDisclosure label="Boards" expanded={expanded("boards")} onToggle={() => toggle("boards")} />
          <IconButton
            label="Add board"
            variant="muted"
            size="small"
            onClick={() => ui.send({ type: "overlay.open", overlay: "add-board" })}
            className="-my-0.5 ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Icon name="plus" />
          </IconButton>
        </div>
        {expanded("boards") && boards.map((b) => {
          const item = (
            <SideItem
              key={b.id}
              active={!mine && !inbox && !activeView && !viewsPage && b.id === boardId}
              onClick={() =>
                timed("switch board", () => navigate({ board: b.id, selected: null, panel: false }))
              }
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-sel text-[9px] font-semibold text-fg-2">
                {b.name[0]}
              </span>
              <span className="truncate">{b.name}</span>
            </SideItem>
          );
          // A board added in the app can leave the sidebar again (BJ-24); setup's boards can't.
          return b.removable ? (
            <ContextMenu key={b.id} label="Board options" entries={() => boardEntries(b)}>
              {item}
            </ContextMenu>
          ) : (
            item
          );
        })}
        {/* Views is a section like Boards: every saved view inline; the heading opens the Views directory. */}
        {/* Navigation section heading uses aria-current styling; Button has no navigation variant. */}
        <button
          onClick={() => navigate({ board: boardId, viewsPage: true, selected: null, panel: false, inbox: false })}
          aria-current={viewsPage || undefined}
          className={`mt-5 mb-1 flex h-6 items-center rounded-md px-2 text-left text-[12px] hover:text-fg-2 ${viewsPage ? "text-fg-2" : "text-fg-3"}`}
        >
          Views
        </button>
        {views.map((v) => (
          <ViewContextMenu key={v.id} view={v}>
            <SideItem active={activeView?.id === v.id} onClick={() => timed("open view", () => openSavedView(v))}>
              <SavedViewIcon view={v} />
              <span className="truncate">{v.name}</span>
            </SideItem>
          </ViewContextMenu>
        ))}
        <ViewFavorites expanded={expanded("favorites")} onToggle={() => toggle("favorites")} />
        <Button
          variant="muted"
          id="help-menu"
          aria-label="Open Help menu"
          onClick={() => runShortcut("help")}
          className="mt-auto justify-between"
        >
          Help <Shortcut keys={hotkeyOf("help")} size="small" />
        </Button>
      </nav>
      {dialog}
    </>
  );
}

/** Linear's Customize sidebar, for the items this app has: when Inbox and My issues show. Their shortcuts still work. */
function CustomizeSidebar({
  prefs,
  setPrefs,
}: {
  prefs: SidebarPrefs;
  setPrefs: (prefs: SidebarPrefs) => void;
}) {
  const close = () => ui.send({ type: "overlay.close" });
  const options = Object.entries(VISIBILITY);
  return (
    <Dialog label="Customize sidebar" close={close} width={440}>
      <Dialog.Header>
        <Dialog.Title>Customize sidebar</Dialog.Title>
        <Dialog.Close />
      </Dialog.Header>
      <Dialog.Body>
        <Text as="h3" variant="smallPlus" className="mb-2">
          Personal
        </Text>
        <SelectRow
          label="Inbox"
          value={prefs.inbox}
          options={options}
          onChange={(inbox) => setPrefs({ ...prefs, inbox: visibility(inbox) })}
        />
        <SelectRow
          label="My issues"
          value={prefs.myIssues}
          options={options.filter(([v]) => v !== "WithNotifications")}
          onChange={(myIssues) => setPrefs({ ...prefs, myIssues: visibility(myIssues) })}
        />
      </Dialog.Body>
    </Dialog>
  );
}

const boardEntries = (board: Board): ActionEntry[] => [
  {
    name: "Remove from sidebar",
    icon: "close",
    run: () =>
      void removeBoard(board.id).then(
        () => showNotification({ text: `Removed ${board.name}`, detail: "Add it again from Add board." }),
        (error: Error) => set({ perf: error.message }),
      ),
  },
];

/** Linear's 28px bottom bar under the sidebar and panel; ours carries the perf readout and the local-only note. */
/** Linear's delete dialog instead of a native confirm. Jira deletes the issue's subtasks with it (deleteSubtasks=true), so it names them. */
export function DeleteConfirm() {
  const key = useStore((s) => s.deleting);
  // Mounted only while deleting, so a Jira poll doesn't re-render the closed dialog.
  return key ? <DeleteDialog issueKey={key} /> : null;
}
function DeleteDialog({ issueKey: key }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(key)),
    issues = useStore((s) => s.issues),
    types = useStore((s) => s.options.types);
  if (!issue) return null;
  const levels = types?.[issue.project?.key ?? ""];
  // Subtasks go with the issue; an epic's own children (level 0 and up) stay in Jira, unparented.
  const subtasks = [...issues.values()].filter(
    (i) => i.parent === key && (levels?.find((t) => t.name === i.type)?.hierarchyLevel ?? -1) < 0,
  );
  const close = () => set({ deleting: null });
  return (
    <ConfirmDialog
      title={`Delete "${key} ‒ ${issue.summary}"?`}
      description={`${
        subtasks.length
          ? `This also deletes its ${subtasks.length} sub-issue${subtasks.length === 1 ? "" : "s"} (${subtasks.map((i) => i.key).join(", ")}). `
          : ""
      }Jira can't restore deleted issues, so this can't be undone.`}
      confirmLabel={subtasks.length ? `Delete ${subtasks.length + 1} issues` : "Delete"}
      onConfirm={() => {
        close();
        actions.remove(key, true);
      }}
      close={close}
    />
  );
}

export function StatusBar() {
  const perf = useStore((s) => s.perf);
  const undo = useStore((s) => s.undoCount),
    redo = useStore((s) => s.redoCount);
  const storage = useStore((s) => s.storage),
    writable = useStore((s) => s.writable),
    pending = useStore((s) => s.pendingWrites),
    writeError = useStore((s) => s.writeError);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 px-4 pb-2 text-[11px] whitespace-nowrap">
      {writable ? (
        <span
          title="Issue edits are written to Jira."
          className="flex min-w-0 items-center gap-1.5 text-emerald-500"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span className="truncate">Edits write to Jira</span>
        </span>
      ) : (
        <span
          title="Issue changes, files, and view preferences are saved in this browser."
          className="flex min-w-0 items-center gap-1.5 text-amber-500"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-amber-500" />
          <span className="truncate">Local only: nothing is sent to Jira</span>
        </span>
      )}
      {writable && (
        <span
          role="status"
          aria-label="Jira save status"
          data-jira-pending={pending}
          title={writeError?.text}
          className={`flex min-w-0 items-center gap-1 ${writeError && (!pending || writeError.retrying) ? "text-red-500" : "text-fg-3"}`}
        >
          <span className="truncate">
            {pending && writeError?.retrying
              ? `Still sending ${pending} to Jira: ${writeError.key}: ${writeError.text}`
              : pending
                ? `Sending ${pending} to Jira…`
                : writeError
                  ? `Not saved to Jira: ${writeError.key}: ${writeError.text}`
                  : "Saved to Jira"}
          </span>
          {writeError && !pending && (
            <IconButton label="Dismiss Jira save error" variant="muted" onClick={dismissWriteError}>
              <Icon name="close" />
            </IconButton>
          )}
        </span>
      )}
      <span
        role="status"
        aria-label="Local save status"
        data-storage-status={storage.status}
        className="text-fg-3"
      >
        {storage.status === "saving"
          ? "Saving…"
          : storage.status === "saved"
            ? "Saved locally"
            : storage.status === "loading"
              ? "Opening local data…"
              : "Not saved"}
      </span>
      <span className="-ml-2 flex">
        <IconButton label="Undo" shortcut={hotkeyOf("undo")} variant="muted" disabled={!undo} onClick={undoEdit}>
          <Icon name="undo" />
        </IconButton>
        <IconButton label="Redo" shortcut={hotkeyOf("redo")} variant="muted" disabled={!redo} onClick={redoEdit}>
          <Icon name="redo" />
        </IconButton>
        <IconButton
          label="Download backup"
          tooltip="Download your local changes and files"
          variant="muted"
          onClick={() => void downloadLocalBackup()}
        >
          <Icon name="download" />
        </IconButton>
      </span>
      <span className="ml-auto truncate font-mono text-emerald-500">{perf}</span>
    </footer>
  );
}

export function StorageNotice() {
  const storage = useStore((s) => s.storage);
  if (storage.status !== "error" && !storage.recovered) return null;
  return (
    <div
      role={storage.status === "error" ? "alert" : "status"}
      className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-[12px] text-fg-2"
    >
      <span className="mr-auto">{storage.message}</span>
      {storage.status === "error" && (
        <Button variant="link" size="small" onClick={() => void retryLocalStorage()}>
          Retry local storage
        </Button>
      )}
      <Button variant="link" size="small" onClick={() => void downloadLocalBackup()}>
        Download local backup
      </Button>
      {storage.recovered && storage.status !== "error" && (
        <IconButton label="Dismiss local recovery notice" variant="muted" size="small" onClick={dismissRecoveryNotice}>
          <Icon name="close" />
        </IconButton>
      )}
    </div>
  );
}

const SideItem = ({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    onClick={onClick}
    aria-current={active || undefined}
    className={`flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}
  >
    {children}
  </button>
);

// Linear's pill button: 28px, 0.5px ring drawn as a shadow, 12px/500.
const PILL =
  "flex h-7 shrink-0 items-center gap-1.5 rounded-full border-[0.5px] border-transparent px-2.5 text-[12px] font-medium";
/** A team tab: the scope tabs (Active, Backlog, All issues) and saved tab views are the same pill.
 *  Not Tabs: these are Linear's header tab links (HeaderTabLinks), navigation pressed by aria-pressed, every one in the
 *  tab order and none selected while a view is open; Tabs is a roving tablist with exactly one selected tab. */
function ViewTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={`${PILL} ${on ? "bg-tab-on text-fg shadow-(--tab-on-shadow)" : "bg-tab text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2"}`}
    >
      {children}
    </button>
  );
}

/** Linear's Menu button: below 768px it opens the hidden sidebar. */
function MenuButton() {
  return (
    <IconButton label="Menu" variant="muted" size="small" onClick={() => set({ sidebarOpen: true })} className="mr-1 md:hidden">
      <Icon name="side" />
    </IconButton>
  );
}
// Linear's breadcrumb (linear.app/…/view/…, 2026-11-11 computed styles): 24px links padded 0 5px 0 4px with matching
// negative margins, 16px icon + 6px, 13px/500 text at line-height normal, "›" with 8px sides lifted 2px; hover bg
// --crumb-hover and primary text, only colour animates (0.15s).
const CRUMB_LAST =
  "-ml-1 flex h-6 min-w-0 items-center rounded-lg pr-[5px] pl-1 transition-[color] duration-150 ease-[ease] hover:bg-(--crumb-hover) hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
const CRUMB = `-mr-[5px] ${CRUMB_LAST}`; // the current (last) crumb keeps its right padding, like Linear's current item
const CRUMB_ICON = "mr-1.5 grid w-4 shrink-0 place-items-center";
function CrumbSep({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`mx-2 -mt-0.5 shrink-0 text-fg-3 ${className}`}>›</span>;
}
export function BoardBreadcrumbs({ board, issue }: { board: Board; issue?: Issue }) {
  const mine = useStore((s) => s.mine);
  const activeView = useActiveView();
  const draft = useStore((s) => s.editorDraft);
  const saved = useSavedViews().find(v => v.id === draft?.id);
  const current = draft && saved ? { ...saved, ...draft, id: saved.id } : activeView;
  const custom = !issue && current?.kind === "custom" ? current : null;
  const openAllIssues = () => openBoardIssues(board.id);
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center text-[13px] leading-[normal] font-medium text-fg-2"
    >
      <MenuButton />
      {!mine || activeView ? <><button aria-label={board.name} title={board.name} onClick={openAllIssues} className={CRUMB}>
        <span aria-hidden="true" className={CRUMB_ICON}>
          <span className="grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{board.name[0]}</span>
        </span>
        <span className="truncate">{board.name}</span>
      </button>
      <CrumbSep className={issue ? "max-sm:hidden" : ""} /></> : null}
      {custom ? (
        <>
          <button onClick={() => navigate({ board: board.id, viewsPage: true, selected: null, panel: false, inbox: false })} className={`${CRUMB} shrink-0`}>
            Views
          </button>
          <CrumbSep />
          {/* Linear: the current view is plain text (right-click for its menu), not a link. */}
          <ViewContextMenu view={custom}>
            <span aria-current="page" className="flex h-6 min-w-0 items-center">
              <span className={CRUMB_ICON}><SavedViewIcon view={custom} /></span>
              <h2 className="truncate font-medium">{custom.name}</h2>
            </span>
          </ViewContextMenu>
        </>
      ) : (
        <button
          aria-label={!activeView && mine ? "My issues" : "Issues"}
          aria-current={issue ? undefined : "page"}
          onClick={openAllIssues}
          className={`${CRUMB} shrink-0 ${issue ? "max-sm:hidden" : ""}`}
        >
          {!activeView && mine ? "My issues" : "Issues"}
        </button>
      )}
      {issue && (
        <>
          <CrumbSep />
          {/* The key never truncates (Opus review 4: at 390px it vanished): the title truncates, and below 640px the Issues crumb gives way. */}
          <a aria-current="page" className={CRUMB_LAST} href={issueURL(issue)} target="_blank" rel="noreferrer">
            <span className={CRUMB_ICON}><TypeDot type={issue.type} /></span>
            <span data-crumb-issue className="flex min-w-0">
              <span className="mr-[5.6px] shrink-0 tracking-[-0.24px]">{issue.key}</span>
              <span className="truncate">{issue.summary}</span>
            </span>
          </a>
        </>
      )}
    </nav>
  );
}

export function BoardHeader() {
  const activeView = useActiveView();
  const savedViews = useSavedViews();
  const board = useStore((s) => s.boards.find((b) => b.id === s.board));
  const query = useStore((s) => s.query);
  const draft = useStore((s) => s.editorDraft);
  const custom = (draft ?? activeView)?.kind === "custom";
  const details = useStore((s) => s.details);
  const prefs = useViewSettings(board!.id);
  const finding = useStore((s) => s.findInView);
  const findRef = useRef<HTMLInputElement>(null);
  useCommand("focus-find", () => focusNode(findRef.current));
  useHotkey(
    "Escape",
    () => {
      set({ findInView: false });
      ui.send({ type: "query.set", query: "" });
      findRef.current?.blur();
    },
    { target: findRef, ignoreInputs: false },
  );
  const favoriteId = activeView?.kind === "custom" ? `view:${activeView.id}` : `board:${board!.id}`;
  return (
    <header className="shrink-0">
      <div className="flex h-11 items-center justify-between border-b-[0.5px] border-frame px-2">
        <div className="flex min-w-0 items-center pr-1 pl-2.5 text-[13px] font-medium text-fg-2">
          <BoardBreadcrumbs board={board!} />
          {/* Linear: star, then ⋯ — 28px round buttons, 14px glyphs, 4px apart; hover fills --crumb-hover and whitens the glyph. */}
          <FavoriteButton id={favoriteId} className="ml-2 shrink-0" />
          {activeView?.kind === "custom" && (
            <ViewMenu view={activeView}>
              <IconButton label="Issue view options" variant="muted" className="ml-1">
                <Icon name="dots" />
              </IconButton>
            </ViewMenu>
          )}
        </div>
        <IconButton label="Search issues" variant="muted" size="small" onClick={() => runShortcut("search")} className="ml-auto md:hidden">
          <Icon name="search" />
        </IconButton>
        <Button variant="muted" size="medium" icon={<Icon name="plus" />} onClick={() => beginCreate()}>
          New issue
        </Button>
      </div>
      {/* Linear: custom views (and their editor) show only the breadcrumb, no team tabs. The editor floats this row's
          controls into its card, so a custom draft collapses the row. */}
      <div className={`flex flex-wrap items-center gap-1 px-2 ${custom && draft ? "" : "min-h-[43.5px] py-1"}`}>
        {!custom && (["active", "backlog", "all"] as const).map((scope) => (
          <ViewTab
            key={scope}
            on={!activeView && !draft && prefs.scope === scope}
            onClick={() => { navigate({ board: board!.id, selected: null, panel: false }); setScope(board!.id, scope); }}
          >
            {scope === "active" ? "Active" : scope === "backlog" ? "Backlog" : "All issues"}
          </ViewTab>
        ))}
        {!custom && savedViews.filter(v => v.board === board!.id && v.kind === "tab").map(view => <ViewContextMenu key={view.id} view={view}><ViewTab on={activeView?.id === view.id || draft?.id === view.id} onClick={() => openSavedView(view)}>{view.name}</ViewTab></ViewContextMenu>)}
        {/* Linear swaps Add new view for the draft tab while a new tab view is being made. */}
        {draft && !draft.id && draft.kind === "tab" ? <span aria-current="page" className={`${PILL} bg-tab-on text-fg-3 shadow-(--tab-on-shadow)`}><SavedViewIcon view={draft} />{draft.name.trim() || "New view"}<Icon name="pencil" size={12} /></span>
          : !custom && !draft && (
            <Button variant="muted" size="medium" icon={<Icon name="plus" />} onClick={() => openViewEditor(createViewDraft("tab"))}>
              Add new view
            </Button>
          )}
        <div className="ml-auto flex items-center gap-1">
          <BoardControls board={board!} />
        </div>
        <IconButton
          label="Board details"
          variant="secondary"
          aria-expanded={details}
          onClick={() => (set({ details: !details }), navigate({ panel: false }))}
        >
          <Icon name="side" />
        </IconButton>
      </div>
      {finding && (
        <TextInput
          id="find-in-view"
          ref={findRef}
          aria-label="Find in view"
          autoFocus
          value={query}
          onChange={(e) => ui.send({ type: "query.set", query: e.target.value })}
          placeholder="Find in view…"
          className="mx-3 mb-2"
        />
      )}
      <ViewEditorPage />
      {board && <FilterChips board={board} />}
    </header>
  );
}

// --- board ---
