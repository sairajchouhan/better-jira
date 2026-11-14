import { type Board } from "@/shared/issue-model";
import { BoardBreadcrumbs, PageHeader } from "./breadcrumbs";
import { SidebarLink, SidebarViewLink, sidebarRowClass } from "./sidebar-link";
import { FavoriteButton } from "./favorite-button";
import { useActiveView, useSavedViews, createViewDraft } from "@/client/features/views/saved-views";
import { useViewSettings } from "@/client/features/views/view-settings";
import { openViewEditor, ViewMenu, ViewContextMenu, ViewEditorPage } from "@/client/features/views/view-editor";
import { ViewFavorites, SavedViewIcon } from "@/client/features/views/views-navigation";
import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { isMyIssues } from "./navigation";
import { PERSON_TABS } from "@/shared/people";
import { Icon } from "@/client/components/icons";
import { set, timed, useStore } from "@/client/state/store";
import { actions, beginCreateInView } from "@/client/state/issue-actions";
import { retryLocalStorage } from "@/client/state/app-load";
import { dismissWriteError } from "@/client/state/jira-sync";
import { dismissRecoveryNotice, downloadLocalBackup } from "@/client/state/local-database";
import { undoEdit, redoEdit } from "@/client/state/undo-history";
import { navigate, ui, openSavedView } from "./app-navigation";
import { ActionMenu, ContextMenu } from "@/client/components/action-menu";
import {
  SIDEBAR_PREFS,
  VISIBILITY,
  boardEntries,
  moreEntries,
  parseSidebarPrefs,
  sidebarItemEntries,
  visibilityOptions,
  type SidebarPrefs,
} from "./sidebar-menus";
import { BoardControls, ViewFilterBar } from "@/client/features/views/view-controls";
import { hotkeyOf, runShortcut } from "./shortcuts";
import { Button, IconButton } from "@/client/components/button";
import { Shortcut } from "@/client/components/keycap";
import { Text } from "@/client/components/text";
import { FindField } from "@/client/components/find-field";
import { ConfirmDialog, Dialog } from "@/client/components/dialog";
import { useCommand, focusNode } from "./commands";
import { markAllRead, useInboxBadge } from "@/client/features/inbox/inbox";
import { SectionDisclosure } from "@/client/components/section-disclosure";
import { SelectRow } from "@/client/components/display-options";
import { useStoredState } from "@/client/state/stored-state";

/** Linear's sidebar preferences (BJ-76): collapsed sections, and when Inbox and My issues show (Customize sidebar). */
const SIDEBAR_KEY = "better-jira:sidebar:v1";

// --- chrome ---

/** A sidebar section's heading (Boards, Views), inside its `SectionDisclosure`: its caret collapses the section and a hover "+"
 *  adds to it. */
function SectionHeading({ label, addLabel, onAdd }: { label: string; addLabel: string; onAdd: () => void }) {
  return (
    <div className="group mt-5 mb-1 flex items-center">
      <SectionDisclosure.Trigger label={label} />
      <IconButton
        label={addLabel}
        variant="muted"
        size="small"
        onClick={onAdd}
        className="-my-0.5 ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Icon name="plus" />
      </IconButton>
    </div>
  );
}

const closePeek = () => set({ sidebarPeek: false });
/** The peeking sidebar's frame: floating over the page from just below the header, so the header's Menu toggle stays reachable. */
export const SIDEBAR_PEEK = "fixed top-[41.5px] bottom-0 left-0 z-50 bg-panel shadow-lg";
/**
 * Linear's floating-sidebar backdrop (startup-root): the pointer entering, moving over or pressing the page closes the peek,
 * except over the header's leading 128px, where the Menu toggle sits (zone `top:48px; left:8px`, plus an `::after` band over
 * the header from `left:120px`). Leaving the panel alone doesn't close it.
 */
export function PeekCloseZone() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40">
      <div
        data-sidebar-peek-close
        onMouseEnter={closePeek}
        onMouseMove={closePeek}
        onMouseDown={closePeek}
        className="pointer-events-auto absolute top-12 right-0 bottom-0 left-2 after:absolute after:-top-12 after:right-0 after:left-[120px] after:h-12 after:content-['']"
      />
    </div>
  );
}

