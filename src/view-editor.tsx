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
import { Icon, type IconName } from "./icons";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { MenuSurface } from "./menu-surface";
import { ViewIconPicker } from "./view-icon-picker";
import {
  beginViewEditor,
  discardViewEditor,
  get,
  setViewDraft,
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
  viewPath,
  type SavedView,
  type ViewDraft,
} from "./saved-views";
import { defaultPreferences, selectIssues } from "./view-model";
import { viewPlaceholder, issuesCSV } from "./view-editor-model";
import "./view-editor.css";

export function openViewEditor(draft: ViewDraft): void {
  beginViewEditor(draft);
}
function DraftIcon({ icon }: { icon: string }) {
  return /[^\x00-\x7F]/.test(icon) ? <span>{icon}</span> : <Icon name={icon as IconName} size={16} />;
}
type Created = { id: string; name: string; icon: string; color: string };
const createdListeners = new Set<() => void>();
let created: Created | null = null;
let toastTimer: ReturnType<typeof setTimeout>;
function showCreated(value: Created | null) {
  created = value;
  createdListeners.forEach((fn) => fn());
}
function createdToast(value: Created) {
  showCreated(value);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => showCreated(null), 8000);
}
/** Linear's "View created" toast: bottom right, check + title, the view's icon and name, then Open view. */
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
    <div role="status" data-toast className="view-created-toast">
      <span className="view-toast-check">
        <Icon name="check" size={10} />
      </span>
      <p className="view-toast-title">View created</p>
      <button type="button" aria-label="Dismiss" className="view-toast-close" onClick={() => showCreated(null)}>
        <Icon name="close" size={12} />
      </button>
      <p className="view-toast-name">
        <span style={{ color: value.color === "gray" ? "var(--view-gray)" : value.color }}>
          <DraftIcon icon={value.icon} />
        </span>
        <span className="truncate">{value.name}</span>
      </p>
      <button
        type="button"
        className="view-toast-open"
        onClick={() => {
          openSavedView(value.id);
          showCreated(null);
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const patch = (change: Partial<ViewDraft>) =>
    setViewDraft({ ...draft, ...change });
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
          if (!draft.id) createdToast({ id, name, icon: draft.icon, color: draft.color });
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
            color: draft.color === "gray" ? "var(--view-gray)" : draft.color,
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
      {error && <p role="alert">{error}</p>}
      {picker &&
        createPortal(
          <ViewIconPicker
            anchor={picker}
            icon={draft.icon}
            color={draft.color}
            onIcon={(icon) => {
              patch({ icon });
              setPicker(null);
            }}
            onColor={(color) => patch({ color })}
            close={() => setPicker(null)}
          />,
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
    new Blob([issuesCSV(issues, board)], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${view.name.replace(/[\\/:*?"<>|]/g, "_")} issues.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Linear's delete confirmation: one question, Cancel and a red Delete, centred over a dimmed page. */
export function ViewDeleteDialog({ view, close }: { view: SavedView; close: () => void }) {
  const [error, setError] = useState("");
  return (
    <MenuSurface label={`Delete view ${view.name}`} close={close} width={480}>
      <div className="view-delete">
        <h2>Delete the view "{view.name}"?</h2>
        {error && <p role="alert">{error}</p>}
        <div>
          <button type="button" className="view-delete-cancel" onClick={close}>
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            className="view-delete-confirm"
            onClick={() => {
              void deleteSavedView(view.id)
                .then(close)
                .catch((e) => setError(String(e)));
            }}
          >
            {view.kind === "tab" ? "Delete view" : "Delete"}
          </button>
        </div>
      </div>
    </MenuSurface>
  );
}
type Action = [label: string, icon: IconName, run: () => void];
/** Linear's groups: Edit/Duplicate, then Favorite (right-click only; the header has a star) and Copy link, then Delete. CSV export is only offered for custom views. */
export function viewActions(view: SavedView, favorite: boolean, contextMenu: boolean): Action[][] {
  const link = () =>
    void navigator.clipboard
      .writeText(new URL(viewPath(view), location.origin).href)
      .then(() => ui.send({ type: "toast.show", text: "Copied" }))
      .catch((e) => ui.send({ type: "toast.show", text: String(e) }));
  return [
    [
      ["Edit…", "pencil", () => openViewEditor(editViewDraft(view.id))],
      ["Duplicate…", "view", () => openViewEditor(duplicateViewDraft(view.id))],
    ],
    [
      ...(contextMenu
        ? [[favorite ? "Unfavorite" : "Favorite", favorite ? "starred" : "star", () => toggleFavorite(`view:${view.id}`)] as Action]
        : []),
      ["Copy link", "link", link],
      ...(view.kind === "custom" ? [["Export issues as CSV…", "download", () => exportView(view)] as Action] : []),
    ],
  ];
}
/** Where the view's menu is open: under its ⋯ (`anchor`) or at a right-click (`point`); "delete" once Delete was chosen. */
type MenuTarget = { anchor?: HTMLElement; point?: { x: number; y: number } } | "delete" | null;
/** The ⋯ and right-click view menu: Linear builds it as an action menu (groups split by dividers), then the delete confirmation. */
function ViewOptions({
  view,
  target,
  setTarget,
}: {
  view: SavedView;
  target: Exclude<MenuTarget, null>;
  setTarget: (target: MenuTarget) => void;
}) {
  const favorite = useStore((s) => s.favorites.includes(`view:${view.id}`));
  const close = () => setTarget(null);
  if (target === "delete") return createPortal(<ViewDeleteDialog view={view} close={close} />, document.body);
  // The action menu closes before running a row, so Delete's run replaces that close with the confirmation.
  const groups: Action[][] = [
    ...viewActions(view, favorite, !!target.point),
    [["Delete", "trash", () => setTarget("delete")]],
  ];
  const entries = groups.flatMap((group, g) =>
    group.map(([name, icon, run], i): ActionEntry => ({ name, icon, run, divider: g > 0 && i === 0 })),
  );
  return createPortal(
    <ActionMenu
      label="View options"
      anchor={target.anchor}
      point={target.point}
      entries={entries}
      close={close}
    />,
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
  const [target, setTarget] = useState<MenuTarget>(null);
  return (
    <>
      {cloneElement(
        children as ReactElement<{
          onClick: (e: MouseEvent<HTMLElement>) => void;
          "aria-expanded": boolean;
          "aria-haspopup": "dialog";
        }>,
        {
          "aria-expanded": !!target,
          "aria-haspopup": "dialog",
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            setTarget({ anchor: e.currentTarget });
          },
        },
      )}
      {target && <ViewOptions view={view} target={target} setTarget={setTarget} />}
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
  const [target, setTarget] = useState<MenuTarget>(null);
  return (
    <div
      className="contents"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setTarget({ point: { x: e.clientX, y: e.clientY } });
      }}
    >
      {children}
      {target && <ViewOptions view={view} target={target} setTarget={setTarget} />}
    </div>
  );
}
