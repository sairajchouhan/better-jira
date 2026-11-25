import type { Op } from "@/shared/jira-ops";
import { issueAttachments, type Attachment } from "@/shared/attachment-media";
import { assertNever, sendWriteRequest } from "@/shared/write-transport";
import { localFile, localFileURL, retainJiraFile } from "./local-database";

/** `found`: matched after a lost answer rather than answered by Jira (see uploadAttachment). */
export type Uploaded = { attachment: Attachment & { found?: boolean }; collection: string };
const mappings = new Map<string, Uploaded>();
const slot = (key: string, id: string) => `better-jira:upload:${key}:${id}`;
function known(key: string, id: string): Uploaded | undefined {
  const name = slot(key, id);
  if (mappings.has(name)) return mappings.get(name);
  try {
    const raw = localStorage.getItem(name);
    if (raw) {
      const value = JSON.parse(raw);
      mappings.set(name, value);
      return value;
    }
  } catch {}
}
export function remember(key: string, id: string, value?: Uploaded) {
  const name = slot(key, id);
  if (value) mappings.set(name, value);
  else mappings.delete(name);
  try {
    if (value) localStorage.setItem(name, JSON.stringify(value));
    else localStorage.removeItem(name);
  } catch {}
}

/** The server answered an upload with a refusal: nothing was attached. Any other failure (a reload cutting the send off)
 *  leaves the server to finish it. */
export class UploadRefused extends Error {}
/** The server answered 503: Jira didn't answer the upload, so it may have the file. The same upload (same client id) goes
 *  again, and the server gives back what the first send made. */
export class NoAnswer extends Error {}
/** fetch's own failure: the better-jira server couldn't be reached, so the request got no answer and nothing reached Jira. */
export class Unreachable extends Error {
  constructor(cause: unknown) {
    super("Can't reach the better-jira server.", { cause });
  }
}
const request = (url: string, init?: RequestInit) =>
  fetch(url, init).catch((cause) => {
    throw new Unreachable(cause);
  });

let uploading = 0;
// A reload mid-upload cuts the send off; the replayed write sends it again under the same client id, but the browser asks first.
if (typeof window !== "undefined")
  addEventListener("beforeunload", (event) => {
    if (uploading) event.preventDefault();
  });
/** `client` is the app's id for this upload: a resend gets the attachment the first send made, and cleanup finds it by id. */
async function postAttachment(
  key: string,
  file: Blob,
  name: string,
  client: string,
): Promise<Uploaded> {
  uploading++;
  try {
    const body = new FormData();
    body.append("file", file, name);
    body.append("client", client);
    const outcome = await sendWriteRequest<Uploaded>(
      `/api/issues/${encodeURIComponent(key)}/attachments`,
      { method: "POST", body },
      { fallbackError: "Could not upload the file to Jira." },
    );
    switch (outcome.kind) {
      case "ok":
        return outcome.data;
      case "unreachable":
        throw new Unreachable(outcome.cause);
      case "no_answer":
        throw new NoAnswer(outcome.error);
      case "refused":
        throw new UploadRefused(outcome.error);
      default:
        return assertNever(outcome);
    }
  } finally {
    uploading--;
  }
}
/** Local files an editor is still placing (uploading, measuring): a write that places one waits for it (outbox `uploading`). */
const placing = new Set<string>();
/** Marks a local file an editor put in its document as still being placed until the returned function is called. Called
 *  in the step that places it, so the write that step queues waits. */
export function placingFile(id: string) {
  placing.add(id);
  return () => void placing.delete(id);
}
/** Local files whose upload failed after their editor placed them: it takes them out again, and no write sends them. */
const dropped = new Set<string>();
/** Whether `ops` place a file still uploading here. */
export function uploadingIn(ops: Op[]) {
  if (!placing.size) return false;
  const text = JSON.stringify(ops);
  return [...placing].some((id) => text.includes(`"${id}"`));
}
/**
 * Uploads a file an editor placed in its document as a local copy (`id`), the way Linear's uploading node is in the
 * document before its upload starts: a reload replays the write that places it, which sends it again under the same client
 * id and gets back the attachment this send made. A failed send goes once more at once (Linear's `retryOnFailure`).
 */
export async function uploadPlaced(key: string, id: string, file: File): Promise<Uploaded> {
  const send = () => postAttachment(key, file, file.name, id);
  try {
    const uploaded = await send().catch(send);
    remember(key, id, uploaded);
    return uploaded;
  } catch (error) {
    dropped.add(id);
    throw error;
  }
}

/** Walk every value, including future comment ops. Only local ADF media identities change. */
export async function rewriteDocuments<T>(
  value: T,
  upload: (id: string) => Promise<{ id: string; collection: string }>,
): Promise<T> {
  async function walk(value: any, inDoc = false): Promise<any> {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return Promise.all(value.map((v) => walk(v, inDoc)));
    const doc = inDoc || value.type === "doc",
      out: Record<string, any> = {};
    for (const [key, child] of Object.entries(value)) out[key] = await walk(child, doc);
    if (
      doc &&
      ["media", "mediaInline"].includes(value.type) &&
      value.attrs?.collection === "local"
    ) {
      const identity = await upload(String(value.attrs.id));
      out.attrs = { ...out.attrs, type: "file", ...identity };
      delete out.attrs.url;
    }
    return out;
  }
  return walk(value);
}