export function Sidebar({ boards }: { boards: Board[] }) {
  const views = useSavedViews();
  const hidden = useStore((s) => s.sidebarHidden);
  const open = useStore((s) => s.sidebarOpen);
  const peek = useStore((s) => s.sidebarPeek) && hidden;
  const inbox = useStore((s) => s.inbox);
  const badge = useInboxBadge();
  const [prefs, setPrefs] = useStoredState(SIDEBAR_KEY, parseSidebarPrefs, SIDEBAR_PREFS);
  const customizing = useStore((s) => s.overlay === "customize-sidebar");
  const dialog = customizing && <CustomizeSidebar prefs={prefs} setPrefs={setPrefs} />;
  const [backgroundMenu, setBackgroundMenu] = useState<{ x: number; y: number } | null>(null);
  if (hidden && !open && !peek) return dialog || null;
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
      {peek && <PeekCloseZone />}
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
        // A hidden sidebar peeked from the header's Menu button floats over the page below the header, so the toggle stays
        // reachable (Linear's floating panel `top`: r1 + mainPageMargin - 10 = 44 - hairline + 8 - 10).
        onClick={(e) => open && (e.target as Element).closest("button, a") && close()}
        // Linear wraps the sidebar's content in a contextual menu of the More rows and Customize sidebar (`Ffr`: `yPn()`); a row's
        // own menu stops the event first, and the Help trigger sits outside that content. A row's `in-data-menu-open` hover
        // reads any ancestor, so this menu marks no ancestor.
        onContextMenu={(e) => {
          if ((e.target as Element).closest("#help-menu")) return;
          e.preventDefault();
          setBackgroundMenu({ x: e.clientX, y: e.clientY });
        }}
        data-sidebar-peek={peek || undefined}
        className={`flex w-[244px] shrink-0 flex-col gap-px overflow-y-auto p-2 font-medium ${peek ? SIDEBAR_PEEK : open ? "max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:bg-panel max-md:shadow-lg" : "max-md:hidden"}`}
      >
        <div className="mb-1 flex h-11 items-center gap-2 px-2 text-fg">
          <NotchMark />
          better-jira
        </div>
        {(prefs.inbox === "Always" || inbox || (prefs.inbox === "WithNotifications" && badge > 0)) && (
          <ContextMenu
            label="Inbox options"
            entries={() => sidebarItemEntries("inbox", { prefs, setPrefs, unread: badge, markAllRead: () => void markAllRead() })}
          >
            <SidebarLink row={{ place: { to: "inbox" } }} to={{ inbox: true, selected: null, panel: false }}>
              <Icon name="inbox" /> Inbox
              {badge > 0 && (
                <Text data-inbox-badge variant="mini" color="base" className="ml-auto">
                  {badge}
                </Text>
              )}
            </SidebarLink>
          </ContextMenu>
        )}
        <SideItem onClick={() => runShortcut("search")}>
          <Icon name="search" /> Search <Shortcut className="ml-auto" keys={hotkeyOf("search")} size="small" />
        </SideItem>
        <SideItem onClick={() => beginCreateInView()}>
          <Icon name="plus" /> New issue <Shortcut className="ml-auto" keys={hotkeyOf("new")} size="small" />
        </SideItem>
        {/* Like Linear, My issues is a sidebar view rather than a tab beside Active/Backlog/All. */}
        {prefs.myIssues === "Always" && (
          <ContextMenu label="My issues options" entries={() => sidebarItemEntries("myIssues", { prefs, setPrefs })}>
            <SidebarLink row={{ place: { to: "my-issues" } }} to={{ mine: true, selected: null, panel: false }}>
              <Icon name="user" /> My issues <Shortcut className="ml-auto" keys={hotkeyOf("mine")} size="small" />
            </SidebarLink>
          </ContextMenu>
        )}
        <SidebarMore prefs={prefs} />

        <SectionDisclosure expanded={expanded("boards")} onExpandedChange={() => toggle("boards")}>
          <SectionHeading
            label="Your spaces"
            addLabel="Add space"
            onAdd={() => ui.send({ type: "overlay.open", overlay: "add-board" })}
          />
          <SectionDisclosure.Panel>
          {boards.map((b) => {
            const item = (
              <SidebarLink key={b.id} row={{ place: { to: "board", board: b.id } }} to={{ board: b.id, selected: null, panel: false }}>
                <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-sel text-[9px] font-semibold text-fg-2">
                  {b.name[0]}
                </span>
                <span className="truncate">{b.name}</span>
              </SidebarLink>
            );
            return (
              <ContextMenu key={b.id} label="Space options" entries={() => boardEntries(b, hotkeyOf("copy-url"))}>
                {item}
              </ContextMenu>
            );
          })}
          </SectionDisclosure.Panel>
        </SectionDisclosure>
        {/* Views is a section like Boards: every saved view inline, edited from its row's menu. */}
        <SectionDisclosure expanded={expanded("views")} onExpandedChange={() => toggle("views")}>
          <SectionHeading label="Views" addLabel="New view" onAdd={() => openViewEditor(createViewDraft("custom"))} />
          <SectionDisclosure.Panel>
            {views.map((v) => (
              <ViewContextMenu key={v.id} view={v}>
                <SidebarViewLink row={{ place: { to: "view", id: v.id } }} view={v}>
                  <SavedViewIcon view={v} />
                  <span className="truncate">{v.name}</span>
                </SidebarViewLink>
              </ViewContextMenu>
            ))}
          </SectionDisclosure.Panel>
        </SectionDisclosure>
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
      {backgroundMenu && (
        <ActionMenu
          label="Sidebar options"
          point={backgroundMenu}
          entries={sidebarMoreEntries(prefs)}
          close={() => setBackgroundMenu(null)}
        />
      )}
      {dialog}
    </>
  );
}

