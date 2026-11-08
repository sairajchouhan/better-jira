import { validCommentStates } from "./comment-thread";
import { resourceURL, validDocumentProperties, validLinkPreview } from "./issue-resource";
import { activityFields } from "./issue-activity";
import { localFileBlob } from "./media-types";
import { validMediaEdits } from "./media-edits";
import type { Full, Issue } from "./store";

export type Snapshot = {
  issue?: Issue;
  full?: Full;
  issueFields?: string[];
  fullFields?: string[];
};
export type LocalEdit = { keys: string[]; label: string; before: Snapshot[]; after: Snapshot[] };
export type LocalChange = {
  key: string;
  issue: Issue | null;
  full?: Full;
  issueFields: string[];
  fullFields: string[];
  created: boolean;
};
export type LocalState = {
  version: 1;
  sequence: number;
  changes: LocalChange[];
  undo: LocalEdit[];
  redo: LocalEdit[];
};
export type LocalLoad = {
  state: LocalState;
  recovered: boolean;
  readOnly: boolean;
  missingFiles: number;
};
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const issueFields = new Set([
  "key",
  "board",
  "summary",
  "status",
  "type",
  "priority",
  "assignee",
  "labels",
  "parent",
  "rank",
  "comments",
  "updated",
  "resolved",
  "created",
  "creator",
  "due",
  "project",
  "description",
  "links",
  "resources",
  "commentStates",
  "reminder",
  "relations",
  "milestones",
  "prCount",
  "statusSince",
  "started",
  "watchers",
  "watchersComplete",
  "estimate",
  "projectLead",
  "attachments",
  "reactions",
  "mediaEdits",
  "descriptionHistory",
  "activity",
]);
const user = (v: unknown) =>
  v === null || (object(v) && typeof v.id === "string" && typeof v.name === "string");
const optionalArray = (value: unknown, valid: (v: any) => boolean) =>
  value === undefined || (Array.isArray(value) && value.every(valid));
function document(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === "string") return true;
  return (
    depth < 100 &&
    object(value) &&
    typeof value.type === "string" &&
    (value.text === undefined || typeof value.text === "string") &&
    optionalArray(value.marks, (m) => object(m) && typeof m.type === "string") &&
    optionalArray(value.content, (c) => document(c, depth + 1))
  );
}
const isIssue = (v: unknown, key: string): v is Issue =>
  object(v) &&
  v.key === key &&
  Number.isFinite(v.board) &&
  typeof v.summary === "string" &&
  typeof v.status === "string" &&
  strings(v.labels) &&
  typeof v.updated === "string" &&
  Number.isFinite(v.comments) &&
  user(v.assignee) &&
  ["type", "priority", "parent", "rank", "description", "created", "statusSince", "started"].every(
    (k) => v[k] === undefined || typeof v[k] === "string",
  ) &&
  (v.reminder === undefined ||
    v.reminder === null ||
    (object(v.reminder) &&
      typeof v.reminder.at === "string" &&
      Number.isFinite(Date.parse(v.reminder.at)) &&
      (v.reminder.delivered === undefined || typeof v.reminder.delivered === "boolean"))) &&
  validMediaEdits(v.mediaEdits) &&
  validCommentStates(v.commentStates, document) &&
  optionalArray(v.reactions, (r) => typeof r === "string") &&
  optionalArray(v.links, (r) => typeof r === "string") &&
  optionalArray(
    v.resources,
    (r) =>
      object(r) &&
      typeof r.id === "string" &&
      ["link", "pull-request", "document"].includes(r.kind) &&
      typeof r.title === "string" &&
      typeof r.updated === "string" &&
      (r.created === undefined || typeof r.created === "string") &&
      (r.kind === "document"
        ? document(r.body) && validDocumentProperties(r, document)
        : typeof r.url === "string" && resourceURL(r.url) !== null && validLinkPreview(r.preview)),
  ) &&
  optionalArray(
    v.attachments,
    (a) =>
      object(a) &&
      typeof a.id === "string" &&
      typeof a.name === "string" &&
      typeof a.type === "string" &&
      Number.isFinite(a.size),
  ) &&
  optionalArray(
    v.relations,
    (r) => object(r) && typeof r.key === "string" && typeof r.kind === "string",
  ) &&
  optionalArray(
    v.milestones,
    (m) => object(m) && typeof m.id === "string" && typeof m.name === "string",
  ) &&
  optionalArray(
    v.activity,
    (e) =>
      object(e) &&
      typeof e.id === "string" &&
      (activityFields.includes(e.field) || e.field === "relation") &&
      typeof e.at === "string" &&
      (e.updated === undefined || typeof e.updated === "string") &&
      object(e.actor) &&
      user(e.actor),
  ) &&
  optionalArray(v.watchers, user) &&
  optionalArray(
    v.descriptionHistory,
    (h) =>
      object(h) &&
      typeof h.text === "string" &&
      typeof h.at === "string" &&
      (h.document === undefined || document(h.document)),
  );
