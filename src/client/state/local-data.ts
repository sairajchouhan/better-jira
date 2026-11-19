import { activityFields, type Full, type Issue } from "@/shared/issue-model";
import { validCommentStates } from "@/client/features/comments/comment-thread";
import { resourceURL, validDocumentProperties, validLinkPreview } from "@/shared/issue-resource";

import { localFileBlob } from "@/shared/media-types";
import { validMediaEdits } from "@/client/features/media/media-edits";
import { renameIds } from "@/shared/jira-ops";
import { withMembership } from "@/shared/board-membership";


export type Snapshot = {
  issue?: Issue;
  full?: Full;
  issueFields?: string[];
  fullFields?: string[];
};
/** `tab` is the tab that made the edit; only it can undo it (R2-inbox-D3). */
export type LocalEdit = {
  keys: string[];
  label: string;
  before: Snapshot[];
  after: Snapshot[];
  tab?: string;
};
export type LocalChange = {
  key: string;
  issue: Issue | null;
  full?: Full;
  issueFields: string[];
  fullFields: string[];
  created: boolean;
  /** The tab that sends this change to Jira; a change whose tab has closed is replayed by the next tab to load. */
  tab?: string;
};
export type LocalState = {
  version: 1;
  sequence: number;
  changes: LocalChange[];
  undo: LocalEdit[];
  redo: LocalEdit[];
  /** App key (PREFIX-NEWn) → the key Jira gave it, so every tab moves its edits there (sync check 7). */
  keys?: Record<string, string>;
};
// ponytail: the newest 200 key moves are kept; a tab left open across 200 creates elsewhere misses older ones.
const KEPT_KEYS = 200;
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
  "boards",
  "summary",
  "status",
  "type",
  "priority",
  "assignee",
  "labels",
  "parent",
  "rank",
  "rankAnchor",
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
  "prStatus",
  "prNumber",
  "statusSince",
  "started",
  "watchers",
  "watchersComplete",
  "estimate",
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
  Array.isArray(v.boards) &&
  v.boards.every(Number.isFinite) &&
  typeof v.summary === "string" &&
  typeof v.status === "string" &&
  strings(v.labels) &&
  typeof v.updated === "string" &&
  Number.isFinite(v.comments) &&
  user(v.assignee) &&
  ["type", "priority", "parent", "rank", "description", "created", "statusSince", "started"].every(
    (k) => v[k] === undefined || typeof v[k] === "string",
  ) &&
  (v.rankAnchor === undefined ||
    (object(v.rankAnchor) &&
      Object.keys(v.rankAnchor).length === 1 &&
      (typeof v.rankAnchor.after === "string" || typeof v.rankAnchor.before === "string"))) &&
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
    (r) =>
      object(r) &&
      typeof r.key === "string" &&
      typeof r.kind === "string" &&
      (r.label === undefined || typeof r.label === "string") &&
      (r.issue === undefined || (object(r.issue) && typeof r.issue.summary === "string")),
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
      (e.made === undefined || typeof e.made === "string") &&
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
  keys: {},
});
/** Changes saved before an issue could be on several boards name its one `board`: read them with `boards` (board-membership.ts). */
function withBoardLists(raw: Record<string, any>): Record<string, any> {
  const change = (v: unknown) =>
    !object(v)
      ? v
      : {
          ...v,
          ...(object(v.issue) ? { issue: withMembership(v.issue) } : {}),
          ...(strings(v.issueFields) ? { issueFields: v.issueFields.map((f) => (f === "board" ? "boards" : f)) } : {}),
        };
  const edit = (v: unknown) =>
    object(v) && Array.isArray(v.before) && Array.isArray(v.after)
      ? { ...v, before: v.before.map(change), after: v.after.map(change) }
      : v;
  const each = (v: unknown, fn: (item: unknown) => unknown) => (Array.isArray(v) ? v.map(fn) : v);
  return { ...raw, changes: each(raw.changes, change), undo: each(raw.undo, edit), redo: each(raw.redo, edit) };
}
export function parseLocalState(saved: unknown): {
  state: LocalState;
  recovered: boolean;
  readOnly: boolean;
} {
  if (saved === undefined) return { state: emptyLocalState(), recovered: false, readOnly: false };
  if (!object(saved) || saved.version !== 1)
    return { state: emptyLocalState(), recovered: true, readOnly: true };
  const raw = withBoardLists(saved);
  const valid = (v: unknown): v is LocalChange =>
    object(v) &&
    typeof v.key === "string" &&
    (v.issue === null || isIssue(v.issue, v.key)) &&
    (v.full === undefined || isFull(v.full, v.key)) &&
    strings(v.issueFields) &&
    v.issueFields.every((f) => issueFields.has(f)) &&
    strings(v.fullFields) &&
    v.fullFields.every((f) => ["description", "comment"].includes(f)) &&
    typeof v.created === "boolean" &&
    (v.tab === undefined || typeof v.tab === "string");
  const changes = Array.isArray(raw.changes) ? raw.changes.filter(valid) : [];
  const undo = Array.isArray(raw.undo) ? raw.undo.filter(isEdit).slice(-100) : [];
  const redo = Array.isArray(raw.redo) ? raw.redo.filter(isEdit).slice(-100) : [];
  const sequence = Number.isSafeInteger(raw.sequence) && raw.sequence >= 0 ? raw.sequence : 0;
  const keys =
    object(raw.keys) && Object.values(raw.keys).every((v) => typeof v === "string")
      ? (raw.keys as Record<string, string>)
      : {};
  const recovered =
    !Array.isArray(raw.changes) ||
    changes.length !== raw.changes.length ||
    !Array.isArray(raw.undo) ||
    undo.length !== raw.undo.length ||
    !Array.isArray(raw.redo) ||
    redo.length !== raw.redo.length ||
    sequence !== raw.sequence ||
    (raw.keys !== undefined && keys !== raw.keys);
  return { state: { version: 1, sequence, changes, undo, redo, keys }, recovered, readOnly: false };
}

