import { storedMediaIds } from "./issue-attachments";
import { remember, type Uploaded } from "@/client/state/jira-media";

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
/** An upload whose send still has no answer after this long is given up on: the server can't say what it made. */
export const PENDING_MAX_MS = 24 * 3600_000;
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

const slot = (entry: DraftUpload) => `better-jira:upload:${entry.key}:${entry.local}`;
function uploaded(entry: DraftUpload): Uploaded | undefined {
  try {
    return JSON.parse(localStorage.getItem(slot(entry)) ?? "null") ?? undefined;
  } catch {}
}

type Jira = {
  full: (key: string) => Promise<any>;
  remove: (key: string, attachment: string) => Promise<void>;
  /** What the server made for this upload (the entry's id): its attachment id, `pending` while the send has no answer
   * yet, or undefined if the server never got it. */
  uploaded: (
    client: string,
  ) => Promise<{ id?: string; pending?: boolean; found?: boolean } | undefined>;
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
  if (!due.length) return { kept: [] as string[] };
  const held = new Set<string>();
  // Drafts are stored as JSON strings of documents; read their media nodes.
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.includes("-draft:"))
        storedMediaIds(JSON.parse(localStorage.getItem(name) ?? "null"), held);
    }
  } catch {}
  const done: string[] = [],
    kept: string[] = [];
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
    const shown = storedMediaIds([
      full.fields?.description,
      ...(full.fields?.comment?.comments ?? []).map((c: any) => c.body),
    ]);
    const files: any[] = full.fields?.attachment ?? [];
    for (const entry of entries) {
      if (entry.local && (held.has(entry.local) || pending.includes(entry.local))) continue;
      // Only the attachment this upload made, by id: from its slot, or, when the answer never arrived (a reload cut it
      // off), from the server's record of it. A file of the same name and size someone else attached is never touched.
      let id: string | undefined, media: string | undefined, found: boolean | undefined;
      try {
        if (entry.local) ({ id, mediaId: media, found } = uploaded(entry)?.attachment ?? {});
        else {
          const made = await jira.uploaded(entry.id);
          // Still uploading (a slow or large file): look again later rather than lose track of it.
          if (made?.pending && now - entry.at < PENDING_MAX_MS) continue;
          ({ id, found } = made ?? {});
        }
      } catch {
        continue;
      }
      // Matched by name and size after a lost answer, so possibly the user's own file: kept, never deleted.
      if (found) {
        kept.push(id!);
        if (entry.local) remember(key, entry.local);
        done.push(entry.id);
        continue;
      }
      const file = files.find((f) => String(f.id) === id);
      media ??= file?.mediaId;
      const attachment =
        file && !shown.has(id!) && !(media && shown.has(media)) ? String(file.id) : undefined;
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
  return { kept };
}

/** Cleans now, then again when the youngest entry is old enough. */
export async function keepDraftUploadsClean(namespace: string, pending: () => string, jira: Jira) {
  await cleanDraftUploads(namespace, pending(), jira).catch(() => {});
  const next = Math.min(...readDraftUploads(namespace).map((e) => e.at + SETTLE_MS - Date.now()));
  if (Number.isFinite(next))
    setTimeout(() => void keepDraftUploadsClean(namespace, pending, jira), Math.max(next, 1000));
}