export function uploadedAttachments(
  key: string,
  full: any,
  local: Attachment[] = [],
): Attachment[] {
  for (const file of local) known(key, file.id);
  return aliasAttachments(key, issueAttachments(full));
}
export function settleUploads(key: string, full: any) {
  aliasAttachments(key, []);
  const ids = new Set(full ? issueAttachments(full).map((file) => file.id) : []);
  for (const [name, value] of mappings)
    if (name.startsWith(`better-jira:upload:${key}:`) && !ids.has(value.attachment.id))
      remember(key, name.slice(`better-jira:upload:${key}:`.length));
}
export function aliasAttachments(
  key: string,
  files: Attachment[],
  local: Attachment[] = [],
): Attachment[] {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(`better-jira:upload:${key}:`))
        known(key, name.slice(`better-jira:upload:${key}:`.length));
    }
  } catch {}
  for (const file of local) known(key, file.id);
  const aliases = new Map<string, { id: string; mediaId?: string }>();
  for (const [name, value] of mappings)
    if (name.startsWith(`better-jira:upload:${key}:`))
      aliases.set(value.attachment.id, {
        id: name.slice(`better-jira:upload:${key}:`.length),
        mediaId: value.attachment.mediaId,
      });
  return files.map((file) => ({ ...file, ...aliases.get(file.id) }));
}

/** `value` with the documents in it rid of the files their editor took out after a failed upload. */
function withoutDropped<T>(value: T): T {
  if (!dropped.size || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(withoutDropped) as T;
  if ((value as { type?: unknown }).type === "doc") return withoutLocalMedia(value, dropped);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutDropped(v)])) as T;
}

export async function prepareOps(key: string, queued: Op[]): Promise<Op[]> {
  // Written before the upload failed: the editor has since taken the file out.
  const ops = withoutDropped(queued);
  const pending = new Map<string, Promise<Uploaded>>();
  // A file uploaded for a document node gets its name from the job's attachment op, not the blob.
  const names = new Map(
    ops.flatMap((op) => (op.op === "attachment.add" ? [[op.id, op.name] as const] : [])),
  );
  const upload = (id: string, name?: string): Promise<Uploaded> => {
    const cached = known(key, id);
    if (cached) return Promise.resolve(cached);
    if (pending.has(id)) return pending.get(id)!;
    const job = (async () => {
      const blob = await localFile(id);
      if (!blob) throw new Error("This local file is unavailable.");
      const result = await postAttachment(
        key,
        blob,
        name ?? names.get(id) ?? (blob instanceof File ? blob.name : "Attachment"),
        id,
      );
      remember(key, id, result);
      return result;
    })();
    pending.set(id, job);
    return job;
  };
  // Files upload in parallel (R1-D101).
  await Promise.all(
    ops.flatMap((op) => (op.op === "attachment.add" ? [upload(op.id, op.name)] : [])),
  );
  const out: Op[] = [];
  for (const op of ops) {
    if (op.op === "attachment.add") continue;
    if (op.op === "attachment.delete") {
      const mapped = known(key, op.id),
        id = mapped?.attachment.id ?? op.id;
      if (!/^\d+$/.test(id)) continue;
      // Retain bytes for undo of deleting an attachment that originated in Jira.
      if (!(await localFileURL(op.id))) {
        const response = await request(`/api/issues/${encodeURIComponent(key)}/attachments/${id}`);
        if (!response.ok) throw new Error("Could not retain attachment for undo.");
        await retainJiraFile(op.id, await response.blob());
      }
      out.push({ ...op, id });
      continue;
    }
    out.push(
      await rewriteDocuments(op, async (id) => {
        const result = await upload(id);
        if (!result.attachment.mediaId)
          throw new Error("Jira has not supplied a media identity. Retry the edit.");
        return { id: result.attachment.mediaId, collection: result.collection };
      }),
    );
  }
  return out;
}

/** The document without media still stored only in this browser (or only the `only` ones); used to create an issue before
 *  its files can attach. */
export function withoutLocalMedia<T>(doc: T, only?: Set<string>): T {
  const walk = (node: any): any => {
    if (!node || typeof node !== "object" || !Array.isArray(node.content)) return node;
    const content = node.content
      .filter(
        (child: any) =>
          !(
            ["media", "mediaInline"].includes(child?.type) &&
            child.attrs?.collection === "local" &&
            (!only || only.has(String(child.attrs.id)))
          ),
      )
      .map(walk)
      .filter(
        (child: any) =>
          !(["mediaSingle", "mediaGroup"].includes(child?.type) && !child.content?.length),
      );
    return { ...node, content };
  };
  return walk(doc);
}