const snapshotChanges = (changes: LocalChange[]) =>
  new Map(changes.map((c) => [c.key, structuredClone(c)]));

// --- Merging another tab's saved changes with this tab's -------------------------------------------------------------
// One three-way model. Each change is a set of fields it overrides ($deleted, $created, $refused, issue fields,
// full:description, full:comment). `base` is this tab's own copy at its last load or save. Per field: a value only this
// tab changed since `base` is this tab's; one it didn't change is the stored one (so another tab's edit, or its "Jira took
// it", wins); where both changed, the field's rule below merges them, else this tab's wins.

/** A field a change doesn't override, told apart from one it clears (`parent: undefined`). */
const NONE = Symbol("none");
const same = (a: unknown, b: unknown) =>
  a === b || (a !== NONE && b !== NONE && JSON.stringify(a) === JSON.stringify(b));
/** Three-way merge of a list of plain values: the stored list with this tab's adds and removals since `base` (a reaction). */
function mergeList(base: string[] = [], mine: string[] = [], theirs: string[] = []) {
  const added = mine.filter((r) => !base.includes(r)),
    removed = new Set(base.filter((r) => !mine.includes(r)));
  return [...new Set([...theirs.filter((r) => !removed.has(r)), ...added])];
}
/** Three-way merge of id'd lists (Activity rows): adds and removals from both sides are kept. */
function mergeById<T extends { id: string }>(base: T[] = [], mine: T[] = [], theirs: T[] = []) {
  const ids = (list: T[]) => new Set(list.map((v) => v.id)),
    b = ids(base),
    m = ids(mine),
    t = ids(theirs);
  return [
    ...mine.filter((v) => !b.has(v.id) || t.has(v.id)),
    ...theirs.filter((v) => !b.has(v.id) && !m.has(v.id)),
  ];
}
type Rule = (base: any, mine: any, theirs: any) => unknown;
/** Three-way merge of records, key by key, with `rules` (or `each`) for keys both sides changed. Empty entries are dropped. */
const mergeRecord =
  (rules: Record<string, Rule>, each?: Rule): Rule =>
  (base = {}, mine = {}, theirs = {}) => {
    const out: Record<string, unknown> = {};
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(mine),
      ...Object.keys(theirs),
    ])) {
      const value = merge3(base[key], mine[key], theirs[key], rules[key] ?? each);
      if (
        value !== undefined &&
        !(Array.isArray(value) && !value.length) &&
        !(object(value) && !Object.keys(value).length)
      )
        out[key] = value;
    }
    return out;
  };
