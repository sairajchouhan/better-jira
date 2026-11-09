import { remember, type Uploaded } from "./jira-media";

/**
 * Files a comment composer uploads go to Jira at once. Each is noted here before it starts, so one a reload cut off
 * mid-upload, or that a draft dropped just before leaving, is removed from Jira on the next load; its upload slot goes
 * too (R2-comments-D5). `local` is the file's local id once the upload answered.
 */
export type DraftUpload = {
  id: string;
  key: string;
  name: string;
  size: number;
  at: number;
  local?: string;
};
/** Another open tab may still be uploading or placing a file, so only entries this old are cleaned. */
export const SETTLE_MS = 2 * 60_000;
const store = (namespace: string) => `better-jira:draft-uploads:${namespace}`;
export function readDraftUploads(namespace: string): DraftUpload[] {
  try {
    const list = JSON.parse(localStorage.getItem(store(namespace)) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function edit(namespace: string, fn: (list: DraftUpload[]) => DraftUpload[]) {
  try {
    const list = fn(readDraftUploads(namespace));
    if (list.length) localStorage.setItem(store(namespace), JSON.stringify(list));
    else localStorage.removeItem(store(namespace));
  } catch {}
}
export function noteDraftUploads(namespace: string, key: string, files: File[]): string[] {
  const entries = files.map((file) => ({
    id: crypto.randomUUID(),
    key,
    name: file.name,
    size: file.size,
    at: Date.now(),
  }));
  edit(namespace, (list) => [...list, ...entries]);
  return entries.map((e) => e.id);
}
/** `locals` are the saved files' local ids, in order; without them (a failed upload) the entries go. */
export function settleDraftUploads(namespace: string, ids: string[], locals?: string[]) {
  edit(namespace, (list) =>
    list.flatMap((entry) => {
      const index = ids.indexOf(entry.id);
      if (index < 0) return [entry];
      return locals?.[index] ? [{ ...entry, local: locals[index] }] : [];
    }),
  );
}

function mediaIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    for (const v of value) mediaIds(v, ids);
    return ids;
  }
  const node = value as Record<string, any>;
  if (["media", "mediaInline"].includes(node.type) && node.attrs?.id)
    ids.add(String(node.attrs.id));
  for (const child of Object.values(node)) mediaIds(child, ids);
  return ids;
}
const slot = (entry: DraftUpload) => `better-jira:upload:${entry.key}:${entry.local}`;
function uploaded(entry: DraftUpload): Uploaded | undefined {
  try {
    return JSON.parse(localStorage.getItem(slot(entry)) ?? "null") ?? undefined;
  } catch {}
}

type Jira = {
  full: (key: string) => Promise<any>;
  remove: (key: string, attachment: string) => Promise<void>;
};
/**
 * Settles old entries: a file a draft or an unsent change still holds stays; one Jira's description or comments show
 * keeps its attachment and loses only its slot; any other is deleted from Jira. `pending` is the unsent local changes.
 */
export async function cleanDraftUploads(
  namespace: string,
  pending: string,
  jira: Jira,
  now = Date.now(),
) {
  const due = readDraftUploads(namespace).filter((entry) => now - entry.at >= SETTLE_MS);
  if (!due.length) return;
  const held = new Set<string>();
  // Drafts are stored as JSON strings of documents; read their media nodes.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.includes("-draft:"))
        mediaIds(JSON.parse(localStorage.getItem(name) ?? "null"), held);
    }
  } catch {}
  const done: string[] = [];
  const byKey = Map.groupBy(due, (entry) => entry.key);
  for (const [key, entries] of byKey) {
    let full: any;
    try {
      full = await jira.full(key);
    } catch {
      continue;
    }
    // The issue is gone: nothing left to remove.
    if (!full) {
      done.push(...entries.map((e) => e.id));
      continue;
    }
    const shown = mediaIds([
      full.fields?.description,
      ...(full.fields?.comment?.comments ?? []).map((c: any) => c.body),
    ]);
    const files: any[] = full.fields?.attachment ?? [];
    // Files whose upload did answer (any slot of this issue) are never taken for a cut-off one.
    const claimed = new Set<string>();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const name = localStorage.key(i);
        if (name?.startsWith(`better-jira:upload:${key}:`))
          claimed.add(String(JSON.parse(localStorage.getItem(name) ?? "{}")?.attachment?.id));
      }
    } catch {}
    for (const entry of entries) {
      if (entry.local && (held.has(entry.local) || pending.includes(entry.local))) continue;
      let attachment: string | undefined;
      if (entry.local) {
        const value = uploaded(entry);
        const id = value?.attachment.id,
          media = value?.attachment.mediaId;
        if (
          id &&
          files.some((f) => String(f.id) === id) &&
          !shown.has(id) &&
          !(media && shown.has(media))
        )
          attachment = id;
      } else {
        // The upload's answer never arrived (a reload cut it off): find it by name, size and time.
        const match = files.find(
          (f) =>
            !claimed.has(String(f.id)) &&
            f.filename === entry.name &&
            Number(f.size) === entry.size &&
            (!f.created || Math.abs(Date.parse(f.created) - entry.at) < 10 * 60_000) &&
            !shown.has(String(f.id)) &&
            !(f.mediaId && shown.has(f.mediaId)),
        );
        if (match) claimed.add((attachment = String(match.id)));
      }
      try {
        if (attachment) await jira.remove(key, attachment);
      } catch {
        continue;
      }
      if (entry.local) remember(key, entry.local);
      done.push(entry.id);
    }
  }
  edit(namespace, (list) => list.filter((entry) => !done.includes(entry.id)));
}

/** Cleans now, then again when the youngest entry is old enough. */
export async function keepDraftUploadsClean(namespace: string, pending: () => string, jira: Jira) {
  await cleanDraftUploads(namespace, pending(), jira).catch(() => {});
  const next = Math.min(...readDraftUploads(namespace).map((e) => e.at + SETTLE_MS - Date.now()));
  if (Number.isFinite(next))
    setTimeout(() => void keepDraftUploadsClean(namespace, pending, jira), Math.max(next, 1000));
}
