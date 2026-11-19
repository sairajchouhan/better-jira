import { Plugin, PluginKey, type Transaction } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { insertPoint } from "prosemirror-transform";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Attachment } from "@/shared/attachment-media";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "@/shared/document";
import { placingFile, Unreachable } from "@/client/state/jira-media";
import { showNotification } from "@/client/state/app-notifications";

/** Media an editor placed after it was closed: its document when it closed (before) and after the late files landed. */
export type LateMedia = { before: AdfDocument; after: AdfDocument };
/** Applies late media to the content as it is now. Unchanged since the editor closed: take its whole result (files stay where they were pasted).
 * Edited since (reopened): append only the new media blocks, never the stale rest. */
export function mergeLateMedia(current: unknown, { before, after }: LateMedia): AdfDocument {
  const now = normalizeDocument(current),
    key = (node: unknown) => JSON.stringify(node);
  if (key(now) === key(normalizeDocument(before))) return after;
  const old = (before.content ?? []).map(key),
    added = (after.content ?? []).filter((node) => {
      const index = old.indexOf(key(node));
      if (index >= 0) {
        old.splice(index, 1);
        return false;
      }
      return documentHasMedia(node);
    });
  return { ...now, content: [...(now.content ?? []), ...added] };
}

async function dimensions(
  file: File,
  url: string,
): Promise<{ width: number; height: number } | undefined> {
  if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type)) {
    try {
      const bitmap = await createImageBitmap(file),
        size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return;
    }
  }
  if (file.type.startsWith("video/"))
    return new Promise((resolve) => {
      const video = document.createElement("video");
      const finish = () => {
        clearTimeout(timer);
        const size =
          video.videoWidth && video.videoHeight
            ? { width: video.videoWidth, height: video.videoHeight }
            : undefined;
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute("src");
        video.load();
        resolve(size);
      };
      const timer = setTimeout(finish, 5000);
      video.onloadedmetadata = finish;
      video.onerror = finish;
      video.preload = "metadata";
      video.src = url;
    });
}

/** How long a placed file's write waits for its size (Linear's `YAe.previewTimeoutMs`). */
const PREVIEW_TIMEOUT = 10_000;
/** Where the file `id` an upload placed sits in `doc`, as the mediaSingle holding it. */
function placed(doc: ProseMirrorNode, id: string) {
  let at: { pos: number; node: ProseMirrorNode } | undefined;
  doc.descendants((node, pos) => {
    if (at) return false;
    if (node.type.name === "mediaSingle" && node.attrs.raw?.content?.some((m: any) => m?.attrs?.id === id))
      at = { pos, node };
  });
  return at;
}

/**
 * Files picked, pasted or dropped into an editor. Like Linear's upload node (`uploadState: "uploading"`), each file is in the
 * document as soon as its local copy is kept, before its upload starts, so a reload or a closed editor never loses where it
 * went; its size follows once measured. `upload` sends it to Jira; if that fails the file leaves the document and a toast
 * says why (Linear's `Cje`, `showAlert("File failed to upload", …)`).
 */