function merge3(base: unknown, mine: unknown, theirs: unknown, rule?: Rule) {
  if (same(mine, base)) return theirs;
  // This tab dropped a field it no longer overrides (Jira took it, or it was restored): another tab's edit of it stays.
  if (same(theirs, base) || (!rule && mine !== NONE)) return mine;
  return mine === NONE ? theirs : rule!(base, mine, theirs);
}
/** Fields both tabs may change at once, merged item by item rather than one tab's value winning (R2-issue-fields-D1, R2-comments-D2). */
const rules: Record<string, Rule> = {
  activity: mergeById,
  reactions: mergeList,
  // Per comment, per mark: resolved, subscribed, a local body, its reactions.
  commentStates: mergeRecord({}, mergeRecord({ reactions: mergeList })),
};
/** The fields a change overrides, by name; an absent field is not overridden. */
function fieldsOf(change: LocalChange | undefined): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  if (!change) return fields;
  if (change.issue === null) fields.set("$deleted", true);
  if (change.created) fields.set("$created", true);
  for (const f of change.issueFields) fields.set(f, (change.issue as any)?.[f]);
  for (const f of change.fullFields) fields.set("full:" + f, change.full?.fields[f]);
  // A description Jira refused sits on the record beside its fields, and is cleared without any field changing (Keep mine).
  const { descriptionRejected, descriptionError } = change.full ?? {};
  if (descriptionRejected !== undefined) fields.set("$refused", { descriptionRejected, descriptionError });
  return fields;
}
/**
 * Moves changes made on an app key to the key Jira gave it (`keys`), in this tab's, its base and the stored copy alike, so
 * an edit a tab made on the app key lands on the issue Jira made, whichever tab created it (sync check 7).
 */
function moveCreated(changes: LocalChange[], keys: Record<string, string>): LocalChange[] {
  const ids = new Map(Object.entries(keys));
  if (!ids.size || !changes.some((c) => JSON.stringify(c).includes("-NEW"))) return changes;
  const moved = new Map<string, LocalChange>();
  for (const change of changes) {
    const next = ids.has(change.key)
      ? { ...renameIds(change, ids), created: false }
      : renameIds(change, ids);
    const other = moved.get(next.key);
    moved.set(next.key, other ? combine(next.key, other, next) : next);
  }
  return [...moved.values()];
}
/**
 * One tab's two copies of an issue: edits on its app key, and edits on the Jira key the poll showed before the tab learnt
 * the move. Each field either copy changed is kept; a field both changed keeps the Jira-key copy's (made later) or,
 * with a rule, both sides' items.
 */
