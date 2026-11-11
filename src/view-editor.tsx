import {
  cloneElement,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
  type JSX,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Command } from "cmdk";
import { Icon, type IconName } from "./icons";
import { Confirm, MenuSurface, MENU_INPUT, MENU_ITEM } from "./menu-surface";
import {
  beginViewEditor,
  discardViewEditor,
  get,
  set,
  ui,
  useStore,
  ME,
} from "./store";
import {
  editViewDraft,
  duplicateViewDraft,
  saveViewDraft,
  openSavedView,
  deleteSavedView,
  toggleFavorite,
  type SavedView,
  type ViewDraft,
} from "./saved-views";
import { defaultPreferences, selectIssues } from "./view-model";
import { viewPlaceholder, issuesCSV } from "./view-editor-model";
import "./view-editor.css";

export function openViewEditor(draft: ViewDraft): void {
  beginViewEditor(draft);
}
const colors = [
  ["Grey", "#8a8f98"],
  ["Dark Grey", "#555b66"],
  ["Purple", "#8d79db"],
  ["Teal", "#4db6ac"],
  ["Green", "#6abf69"],
  ["Yellow", "#e2b53e"],
  ["Orange", "#e99545"],
  ["Pink", "#d77ba9"],
  ["Red", "#dc6868"],
];
const glyphs: IconName[] = [
  "filter",
  "view",
  "star",
  "board",
  "list",
  "status",
  "user",
  "calendar",
  "label",
  "layers",
  "search",
  "check",
  "flag",
  "inbox",
];
const emojis = [
  ["🎯", "target"],
  ["🚀", "rocket"],
  ["🔥", "fire"],
  ["💡", "idea"],
  ["🐛", "bug"],
  ["✨", "sparkles"],
  ["📋", "clipboard"],
  ["💜", "heart"],
  ["🌱", "seedling"],
  ["⚡", "lightning"],
];
function DraftIcon({ icon }: { icon: string }) {
  return glyphs.includes(icon as IconName) ? (
    <Icon name={icon as IconName} size={18} />
  ) : (
    <span>{icon === "filter" ? "☷" : icon}</span>
  );
}
const createdListeners = new Set<() => void>();
let created: { id: string; name: string } | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
function createdToast(id: string, name: string) {
  created = { id, name };
  createdListeners.forEach((fn) => fn());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    created = null;
    createdListeners.forEach((fn) => fn());
  }, 8000);
}
function ViewCreatedToast() {
  const value = useSyncExternalStore(
    (fn) => {
      createdListeners.add(fn);
      return () => {
        createdListeners.delete(fn);
      };
    },
    () => created,
  );
  if (!value) return null;
  return createPortal(
    <div
      role="status"
      data-toast
      className="fixed right-4 bottom-10 z-50 flex items-center gap-3 rounded-lg border border-line-2 bg-card px-3 py-2 text-[13px] text-fg shadow-lg"
    >
      <div>
        View created<p className="mt-1 text-[12px] text-fg-3">{value.name}</p>
      </div>
      <button
        className="text-accent"
        onClick={() => {
          openSavedView(value.id);
          created = null;
          createdListeners.forEach((fn) => fn());
        }}
      >
        Open view
      </button>
    </div>,
    document.body,
  );
}
export function ViewEditorPage() {
  const draft = useStore((s) => s.editorDraft);
  return (
    <>
      <ViewCreatedToast />
      {draft && <Editor key={draft.id ?? "new"} draft={draft} />}
    </>
  );
}
function Editor({ draft }: { draft: ViewDraft }) {
  const [picker, setPicker] = useState<HTMLElement | null>(null),
    [tab, setTab] = useState("Icons"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const patch = (change: Partial<ViewDraft>) =>
    set({ editorDraft: { ...draft, ...change } });
  const placeholder = viewPlaceholder(
    draft.filters,
    get().boards.find((b) => b.id === draft.board),
  );
  return (
    <form
      className="view-editor"
      aria-label={draft.id ? "Edit view" : "Create view"}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const name = draft.name.trim() || placeholder;
          const id = await saveViewDraft({ ...draft, name });
          openSavedView(id);
          if (!draft.id) createdToast(id, name);
        } catch (e) {
          setError(String(e));
          setBusy(false);
        }
      }}
    >
      <div className="view-editor-heading">
        <button
          type="button"
          aria-label="Choose view icon and color"
          className="view-icon-button"
          style={{
            color: draft.color === "gray" ? "var(--fg-3)" : draft.color,
          }}
          onClick={(e) => setPicker(e.currentTarget)}
        >
          <DraftIcon icon={draft.icon} />
        </button>
        <input
          autoFocus
          aria-label="View name"
          className="view-name"
          placeholder={placeholder}
          value={draft.name}
          maxLength={200}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <button
          type="button"
          className="view-editor-pill"
          onClick={discardViewEditor}
        >
          Cancel
        </button>
        <button
          disabled={busy}
          className="view-editor-pill view-editor-primary"
        >
          {draft.id ? "Save" : "Create view"}
        </button>
      </div>
      <input
        aria-label="View description"
        className="view-description"
        placeholder="Description (optional)"
        value={draft.description}
        onChange={(e) => patch({ description: e.target.value })}
      />
      <div className="view-editor-scope">
        <Icon name="user" />
        Personal
      </div>
      {error && <p role="alert">{error}</p>}
      {picker &&
        createPortal(
          <MenuSurface
            label="View icon"
            anchor={picker}
            width={300}
            close={() => setPicker(null)}
          >
            <Command loop>
              <Command.Input
                className={MENU_INPUT}
                placeholder="Search icons…"
              />
              <div className="flex gap-2 py-2">
                {["Icons", "Emojis"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={tab === t}
                    className="view-editor-pill hover:bg-hover"
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <Command.List className="view-icon-grid">
                <Command.Empty>No icons found</Command.Empty>
                {tab === "Icons"
                  ? glyphs.map((icon) => (
                      <Command.Item
                        key={icon}
                        value={icon}
                        onSelect={() => {
                          patch({ icon });
                          setPicker(null);
                        }}
                      >
                        <Icon name={icon} size={18} />
                      </Command.Item>
                    ))
                  : emojis.map(([icon, label]) => (
                      <Command.Item
                        key={icon}
                        value={label}
                        onSelect={() => {
                          patch({ icon });
                          setPicker(null);
                        }}
                      >
                        {icon}
                      </Command.Item>
                    ))}
              </Command.List>
            </Command>
            <div className="view-color-grid">
              {colors.map(([label, color]) => (
                <button
                  key={label}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={draft.color === color}
                  style={{ background: color }}
                  onClick={() => patch({ color: color! })}
                />
              ))}
              <label title="Custom color" className="view-custom-color">
                +
                <input
                  aria-label="Custom color"
                  type="color"
                  value={draft.color.startsWith("#") ? draft.color : "#8a8f98"}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </label>
            </div>
          </MenuSurface>,
          document.body,
        )}
    </form>
  );
}
function exportView(view: SavedView) {
  const s = get(),
    board = s.boards.find((b) => b.id === view.board);
  if (!board) return;
  const issues = selectIssues(
    [...s.issues.values()],
    board,
    { ...defaultPreferences(), ...view },
    view.mine,
    "",
    ME.id,
  );
  const url = URL.createObjectURL(
    new Blob([issuesCSV(issues)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${view.name.replace(/[^\w -]/g, "_")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Management({
  view,
  close,
  anchor,
  point,
}: {
  view: SavedView;
  close: () => void;
  anchor?: HTMLElement;
  point?: { x: number; y: number };
}) {
  const favorites = useStore((s) => s.favorites),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  const favorite = favorites.includes(`view:${view.id}`);
  const items = [
    ["Edit…", () => openViewEditor(editViewDraft(view.id))],
    ["Duplicate…", () => openViewEditor(duplicateViewDraft(view.id))],
    [
      favorite ? "Unfavorite" : "Favorite",
      () => toggleFavorite(`view:${view.id}`),
    ],
    [
      "Copy link",
      () => {
        void navigator.clipboard
          .writeText(
            new URL(`/view/${encodeURIComponent(view.id)}`, location.origin)
              .href,
          )
          .catch((e) => ui.send({ type: "toast.show", text: String(e) }));
      },
    ],
    ["Export issues as CSV…", () => exportView(view)],
  ] as const;
  return createPortal(
    confirm ? (
      <>
        <Confirm
          title={`Delete “${view.name}”?`}
          detail={`The view “${view.name}” will be permanently deleted. Issues in this view will not be deleted.${error ? ` ${error}` : ""}`}
          action={view.kind === "tab" ? "Delete view" : "Delete"}
          close={close}
          onConfirm={() => {
            void deleteSavedView(view.id)
              .then(close)
              .catch((e) => setError(String(e)));
          }}
        />
      </>
    ) : (
      <MenuSurface
        label="View options"
        close={close}
        anchor={anchor}
        point={point}
        width={240}
        fit
      >
        <Command loop>
          <Command.Input className={MENU_INPUT} placeholder="Search actions…" />
          <Command.List className="p-1">
            <Command.Empty className="p-2 text-[13px]">
              No actions found
            </Command.Empty>
            {items.map(([label, action]) => (
              <Command.Item
                key={label}
                className={MENU_ITEM}
                onSelect={() => {
                  action();
                  close();
                }}
              >
                {label}
              </Command.Item>
            ))}
            <Command.Separator className="my-1 border-t border-line-2" />
            <Command.Item
              className={`${MENU_ITEM} text-red-500`}
              onSelect={() => setConfirm(true)}
            >
              Delete
            </Command.Item>
          </Command.List>
        </Command>
      </MenuSurface>
    ),
    document.body,
  );
}
export function ViewMenu({
  view,
  children,
}: {
  view: SavedView;
  children: ReactElement;
}): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      {cloneElement(
        children as ReactElement<{
          onClick: (e: MouseEvent<HTMLElement>) => void;
          "aria-expanded": boolean;
          "aria-haspopup": "dialog";
        }>,
        {
          "aria-expanded": !!anchor,
          "aria-haspopup": "dialog",
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setAnchor(e.currentTarget);
          },
        },
      )}
      {anchor && (
        <Management view={view} anchor={anchor} close={() => setAnchor(null)} />
      )}
    </>
  );
}
export function ViewContextMenu({
  view,
  children,
}: {
  view: SavedView;
  children: ReactNode;
}): JSX.Element {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="contents"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPoint({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {point && (
        <Management view={view} point={point} close={() => setPoint(null)} />
      )}
    </div>
  );
}