export function mediaUploads(
  view: () => EditorView | null,
  files: {
    keep: (files: File[]) => Promise<Attachment[]>;
    upload?: (file: Attachment, picked: File) => Promise<unknown>;
  },
  changed?: (busy: boolean) => void,
  notice?: (message: string) => void,
) {
  const key = new PluginKey<Map<string, number>>("media-uploads");
  let alive = true;
  /** Picks still keeping or uploading their files, and the local ids of the files uploading. */
  const jobs = new Map<string, { files: File[] }>(),
    uploading = new Set<string>(),
    waiting: (() => void)[] = [];
  const settle = (id: string) => {
    jobs.delete(id);
    changed?.(jobs.size > 0);
    if (!jobs.size) waiting.splice(0).forEach((resolve) => resolve());
  };
  const widget = (id: string) => {
    const dom = document.createElement("span");
    dom.contentEditable = "false";
    dom.dataset.mediaInteractive = "true";
    dom.className = "media-upload";
    dom.setAttribute("role", "status");
    const label = document.createElement("span");
    label.textContent = `Saving ${jobs.get(id)!.files.map((file) => file.name).join(", ")}…`;
    dom.append(label);
    return dom;
  };
  const plugin = new Plugin<Map<string, number>>({
    key,
    state: {
      init: () => new Map(),
      apply(tr, old) {
        const positions = new Map<string, number>();
        for (const [id, start] of old) {
          let pos = start,
            removed = false;
          for (const map of tr.mapping.maps) {
            map.forEach((from, to) => {
              if (from < pos && to > pos) removed = true;
            });
            pos = map.map(pos, -1);
          }
          if (!removed) positions.set(id, pos);
        }
        const change = tr.getMeta(key);
        if (change?.id) {
          if (change.position === undefined) positions.delete(change.id);
          else positions.set(change.id, change.position);
        }
        return positions;
      },
    },
    props: {
      decorations: (state) => {
        const busy: Decoration[] = [];
        for (const id of uploading) {
          const at = placed(state.doc, id);
          if (at) busy.push(Decoration.node(at.pos, at.pos + at.node.nodeSize, { "aria-busy": "true" }));
        }
        return DecorationSet.create(state.doc, [
          ...busy,
          ...[...(key.getState(state) ?? [])].map(([id, pos]) =>
            Decoration.widget(pos, () => widget(id), {
              key: id,
              side: -1,
              stopEvent: () => true,
            }),
          ),
        ]);
      },
    },
  });
  /** Changes the file `id` placed, out of the undo history (Linear's `Gy` with `addToHistory: false`). */
  const edit = (id: string, change: (tr: Transaction, at: { pos: number; node: ProseMirrorNode }) => Transaction) => {
    const editor = view(),
      at = editor && placed(editor.state.doc, id);
    if (alive && editor && at) editor.dispatch(change(editor.state.tr, at).setMeta("addToHistory", false));
  };
  const failed = (error: unknown) =>
    showNotification({
      text: "File failed to upload",
      detail:
        error instanceof Unreachable && !navigator.onLine
          ? "Cannot upload files while being offline."
          : error instanceof Error
            ? error.message
            : "Please try again later",
      error: true,
    });
  /**
   * Measures the placed file and waits for its upload; a failed upload takes it out again. Like Linear's upload, which
   * finishes once the preview gave the file its size (`YAe.run`, up to `previewTimeoutMs`), the write placing it waits for
   * both, so it carries the size.
   */
  const send = async (file: Attachment, picked: File, placed: () => void) => {
    const measured = dimensions(picked, file.url).then((size) => {
      if (size)
        edit(file.id, (tr, { pos, node }) => {
          const raw = node.attrs.raw;
          return tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            raw: { ...raw, content: raw.content.map((m: any) => ({ ...m, attrs: { ...m.attrs, ...size } })) },
          });
        });
    });
    try {
      await Promise.all([
        Promise.race([measured, new Promise((resolve) => setTimeout(resolve, PREVIEW_TIMEOUT))]),
        files.upload?.(file, picked).catch((error) => {
          edit(file.id, (tr, { pos, node }) => tr.delete(pos, pos + node.nodeSize));
          failed(error);
        }),
      ]);
    } finally {
      placed();
      if (uploading.delete(file.id)) edit(file.id, (tr) => tr.setMeta(key, {}));
    }
  };
  const start = async (id: string) => {
    const job = jobs.get(id)!;
    try {
      const saved = await files.keep(job.files);
      const editor = view(),
        at = editor && key.getState(editor.state)?.get(id);
      if (!alive || !editor) return;
      if (at === undefined || at === null) {
        notice?.("The attachment insertion point was removed. Choose the file again.");
        return;
      }
      const nodes = saved.map((file) =>
        editor.state.schema.nodes.mediaSingle!.create({
          raw: {
            type: "mediaSingle",
            attrs: { layout: "center" },
            content: [{ type: "media", attrs: { id: file.id, type: "file", collection: "local", localId: file.id } }],
          },
        }),
      );
      // Marked before they go in, so the write the placing queues (in this same step) waits for them.
      const placed = saved.map((file) => {
        if (files.upload) uploading.add(file.id);
        return placingFile(file.id);
      });
      // At a paragraph's start or end the files go beside it, not into it, so no empty paragraph is left behind (a drop lands at a start).
      const place = insertPoint(editor.state.doc, at, editor.state.schema.nodes.mediaSingle!) ?? at;
      editor.dispatch(editor.state.tr.replaceWith(place, place, nodes).setMeta(key, { id }));
      await Promise.all(saved.map((file, index) => send(file, job.files[index]!, placed[index]!)));
    } catch (error) {
      failed(error);
    } finally {
      const editor = view();
      if (alive && editor && key.getState(editor.state)?.has(id)) editor.dispatch(editor.state.tr.setMeta(key, { id }));
      settle(id);
    }
  };
  return {
    plugin,
    busy: () => jobs.size > 0,
    /** Resolves once no file is keeping or uploading, so an unmounting editor can still place files that finish late. */
    idle: () => (jobs.size ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve()),
    enqueue(picked: File[], at?: number) {
      const editor = view();
      if (!alive || !editor || !picked.length) return;
      const id = crypto.randomUUID();
      jobs.set(id, { files: picked });
      changed?.(true);
      editor.dispatch(editor.state.tr.setMeta(key, { id, position: at ?? editor.state.selection.from }));
      void start(id);
    },
    dispose() {
      alive = false;
      jobs.clear();
      uploading.clear();
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}