const isFull = (v: unknown, key: string): v is Full =>
  object(v) &&
  v.key === key &&
  object(v.fields) &&
  (v.fields.description === undefined || document(v.fields.description)) &&
  (v.fields.comment === undefined ||
    (object(v.fields.comment) &&
      Array.isArray(v.fields.comment.comments) &&
      v.fields.comment.comments.every(
        (c: any) =>
          object(c) &&
          typeof c.id === "string" &&
          (c.parentId === undefined || typeof c.parentId === "string") &&
          document(c.body),
      )));
const isSnapshot = (v: unknown, key: string): v is Snapshot =>
  object(v) &&
  (v.issue === undefined || isIssue(v.issue, key)) &&
  (v.full === undefined || isFull(v.full, key)) &&
  (v.issueFields === undefined ||
    (strings(v.issueFields) && v.issueFields.every((f) => issueFields.has(f)))) &&
  (v.fullFields === undefined ||
    (strings(v.fullFields) && v.fullFields.every((f) => ["description", "comment"].includes(f))));
function isEdit(v: unknown): v is LocalEdit {
  return (
    object(v) &&
    strings(v.keys) &&
    typeof v.label === "string" &&
    Array.isArray(v.before) &&
    Array.isArray(v.after) &&
    v.before.length === v.keys.length &&
    v.after.length === v.keys.length &&
    v.keys.every((key, i) => isSnapshot(v.before[i], key) && isSnapshot(v.after[i], key))
  );
}
export const emptyLocalState = (): LocalState => ({
  version: 1,
  sequence: 0,
  changes: [],
  undo: [],
  redo: [],
});
export function parseLocalState(raw: unknown): {
  state: LocalState;
  recovered: boolean;
  readOnly: boolean;
} {
  if (raw === undefined) return { state: emptyLocalState(), recovered: false, readOnly: false };
  if (!object(raw) || raw.version !== 1)
    return { state: emptyLocalState(), recovered: true, readOnly: true };
  const valid = (v: unknown): v is LocalChange =>
    object(v) &&
    typeof v.key === "string" &&
    (v.issue === null || isIssue(v.issue, v.key)) &&
    (v.full === undefined || isFull(v.full, v.key)) &&
    strings(v.issueFields) &&
    v.issueFields.every((f) => issueFields.has(f)) &&
    strings(v.fullFields) &&
    v.fullFields.every((f) => ["description", "comment"].includes(f)) &&
    typeof v.created === "boolean";
  const changes = Array.isArray(raw.changes) ? raw.changes.filter(valid) : [];
  const undo = Array.isArray(raw.undo) ? raw.undo.filter(isEdit).slice(-100) : [];
  const redo = Array.isArray(raw.redo) ? raw.redo.filter(isEdit).slice(-100) : [];
  const sequence = Number.isSafeInteger(raw.sequence) && raw.sequence >= 0 ? raw.sequence : 0;
  const recovered =
    !Array.isArray(raw.changes) ||
    changes.length !== raw.changes.length ||
    !Array.isArray(raw.undo) ||
    undo.length !== raw.undo.length ||
    !Array.isArray(raw.redo) ||
    redo.length !== raw.redo.length ||
    sequence !== raw.sequence;
  return { state: { version: 1, sequence, changes, undo, redo }, recovered, readOnly: false };
}

function request<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database request failed"));
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error("Local database transaction failed"));
  });
}

