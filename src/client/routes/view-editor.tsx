import { showNotification } from "@/client/state/app-notifications";
import {
  cloneElement,
  useState,
  type ReactElement,
  type ReactNode,
  type JSX,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "@/client/components/icons";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Button } from "@/client/components/button";
import { ConfirmDialog } from "@/client/components/dialog";
import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";
import { ViewIconPicker } from "@/client/features/views/view-icon-picker";
import { get, useStore, ME } from "@/client/state/store";
import { beginViewEditor, discardViewEditor, setViewDraft, placeURL } from "@/client/features/navigation/app-navigation";
import {
  editViewDraft,
  duplicateViewDraft,
  saveViewDraft,
  openSavedView,
  deleteSavedView,
  toggleFavorite,
  type SavedView,
  type ViewDraft,
} from "@/client/features/views/saved-views";
import { defaultPreferences, selectIssues } from "@/shared/view-model";
import { viewPlaceholder, issuesCSV } from "@/client/features/views/view-editor-model";
import "./view-editor.css";

export function openViewEditor(draft: ViewDraft): void {
  beginViewEditor(draft);
}
function DraftIcon({ icon }: { icon: string }) {
  return /[^\x00-\x7F]/.test(icon) ? <span>{icon}</span> : <Icon name={icon as IconName} size={16} />;
}
/** Linear's "View created" toast: check + title, the view's icon and name, then Open view; 8s like Linear's. */
function createdToast({ id, name, icon, color }: { id: string; name: string; icon: string; color: string }) {
  toasts.show(
    <Toast role="status" data-toast>
      <Toast.Title className="view-toast-title">
        <span className="view-toast-check">
          <Icon name="check" size={10} />
        </span>
        View created
      </Toast.Title>
      <Toast.Close />
      <p className="view-toast-name view-toast-indent">
        <span style={{ color: color === "gray" ? "var(--view-gray)" : color }}>
          <DraftIcon icon={icon} />
        </span>
        <span className="truncate">{name}</span>
      </p>
      <Toast.Actions className="view-toast-indent">
        <Toast.Action onClick={() => openSavedView(id)}>Open view</Toast.Action>
      </Toast.Actions>
    </Toast>,
    { id: "view-created", duration: 8000 },
  );
}
export function ViewEditorPage() {
  const draft = useStore((s) => s.editorDraft);
  return draft && <Editor key={draft.id ?? "new"} draft={draft} />;
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
        {/* Linear's view icon well: a 4px-radius tinted square, no Button variant matches it. */}
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
        {/* Linear edits the name and description as borderless inline text, not its framed input (`ry`), so TextInput doesn't fit. */}
        <input
          autoFocus
          aria-label="View name"
          className="view-name"
          placeholder={placeholder}
          value={draft.name}
          maxLength={200}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <Button variant="borderless" size="small" onClick={discardViewEditor}>
          Cancel
        </Button>
        <Button type="submit" size="small" disabled={busy}>
          {draft.id ? "Save" : "Create view"}
        </Button>
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
    <ConfirmDialog
      title={`Delete the view "${view.name}"?`}
      description={error ? <span role="alert">{error}</span> : null}
      confirmLabel={view.kind === "tab" ? "Delete view" : "Delete"}
      close={close}
      onConfirm={() => {
        void deleteSavedView(view.id)
          .then(close)
          .catch((e) => setError(String(e)));
      }}
    />
  );
}
type Action = [label: string, icon: IconName, run: () => void];
/** Linear's groups: Edit/Duplicate, then Favorite (right-click only; the header has a star) and Copy link, then Delete. CSV export is only offered for custom views. */
export function viewActions(view: SavedView, favorite: boolean, contextMenu: boolean): Action[][] {
  const link = () =>
    void navigator.clipboard
      .writeText(placeURL({ to: "view", id: view.id }))
      .then(() => showNotification({ text: "Copied" }))
      .catch((e) => showNotification({ text: String(e) }));
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
      // Linear's view ⋯ (bottom-right): right edges flush under the trigger (CORE-19).
      align="end"
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
      data-menu-open={target ? "" : undefined}
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