const openMyIssues = () => timed("open my issues", () => navigate({ mine: true, selected: null, panel: false }));

/** The More menu's rows, which a right-click on the sidebar's own background lists too (Linear's `yPn()` on its content). */
const sidebarMoreEntries = (prefs: SidebarPrefs) =>
  moreEntries(
    prefs,
    { inbox: () => runShortcut("inbox"), myIssues: openMyIssues },
    { inbox: hotkeyOf("inbox"), myIssues: hotkeyOf("mine") },
  );

/** Linear's sidebar "More" (`Jp.more_workspace`): shown while an item is set to "Don't show", it lists those items so they
 *  stay one click away, then ┄ Customize sidebar (`yPn`, chrome-53). */
function SidebarMore({ prefs }: { prefs: SidebarPrefs }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (prefs.inbox !== "MoreMenu" && prefs.myIssues !== "MoreMenu") return null;
  const entries = sidebarMoreEntries(prefs);
  return (
    <>
      {/* Below 768px a pick closes the sidebar; this one opens a menu inside it, so it keeps the sidebar open. */}
      <SideItem onClick={(e) => (e.stopPropagation(), setAnchor(e.currentTarget))}>
        <Icon name="dots" /> More
      </SideItem>
      {anchor && <ActionMenu label="More" anchor={anchor} entries={entries} close={() => setAnchor(null)} />}
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
  const options = (item: "inbox" | "myIssues") => visibilityOptions(item).map((v) => [v, VISIBILITY[v]] as const);
  return (
    <Dialog label="Customize sidebar" close={close} width={440}>
      {/* Linear's `rX`: the Modal header and content at 24px, sections 24px apart. */}
      <Dialog.Header className="p-6">
        <Dialog.Title>Customize sidebar</Dialog.Title>
        <Dialog.Close />
      </Dialog.Header>
      <Dialog.Body className="flex flex-col gap-6 px-6 pt-0 pb-6">
        <Text as="h3" variant="smallPlus" className="mb-2">
          Personal
        </Text>
        <SelectRow
          label="Inbox"
          value={prefs.inbox}
          options={options("inbox")}
          onChange={(inbox) => setPrefs(parseSidebarPrefs({ ...prefs, inbox }))}
        />
        <SelectRow
          label="My issues"
          value={prefs.myIssues}
          options={options("myIssues")}
          onChange={(myIssues) => setPrefs(parseSidebarPrefs({ ...prefs, myIssues }))}
        />
      </Dialog.Body>
    </Dialog>
  );
}

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

/** A sidebar row that runs an action (Search, New issue, More) rather than opening a place, so it is never active. */
const SideItem = ({ onClick, children }: { onClick: (e: MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) => (
  <button onClick={onClick} className={sidebarRowClass(false)}>
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
  // Linear's header tab is `jv` variant tab, size medium, `active` on the current one (UEe.tab / WEe.tab): the shared Button.
  return (
    <Button variant="tab" size="medium" aria-pressed={on} data-active={on || undefined} onClick={onClick}>
      {children}
    </Button>
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
  const favoriteId = activeView?.kind === "custom" ? `view:${activeView.id}` : `board:${board!.id}`;
  const personal = useStore(isMyIssues);
  const personTab = useStore((s) => s.personTab);
  return (
    <header className="shrink-0">
      <PageHeader className="relative justify-between">
        <div className="flex min-w-0 items-center pr-1 text-[13px] font-medium text-fg-2">
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
        {/* Linear's header topRight (`Wdi`): while the find field floats over it, inert and faded out (opacity .15s ease). */}
        <div
          inert={finding}
          className={`flex shrink-0 items-center transition-opacity duration-150 ease-[ease] motion-reduce:transition-none ${finding ? "pointer-events-none opacity-0" : ""}`}
        >
          <IconButton label="Search issues" variant="muted" size="small" onClick={() => runShortcut("search")} className="md:hidden">
            <Icon name="search" />
          </IconButton>
          <Button variant="muted" size="medium" icon={<Icon name="plus" />} onClick={() => beginCreateInView()}>
            New issue
          </Button>
        </div>
        {/* Linear's ContentViewHeaderInlineSearch: in the header's top row, absolute, 6px down, 8px in from the right (r2r's
            minPaddingRight), 160px at most and over the buttons (z-index 10); it fades in and out (FindField.Presence). */}
        <FindField.Presence open={finding}>
          <FindField
            id="find-in-view"
            ref={findRef}
            placeholder="Find in view…"
            defaultValue={query}
            onValueChange={(term) => ui.send({ type: "query.set", query: term })}
            onClose={() => {
              set({ findInView: false });
              ui.send({ type: "query.set", query: "" });
            }}
            className="absolute top-1.5 right-2 z-10 w-[160px]"
          >
            <FindField.Clear />
          </FindField>
        </FindField.Presence>
      </PageHeader>
      {/* Linear: custom views (and their editor) show only the breadcrumb, no team tabs. The editor floats this row's
          controls into its card, so a custom draft collapses the row. */}
      <div className={`flex flex-wrap items-center gap-1 px-2 ${custom && draft ? "" : "min-h-[43.5px] py-1"}`}>
        {/* Linear's My issues (and a user's issues) has Assigned / Created / Subscribed / Activity instead of team scopes. */}
        {personal && PERSON_TABS.map(([tab, name]) => (
          <ViewTab key={tab} on={personTab === tab} onClick={() => navigate({ personTab: tab, selected: null, panel: false })}>
            {name}
          </ViewTab>
        ))}
        {!custom && !personal && (["active", "backlog", "all"] as const).map((scope) => (
          <ViewTab
            key={scope}
            on={!activeView && !draft && prefs.scope === scope}
            onClick={() => navigate({ board: board!.id, selected: null, panel: false, scope })}
          >
            {scope === "active" ? "Active" : scope === "backlog" ? "Backlog" : "All issues"}
          </ViewTab>
        ))}
        {!custom && !personal && savedViews.filter(v => v.board === board!.id && v.kind === "tab").map(view => <ViewContextMenu key={view.id} view={view}><ViewTab on={activeView?.id === view.id || draft?.id === view.id} onClick={() => openSavedView(view)}>{view.name}</ViewTab></ViewContextMenu>)}
        {/* Linear swaps Add new view for the draft tab while a new tab view is being made. */}
        {draft && !draft.id && draft.kind === "tab" ? <span aria-current="page" className={`${PILL} bg-tab-on text-fg-3 shadow-(--tab-on-shadow)`}><SavedViewIcon view={draft} />{draft.name.trim() || "New view"}<Icon name="pencil" size={12} /></span>
          : !custom && !draft && !personal && (
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
      <ViewEditorPage />
      {board && <ViewFilterBar board={board} />}
    </header>
  );
}

// --- board ---

/** The app's logo: the Notch kit's small mark (svg/notch-small-on-*.svg, pixel-snapped for under 48px) in the theme's ink and accent. */
function NotchMark() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-[18px] shrink-0">
      <path d="M8 1A7 7 0 1 0 15 8H8Z" fill="var(--logo-ink)" />
      <rect x="10" y="1" width="5" height="5" rx="1.25" fill="var(--logo-accent)" />
    </svg>
  );
}