/** Separate databases keep two Jira accounts from sharing local edits or files. */
export class LocalDatabase {
  private urls = new Map<string, string>();
  private writable = true;
  private revision = 0;
  private constructor(private db: IDBDatabase) {}
  static async open(
    namespace: string,
    factory: IDBFactory = globalThis.indexedDB,
  ): Promise<LocalDatabase> {
    if (!factory) throw new Error("This browser does not provide local database storage.");
    const open = factory.open(`better-jira:local:v1:${namespace}`, 1);
    open.onupgradeneeded = () => {
      for (const name of ["state", "files", "recovery"])
        if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error("Could not open local data"));
      open.onblocked = () =>
        reject(new Error("Another tab is blocking the local database. Close it and retry."));
    });
    database.onversionchange = () => database.close();
    return new LocalDatabase(database);
  }
  async load(): Promise<LocalLoad> {
    const tx = this.db.transaction("state", "readonly"),
      done = completed(tx);
    const [raw] = await Promise.all([request(tx.objectStore("state").get("workspace")), done]);
    const parsed = parseLocalState(raw);
    this.writable = !parsed.readOnly;
    this.revision = object(raw) && Number.isSafeInteger(raw.revision) ? raw.revision : 0;
    if (parsed.recovered) {
      const tx = this.db.transaction("recovery", "readwrite"),
        done = completed(tx);
      tx.objectStore("recovery").put(raw, Date.now());
      await done;
    }
    let missingFiles = 0;
    const visited = new WeakSet<object>();
    const restore = async (issue: Issue | undefined | null) => {
      if (!issue || visited.has(issue)) return;
      visited.add(issue);
      for (const attachment of issue.attachments ?? []) {
        if (attachment.url?.startsWith("/api/issues/")) continue;
        const url = await this.fileURL(attachment.id);
        attachment.url = url ?? "";
        if (!url) {
          attachment.missing = true;
          missingFiles++;
        } else delete attachment.missing;
      }
    };
    for (const change of parsed.state.changes) await restore(change.issue);
    for (const edit of [...parsed.state.undo, ...parsed.state.redo])
      for (const snapshot of [...edit.before, ...edit.after]) await restore(snapshot.issue);
    return { ...parsed, missingFiles };
  }
  async save(state: LocalState): Promise<void> {
    if (!this.writable)
      throw new Error(
        "This local database uses an unsupported version. Existing data has been preserved.",
      );
    const tx = this.db.transaction("state", "readwrite"),
      done = completed(tx);
    try {
      const store = tx.objectStore("state"),
        current = await request(store.get("workspace"));
      const revision =
        object(current) && Number.isSafeInteger(current.revision) ? current.revision : 0;
      if (revision !== this.revision)
        throw new Error(
          "Another tab saved newer local changes. Keep this tab open and export your unsaved changes before reloading.",
        );
      store.put({ ...state, revision: revision + 1 }, "workspace");
      await done;
      this.revision = revision + 1;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async addFiles(files: File[]): Promise<NonNullable<Issue["attachments"]>> {
    if (!this.writable) throw new Error("Local storage is read-only");
    const entries = files.map((file) => ({ file, id: crypto.randomUUID() })),
      tx = this.db.transaction("files", "readwrite"),
      done = completed(tx);
    try {
      for (const { file, id } of entries) tx.objectStore("files").put(file, id);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
    return entries.map(({ file, id }) => {
      const url = URL.createObjectURL(localFileBlob(file));
      this.urls.set(id, url);
      return { id, name: file.name, url, type: file.type, size: file.size };
    });
  }
  async addFile(file: File): Promise<NonNullable<Issue["attachments"]>[number]> {
    return (await this.addFiles([file]))[0]!;
  }
  async retainFile(id: string, file: Blob): Promise<void> {
    const tx = this.db.transaction("files", "readwrite"),
      done = completed(tx);
    tx.objectStore("files").put(file, id);
    await done;
  }
  async fileURL(id: string): Promise<string | undefined> {
    const cached = this.urls.get(id);
    if (cached) return cached;
    const tx = this.db.transaction("files", "readonly"),
      done = completed(tx),
      [file] = await Promise.all([request(tx.objectStore("files").get(id)), done]);
    if (!(file instanceof Blob)) return;
    const url = URL.createObjectURL(localFileBlob(file));
    this.urls.set(id, url);
    return url;
  }
  async recoveryCopies(): Promise<unknown[]> {
    const tx = this.db.transaction("recovery", "readonly"),
      done = completed(tx),
      [rows] = await Promise.all([request(tx.objectStore("recovery").getAll()), done]);
    return rows;
  }
  async fileBlobs(): Promise<{ id: string; blob: Blob }[]> {
    const tx = this.db.transaction("files", "readonly"),
      done = completed(tx),
      store = tx.objectStore("files");
    const [keys, files] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll()),
      done,
    ]);
    return files.flatMap((blob, index) =>
      blob instanceof Blob ? [{ id: String(keys[index]), blob }] : [],
    );
  }
  close() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.db.close();
  }
}
