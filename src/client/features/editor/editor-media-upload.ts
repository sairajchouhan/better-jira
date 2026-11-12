import { Plugin, PluginKey } from "prosemirror-state";
import { insertPoint } from "prosemirror-transform";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import type { Attachment } from "@/shared/attachment-media";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "@/shared/document";

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

export function mediaUploads(
  view: () => EditorView | null,
  save: (files: File[]) => Promise<Attachment[]>,
  changed?: (busy: boolean) => void,
  notice?: (message: string) => void,
) {
  const key = new PluginKey<Map<string, number>>("media-uploads");
  let alive = true;
  const jobs = new Map<string, { files: File[]; error?: string }>(),
    saving = new Set<string>(),
    waiting: (() => void)[] = [];
  const settle = (id: string) => {
    saving.delete(id);
    if (!saving.size) waiting.splice(0).forEach((resolve) => resolve());
  };
  const widget = (id: string) => {
    const job = jobs.get(id)!;
    const dom = document.createElement("span");
    dom.contentEditable = "false";
    dom.dataset.mediaInteractive = "true";
    dom.className = "media-upload";
    dom.setAttribute("role", job.error ? "alert" : "status");
    const label = document.createElement("span");
    label.textContent = job.error ?? `Saving ${job.files.map((file) => file.name).join(", ")}…`;
    dom.append(label);
    if (job.error)
      for (const [name, action] of [
        ["Retry", () => start(id)],
        ["Discard", () => remove(id)],
      ] as const) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = name;
        button.onmousedown = (event) => event.preventDefault();
        button.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          action();
        };
        dom.append(button);
      }
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
        if (change) {
          if (change.position === undefined) positions.delete(change.id);
          else positions.set(change.id, change.position);
        }
        return positions;
      },
    },
    props: {
      decorations: (state) =>
        DecorationSet.create(
          state.doc,
          [...(key.getState(state) ?? [])].map(([id, pos]) =>
            Decoration.widget(pos, () => widget(id), {
              key: `${id}:${jobs.get(id)?.error ?? ""}`,
              side: -1,
              stopEvent: () => true,
            }),
          ),
        ),
    },
  });
  const position = (id: string) => {
    const editor = view();
    return editor ? key.getState(editor.state)?.get(id) : undefined;
  };
  const remove = (id: string) => {
    const editor = view();
    jobs.delete(id);
    changed?.(jobs.size > 0);
    if (alive && editor) editor.dispatch(editor.state.tr.setMeta(key, { id }));
  };
  const start = async (id: string) => {
    const editor = view(),
      job = jobs.get(id),
      at = position(id);
    if (!alive || !editor || !job) return;
    if (at === undefined) {
      remove(id);
      notice?.("The attachment insertion point was removed. Choose the file again.");
      return;
    }
    job.error = undefined;
    editor.dispatch(editor.state.tr.setMeta(key, { id, position: at }));
    saving.add(id);
    try {
      const files = await save(job.files);
      const sizes = await Promise.all(
        files.map((file, index) => dimensions(job.files[index]!, file.url)),
      );
      const editor = view(),
        at = position(id);
      if (!alive || !editor) return;
      if (at === undefined) {
        remove(id);
        notice?.("Files saved to issue attachments because their insertion point was removed.");
        return;
      }
      const nodes = files.map((file, index) =>
        editor.state.schema.nodes.mediaSingle!.create({
          raw: {
            type: "mediaSingle",
            attrs: { layout: "center" },
            content: [
              {
                type: "media",
                attrs: {
                  id: file.id,
                  type: "file",
                  collection: "local",
                  localId: file.id,
                  ...sizes[index],
                },
              },
            ],
          },
        }),
      );
      // At a paragraph's start or end the files go beside it, not into it, so no empty paragraph is left behind (a drop lands at a start).
      const place = insertPoint(editor.state.doc, at, editor.state.schema.nodes.mediaSingle!) ?? at;
      editor.dispatch(editor.state.tr.replaceWith(place, place, nodes).setMeta(key, { id }));
      jobs.delete(id);
      changed?.(jobs.size > 0);
    } catch (error) {
      const editor = view(),
        at = position(id);
      if (!alive || !editor) return;
      if (at === undefined) {
        remove(id);
        notice?.(
          `${error instanceof Error ? error.message : "Could not save files locally"}. Choose the file again.`,
        );
        return;
      }
      job.error = error instanceof Error ? error.message : "Could not save files locally";
      editor.dispatch(editor.state.tr.setMeta(key, { id, position: at }));
    } finally {
      settle(id);
    }
  };
  return {
    plugin,
    busy: () => jobs.size > 0,
    /** Resolves once no file is mid-save, so an unmounting editor can still place files that finish late. */
    idle: () =>
      saving.size ? new Promise<void>((resolve) => waiting.push(resolve)) : Promise.resolve(),
    enqueue(files: File[], at?: number) {
      const editor = view();
      if (!alive || !editor || !files.length) return;
      const id = crypto.randomUUID();
      jobs.set(id, { files });
      changed?.(true);
      editor.dispatch(
        editor.state.tr.setMeta(key, { id, position: at ?? editor.state.selection.from }),
      );
      void start(id);
    },
    dispose() {
      alive = false;
      jobs.clear();
      saving.clear();
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}