function combine(key: string, a: LocalChange, b: LocalChange): LocalChange {
  if (a.issue === null || b.issue === null) return a.issue === null ? a : b;
  const fa = fieldsOf(a),
    fb = fieldsOf(b),
    values = new Map(fb);
  for (const [field, value] of fa)
    if (!fb.has(field)) values.set(field, value);
    else if (rules[field]) values.set(field, rules[field](undefined, value, fb.get(field)));
  return build(key, b, a, b, values) ?? b;
}
/** Merges this tab's changes with the stored ones against `base` (this tab's last load or save), field by field. */
export function mergeChanges(
  base: ReadonlyMap<string, LocalChange>,
  mine: LocalChange[],
  stored: LocalChange[],
  keys: Record<string, string> = {},
): LocalChange[] {
  const ours = new Map(moveCreated(mine, keys).map((c) => [c.key, c])),
    theirs = new Map(moveCreated(stored, keys).map((c) => [c.key, c])),
    bases = new Map(moveCreated([...base.values()], keys).map((c) => [c.key, c])),
    result: LocalChange[] = [];
  for (const key of new Set([...theirs.keys(), ...ours.keys()])) {
    const m = ours.get(key),
      t = theirs.get(key),
      fb = fieldsOf(bases.get(key)),
      fm = fieldsOf(m),
      ft = fieldsOf(t);
    const values = new Map<string, unknown>();
    let fromMine = false;
    for (const field of new Set([...fb.keys(), ...fm.keys(), ...ft.keys()])) {
      const [b, mv, tv] = [fb, fm, ft].map((f) => (f.has(field) ? f.get(field) : NONE));
      const rule = fm.has(field) && ft.has(field) ? rules[field] : undefined;
      const value = merge3(b, mv, tv, rule && ((_, x, y) => rule(fb.get(field), x, y)));
      if (!same(mv, b)) fromMine = true;
      if (value !== NONE) values.set(field, value);
    }
    const owner = fromMine && m ? m : (t ?? m)!;
    const merged = build(key, owner, m, t, values);
    if (merged) result.push(merged);
  }
  return result;
}
/** A change from merged field values, on `owner`'s copy of the issue; undefined if it overrides nothing. */
function build(
  key: string,
  owner: LocalChange,
  m: LocalChange | undefined,
  t: LocalChange | undefined,
  values: Map<string, unknown>,
): LocalChange | undefined {
  if (values.get("$deleted")) return { ...owner, issue: null };
  const fields = (full: boolean) =>
    [...values.keys()].filter((f) => !f.startsWith("$") && f.startsWith("full:") === full);
  const issueFields = fields(false),
    fullFields = fields(true).map((f) => f.slice(5)),
    created = !!values.get("$created");
  if (!issueFields.length && !fullFields.length && !created) return undefined;
  const issue = { ...(owner.issue ?? m?.issue ?? t?.issue)! } as Issue;
  for (const f of issueFields) (issue as any)[f] = values.get(f);
  const fullBase = owner.full ?? m?.full ?? t?.full;
  const { descriptionRejected: _r, descriptionError: _e, ...record } = fullBase ?? ({} as Full);
  const full = fullBase && {
    ...record,
    ...(values.get("$refused") as Pick<Full, "descriptionRejected" | "descriptionError"> | undefined),
    fields: {
      ...fullBase.fields,
      ...Object.fromEntries(fullFields.map((f) => [f, values.get("full:" + f)])),
    },
  };
  return {
    key,
    issue,
    ...(full ? { full } : {}),
    issueFields,
    fullFields,
    created,
    ...(owner.tab ? { tab: owner.tab } : {}),
  };
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

/**
 * The saved data a load opens, by account and by whether this run writes to Jira. A writable load sends again whatever its
 * saved changes hold that Jira hasn't taken (jira-sync `resumeSync`), so changes made while nothing was sent to Jira ("Local
 * only") are kept apart: they never reach Jira when the same browser later runs writable (`bun run dev`, then `bun start`),
 * and they come back whenever it runs local only again. Writable keeps the original name, so writes still waiting to be sent
 * stay where they were. Undo history and key moves go with their changes.
 */
export const localDataName = (namespace: string, writable: boolean) =>
  writable ? namespace : `${namespace}#local-only`;

/** Separate databases keep two Jira accounts from sharing local edits or files. */
export class LocalDatabase {
  private urls = new Map<string, string>();
  private writable = true;
  /** This tab's changes as of its last load or save: the common base for merging with other tabs. */
  private base = new Map<string, LocalChange>();
  /** The key moves (app key → Jira key) as of this tab's last load or save. */
  moved: Record<string, string> = {};
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
    // One transaction: the copy of a corrupt record and its cleaned state land together, so the next load is clean and keeps a single copy.
    const tx = this.db.transaction(["state", "recovery"], "readwrite"),
      done = completed(tx);
    done.catch(() => {});
    const store = tx.objectStore("state"),
      recovery = tx.objectStore("recovery"),
      raw = await request(store.get("workspace")),
      parsed = parseLocalState(raw);
    this.writable = !parsed.readOnly;
    const revision = object(raw) && Number.isSafeInteger(raw.revision) ? raw.revision : 0;
    this.base = snapshotChanges(parsed.state.changes);
    this.moved = parsed.state.keys ?? {};
    if (parsed.readOnly) {
      // An unsupported version stays in place untouched; copy it only once.
      const copies = await request(recovery.getAll());
      if (!copies.some((copy) => JSON.stringify(copy) === JSON.stringify(raw)))
        recovery.put(raw, Date.now());
    } else if (parsed.recovered) {
      recovery.put(raw, Date.now());
      store.put({ ...parsed.state, revision: revision + 1 }, "workspace");
    }
    await done;
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
  /** Writes `state`, merged with whatever other tabs saved since this tab's last load or save (see mergeChanges), so no tab's write is lost (R2-issue-fields-D1). This tab's undo history wins. Returns the sequence written; `moved` then holds the key moves. */
  async save(state: LocalState): Promise<number> {
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
      const theirs = parseLocalState(current);
      if (theirs.readOnly)
        throw new Error(
          "Another tab saved local data in a newer version. Reload to keep editing; existing data has been preserved.",
        );
      const keys = Object.fromEntries(
        Object.entries({ ...theirs.state.keys, ...state.keys }).slice(-KEPT_KEYS),
      );
      const next = {
        ...state,
        sequence: Math.max(state.sequence, theirs.state.sequence),
        changes: mergeChanges(this.base, state.changes, theirs.state.changes, keys),
        keys,
      };
      store.put({ ...next, revision: revision + 1 }, "workspace");
      await done;
      // The base is this tab's own copy, not the merge: fields taken from other tabs then stay theirs next time.
      this.base = snapshotChanges(state.changes);
      this.moved = keys;
      return next.sequence;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  /** The key moves other tabs saved: app key → Jira key. */
  /** The saved key moves (app key → Jira key), and the keys of saved issues made here that Jira doesn't have yet. */
  async stored(): Promise<{
    keys: Record<string, string>;
    created: Set<string>;
    changes: LocalChange[];
  }> {
    const tx = this.db.transaction("state", "readonly"),
      done = completed(tx),
      [raw] = await Promise.all([request(tx.objectStore("state").get("workspace")), done]),
      { state } = parseLocalState(raw);
    return {
      keys: state.keys ?? {},
      created: new Set(state.changes.filter((c) => c.created).map((c) => c.key)),
      changes: state.changes,
    };
  }
  /**
   * Reserves `count` local numbers (for PREFIX-NEWn keys and local comment ids) above `floor`, in one readwrite
   * transaction, which IndexedDB runs one at a time across tabs: no two tabs get the same number (sync review 2).
   * Returns the first.
   */
  async reserve(count: number, floor = 0): Promise<number> {
    const tx = this.db.transaction("state", "readwrite"),
      done = completed(tx),
      store = tx.objectStore("state"),
      last = await request(store.get("numbers")),
      first = Math.max(Number.isSafeInteger(last) ? (last as number) : 0, floor) + 1;
    store.put(first + count - 1, "numbers");
    await done;
    return first;
  }
  /** Takes over changes whose tab is no longer open (`live` lists the open ones), so exactly one tab replays each, or
   * only those of `only`. Returns their keys. */
  async claim(
    tab: string,
    live: ReadonlySet<string>,
    only?: ReadonlySet<string>,
  ): Promise<Set<string>> {
    const tx = this.db.transaction("state", "readwrite"),
      done = completed(tx),
      store = tx.objectStore("state"),
      current = await request(store.get("workspace")),
      claimed = new Set<string>();
    if (object(current) && current.version === 1 && Array.isArray(current.changes)) {
      for (const change of current.changes)
        if (
          object(change) &&
          (!only || only.has(change.key as string)) &&
          // Already this tab's (it edited the issue): taking it over is this tab's to do.
          (typeof change.tab !== "string" ||
            !live.has(change.tab) ||
            (!!only && change.tab === tab))
        ) {
          change.tab = tab;
          claimed.add(change.key);
        }
      if (claimed.size)
        store.put(
          {
            ...current,
            revision: (Number.isSafeInteger(current.revision) ? current.revision : 0) + 1,
          },
          "workspace",
        );
    }
    await done;
    return claimed;
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
  /** The file as it was kept, with its name and type. */
  async file(id: string): Promise<Blob | undefined> {
    const tx = this.db.transaction("files", "readonly"),
      done = completed(tx),
      [file] = await Promise.all([request(tx.objectStore("files").get(id)), done]);
    return file instanceof Blob ? file : undefined;
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
