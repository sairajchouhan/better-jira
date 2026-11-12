/**
 * Issue state and optimistic edits: what the store shows is Jira's copy with this browser's edits on top.
 *
 * This module alone knows which fields of an issue are edited here and not yet Jira's (the ledger below). It applies
 * local edits, lays every read from Jira (the property poll, a full record, a write's answer, the saved data at load)
 * under them, moves them when Jira assigns a created issue its key, and hands what must survive a reload to the saved
 * data. Callers never see the ledger: they ask questions (`isLocalIssue`, `hasLocalJiraChanges`) or say what happened.
 */
import { adfToText } from "@/client/features/editor/adf";
import { visibleCommentTotal, type CommentState } from "@/client/features/comments/comment-thread";
import { normalizeDocument } from "@/shared/document";
import { rollbackActivity, recordActivity } from "@/client/features/issue/issue-activity";
import { aliasAttachments, uploadedAttachments } from "./jira-media";
import { JIRA_ISSUE_FIELDS, namesKey, renameIds } from "@/shared/jira-ops";
import type { LocalChange, Snapshot } from "./local-data";
import type { WriteResult } from "./outbox";
import { navigate } from "@/client/features/navigation/app-navigation";
import { get, ME, set, type Full, type Issue } from "./store";
import { creatingIssue, hasPendingWrite, holdsCommentDelete, holdsCommentDeletes, touch, writeTab } from "./jira-sync";
import { queueSave } from "./local-database";

const now = () => new Date().toISOString();
/** Issue fields (`Issue`) and record fields (`Full.fields`) edited here and not yet Jira's, per issue. */
const localFields = new Map<string, Set<string>>(),
  fullFields = new Map<string, Set<string>>();
/** Issues edited here (saved with the local data), and issues created here that Jira hasn't keyed yet. */
const changedKeys = new Set<string>(),
  createdKeys = new Set<string>();
/** Issues whose cached full record is older than Jira's: the next load reads it again. */
const needsFullRefresh = new Set<string>();
/** Local edits per issue in this tab, so a slow read can tell whether the issue was edited meanwhile. */
const editCounts = new Map<string, number>();
/** The last property-poll entry per issue, so an unchanged one costs nothing. */
const lastProperties = new Map<string, string>();

// --- Local edits ---

/** Edits issue fields; the edited fields stay local until Jira's answer to their write. */
export function patchIssue(key: string, patch: Partial<Issue>) {
  const state = get(),
    i = state.issues.get(key);
  if (i) {
    const prior = i.activity ?? [],
      activity = recordActivity(prior, i, patch, ME, now(), () => crypto.randomUUID());
    if (activity !== prior) patch = { ...patch, activity: [...activity] };
    localFields.set(
      key,
      new Set([...(localFields.get(key) ?? []), ...Object.keys(patch), "updated"]),
    );
    set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
  }
}
/** Edits fields of the issue's full record (description, comments). */
export function patchFields(key: string, fn: (fields: any) => object) {
  const state = get(),
    f = state.full.get(key);
  if (f) {
    const patch = fn(f.fields),
      // The first unsent description edit remembers Jira's text it started from.
      base =
        "description" in patch && !fullFields.get(key)?.has("description")
          ? { descriptionBase: f.fields.description }
          : {};
    fullFields.set(key, new Set([...(fullFields.get(key) ?? []), ...Object.keys(patch)]));
    set({
      full: new Map(state.full).set(key, { ...f, ...base, fields: { ...f.fields, ...patch } }),
    });
  }
}
/** The issue was edited here: its change is saved with the local data. */
export const markChanged = (key: string) => void changedKeys.add(key);
/** Counts an edit (undo and redo included), so `editCount` tells a slow read it was overtaken. */
export const countEdit = (key: string) => void editCounts.set(key, (editCounts.get(key) ?? 0) + 1);
export const editCount = (key: string) => editCounts.get(key);
/** A new issue made here (PREFIX-NEWn), until Jira keys it. */
export const markCreated = (key: string) => void createdKeys.add(key);
export const isLocalIssue = (key: string) => createdKeys.has(key);
/** Whether the issue has edits Jira doesn't have yet, so restoring Jira's copy would change something. */
export const hasLocalJiraChanges = (key: string) =>
  [...(localFields.get(key) ?? [])].some((field) => JIRA_ISSUE_FIELDS.includes(field as never)) ||
  !!fullFields.get(key)?.size ||
  hasPendingWrite(key);
/** "Restore Jira's version": nothing is local any more. */
export function clearLocalEdits(key: string) {
  localFields.set(key, new Set());
  fullFields.set(key, new Set());
  needsFullRefresh.delete(key);
}

// --- Undo ---

/** The issue as it is now, with which fields are local: what an undo step restores. */
export const snapshot = (key: string): Snapshot => ({
  issue: get().issues.get(key),
  full: get().full.get(key),
  issueFields: [...(localFields.get(key) ?? [])],
  fullFields: [...(fullFields.get(key) ?? [])],
});
/** Puts issues back as `snapshots` (one per key) describe them. */
export function restoreSnapshots(keys: string[], snapshots: Snapshot[]) {
  const issues = new Map(get().issues),
    full = new Map(get().full);
  keys.forEach((key, index) => {
    const snapshot = snapshots[index]!;
    if (snapshot.issue) issues.set(key, snapshot.issue);
    else issues.delete(key);
    if (snapshot.full) full.set(key, snapshot.full);
    else full.delete(key);
    if (snapshot.issueFields) localFields.set(key, new Set(snapshot.issueFields));
    if (snapshot.fullFields) fullFields.set(key, new Set(snapshot.fullFields));
  });
  set({ issues, full });
}

// --- Reads from Jira ---

/** Jira's remote links as link resources. A writable site takes Jira's set (unless a write is queued); a read-only one only adds links it lacks. */
export function withJiraLinks(
  resources: Issue["resources"] = [],
  links: { url: string; title: string }[] | undefined,
  replace: boolean,
): Issue["resources"] {
  if (!links) return resources;
  const jira = new Map(links.map((l) => [l.url, l])),
    have = new Set<string>();
  const kept = resources.flatMap((r) => {
    if (r.kind === "document" || !r.url) return [r];
    const link = jira.get(r.url);
    if (!link) return replace ? [] : [r];
    have.add(r.url);
    return [{ ...r, title: link.title }];
  });
  const at = now();
  return [
    ...kept,
    ...links
      .filter((l) => !have.has(l.url))
      .map((l) => ({
        id: crypto.randomUUID(),
        kind: "link" as const,
        url: l.url,
        title: l.title,
        updated: at,
        created: at,
      })),
  ];
}

/**
 * Lays one property poll under the local edits. Returns the issues to show (undefined: nothing changed), issues Jira
 * deleted, and issues whose cached full record went stale (marked for a reload).
 */
export function mergeProperties(entries: Record<string, any>) {
  const state = get();
  const issues = new Map(state.issues);
  let changed = false;
  const stale: string[] = [],
    deleted: string[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    const issue = issues.get(key);
    const signature = JSON.stringify(entry);
    if (lastProperties.get(key) === signature) continue;
    const { errors: _errors, ...extra } = entry;
    // Read-only sites keep their local attachments; only a writable site's list comes from Jira.
    if (state.writable && extra.attachments)
      extra.attachments = aliasAttachments(key, extra.attachments, issue?.attachments);
    else delete extra.attachments;
    if (!issue) {
      // A new Jira issue; with local-only editing, a missing key may be a local delete.
      // While a create is in flight its new key may arrive here first; the write's answer adds it with the local fields intact.
      if (state.writable && !changedKeys.has(key) && extra.key === key && !creatingIssue()) {
        issues.set(key, extra);
        changed = true;
        lastProperties.set(key, signature);
      }
      continue;
    }
    lastProperties.set(key, signature);
    // Edited in Jira: the cached description and comments are stale, so a later edit would overwrite Jira's newer text.
    if (state.writable && state.full.has(key) && extra.updated && extra.updated !== issue.updated) {
      // With a local edit still unsent, look again once its write lands (the write's refresh notifies), or the change is never read (R2-D1).
      if (fullFields.get(key)?.size) lastProperties.delete(key);
      else stale.push(key);
    }
    const local = localFields.get(key) ?? new Set();
    for (const field of local) delete extra[field];
    if (local.has("status")) {
      delete extra.statusSince;
      delete extra.started;
    }
    issues.set(key, { ...issue, ...extra });
    changed = true;
  }
  // Issues deleted in Jira, or moved off every board. Writes still in flight keep theirs.
  if (state.writable && Object.keys(entries).length)
    for (const key of issues.keys())
      if (!(key in entries) && !createdKeys.has(key) && !hasPendingWrite(key)) {
        // Gone from Jira, so its local overrides go too; a saved tombstone would otherwise send a delete after reload.
        issues.delete(key);
        lastProperties.delete(key);
        changedKeys.delete(key);
        touch(key);
        localFields.delete(key);
        fullFields.delete(key);
        changed = true;
        deleted.push(key);
      }
  for (const key of stale) needsFullRefresh.add(key);
  return { issues: changed ? issues : undefined, deleted, stale };
}

/** Whether the issue's full record must be read: never for an issue made here, else when missing, stale or `force`d. */
export const needsFull = (key: string, force = false) =>
  !createdKeys.has(key) && (!get().full.has(key) || needsFullRefresh.has(key) || force);
/** Reads the issue's full record again on its next load. */
export const markStale = (key: string) => void needsFullRefresh.add(key);

/** Lays an issue's Jira record under the local field edits and shows it. */
export function mergeFull(key: string, record: Full) {
  let full: any = record;
  // A comment whose delete waits out the undo window (an undone add) stays hidden until Jira drops it.
  if (holdsCommentDeletes() && Array.isArray(full.fields?.comment?.comments))
    full.fields.comment.comments = full.fields.comment.comments.filter(
      (c: any) => !holdsCommentDelete(String(c.id)),
    );
  const state = get(),
    local = state.full.get(key);
  if (local)
    for (const field of fullFields.get(key) ?? []) {
      if (field === "comment") {
        const comments = [
          ...(full.fields.comment?.comments ?? []),
          ...(local.fields.comment?.comments ?? []).filter((c: any) =>
            String(c.id).startsWith("local-"),
          ),
        ];
        full = {
          ...full,
          fields: {
            ...full.fields,
            comment: { ...full.fields.comment, comments, total: comments.length },
          },
        };
      } else full = { ...full, fields: { ...full.fields, [field]: local.fields[field] } };
    }
  // A refused description, and the base of one still unsent, outlive Jira's copy.
  if (local?.descriptionRejected)
    full = {
      ...full,
      descriptionRejected: local.descriptionRejected,
      descriptionError: local.descriptionError,
    };
  if (local?.descriptionBase && fullFields.get(key)?.has("description"))
    full = { ...full, descriptionBase: local.descriptionBase };
  needsFullRefresh.delete(key);
  const issue = state.issues.get(key);
  if (issue)
    set({
      full: new Map(state.full).set(key, full),
      issues: new Map(state.issues).set(key, {
        ...issue,
        ...(hasPendingWrite(key)
          ? {}
          : { resources: withJiraLinks(issue.resources, full.remotelinks, state.writable) }),
        ...(full.fields.comment
          ? {
              comments: visibleCommentTotal(
                full.fields.comment.total,
                full.fields.comment.comments ?? [],
                issue.commentStates,
              ),
            }
          : {}),
        ...(!localFields.get(key)?.has("description")
          ? { description: adfToText(full.fields.description) }
          : {}),
      }),
    });
}

// --- Writes to Jira ---

/**
 * A change queued no write (nothing to send, or a redo that only cancelled a held comment delete): no answer will settle
 * it, so Jira's copy owns its Jira fields again (R2-comments-D1). Returns whether anything was released.
 */
export function releaseJiraFields(key: string) {
  if (
    createdKeys.has(key) ||
    !(fullFields.get(key)?.size || JIRA_ISSUE_FIELDS.some((field) => localFields.get(key)?.has(field)))
  )
    return false;
  fullFields.delete(key);
  for (const field of JIRA_ISSUE_FIELDS) localFields.get(key)?.delete(field);
  needsFullRefresh.add(key);
  return true;
}
/** The issue's only write was its uploads, which Jira now has. */
export const releaseAttachments = (key: string) => void localFields.get(key)?.delete("attachments");

/** Takes Jira's copy of what Jira owns, once no later write for the issue waits. `force` rolls a failed write back. */
export function adoptJira(
  key: string,
  result: WriteResult,
  force: boolean,
  created = new Map<string, string>(),
  describes = false,
) {
  if (result.issue === undefined || (!force && hasPendingWrite(key))) return;
  touch(key);
  const state = get(),
    issue = state.issues.get(key);
  if (result.issue === null) {
    // Gone from Jira (deleted there, or by this write).
    if (issue && !createdKeys.has(key)) {
      const issues = new Map(state.issues);
      issues.delete(key);
      set({ issues });
      if (get().selected === key) navigate({ selected: null, panel: false });
    }
    return;
  }
  if (!issue) return;
  if (result.full)
    result.issue.attachments = uploadedAttachments(key, result.full, issue.attachments);
  const local = localFields.get(key) ?? new Set(),
    fields: Record<string, unknown> = {};
  // Status dates come from the next property poll; keep the optimistic ones until then.
  for (const field of JIRA_ISSUE_FIELDS) {
    if (field in result.issue) fields[field] = (result.issue as any)[field];
    else if (!["statusSince", "started"].includes(field)) fields[field] = undefined;
    local.delete(field);
  }
  localFields.set(key, local);
  const next: Issue = { ...issue, ...fields } as Issue;
  // A rejected write's Activity entries go with it.
  if (result.error && issue.activity) {
    const activity = rollbackActivity(issue.activity, issue, fields, ME.id);
    if (activity !== issue.activity) next.activity = [...activity];
  }
  const full = state.full.get(key),
    patch: { issues: Map<string, Issue>; full?: Map<string, Full> } = {
      issues: new Map(state.issues),
    };
  if (result.full?.remotelinks)
    next.resources = withJiraLinks(issue.resources, result.full.remotelinks, true);
  if (full && result.full) {
    for (const field of ["description", "comment"]) fullFields.get(key)?.delete(field);
    const comment = result.full.fields?.comment,
      description = result.full.fields?.description,
      mine = full.fields.description;
    // Jira refused this description: keep it beside Jira's copy, so it's never silently lost, even unfocused or after a reload (R2-D2, R2-D4).
    const refused =
      !!result.error &&
      describes &&
      mine !== undefined &&
      JSON.stringify(normalizeDocument(mine)) !== JSON.stringify(normalizeDocument(description));
    patch.full = new Map(state.full).set(key, {
      ...full,
      fields: { ...full.fields, description, comment },
      descriptionBase: undefined,
      ...(refused ? { descriptionRejected: mine, descriptionError: result.error } : {}),
    });
    // Bodies and deletions now live in Jira; resolved, subscribed and reactions stay local.
    const states: Record<string, CommentState> = {};
    for (const [id, { body: _b, updated: _u, deleted, ...rest }] of Object.entries(
      issue.commentStates ?? {},
    )) {
      // A delete still held for undo has not reached Jira yet.
      const kept = holdsCommentDelete(id) ? { ...rest, deleted } : rest;
      if (Object.keys(kept).length) states[created.get(id) ?? id] = kept;
    }
    next.commentStates = states;
    next.comments = visibleCommentTotal(comment?.total ?? 0, comment?.comments ?? [], states);
  }
  patch.issues.set(key, next);
  set(patch);
  queueSave();
}

/**
 * The issues and records with a created issue's app key replaced by Jira's key `to` everywhere, and its local edits
 * moved along. The caller shows them. The copy under the app key carries the local edits: it wins over one the poll
 * already brought under the Jira key, except for fields edited on that copy before this tab learnt the move (sync review 4).
 */
export function renameIssue(from: string, to: string) {
  const state = get(),
    ids = new Map([[from, to]]),
    mentions = (v: unknown) => namesKey(v, from);
  const issues = new Map<string, Issue>(),
    full = new Map<string, Full>();
  const edited = <T>(value: T, copy: any, fields?: Set<string>, nested?: "fields"): T => {
    if (!copy || !fields?.size) return value;
    const picked = Object.fromEntries(
      [...fields].map((f) => [f, (nested ? copy[nested] : copy)[f]]),
    );
    return (
      nested
        ? { ...value, fields: { ...(value as any).fields, ...picked } }
        : { ...value, ...picked }
    ) as T;
  };
  for (const [k, v] of state.issues)
    if (k !== to || !state.issues.has(from))
      issues.set(
        ids.get(k) ?? k,
        edited(
          mentions(v) ? renameIds(v, ids) : v,
          k === from && state.issues.get(to),
          localFields.get(to),
        ),
      );
  for (const [k, v] of state.full)
    if (k !== to || !state.full.has(from))
      full.set(
        ids.get(k) ?? k,
        k === from
          ? edited(renameIds(v, ids), state.full.get(to), fullFields.get(to), "fields")
          : v,
      );
  for (const map of [localFields, fullFields] as Map<string, Set<string>>[]) {
    const v = map.get(from);
    if (v) {
      map.delete(from);
      map.set(to, new Set([...v, ...(map.get(to) ?? [])]));
    }
  }
  if (changedKeys.delete(from)) changedKeys.add(to);
  createdKeys.delete(from);
  lastProperties.delete(from);
  return { issues, full };
}
/** Drops what is local about an issue that is gone (a create Jira refused). */
export function forgetIssue(key: string) {
  changedKeys.delete(key);
  createdKeys.delete(key);
  localFields.delete(key);
  fullFields.delete(key);
}

// --- Saved data ---

/** Starts over before the saved data loads. */
export function resetLocalEdits() {
  changedKeys.clear();
  createdKeys.clear();
  localFields.clear();
  fullFields.clear();
  needsFullRefresh.clear();
}
/**
 * Puts saved changes over Jira's copies (`inJira`) into `issues` and `full`. Returns the changes it took. With Jira writes,
 * a change for an issue Jira no longer has is dropped: the issue was deleted there.
 */
export function installChanges(
  changes: LocalChange[],
  issues: Map<string, Issue>,
  full: Map<string, Full>,
  inJira: Map<string, Issue>,
  writable: boolean,
) {
  return changes.filter((change) => {
    if (writable && !change.created && !inJira.has(change.key)) return false;
    // Older builds saved a link's preview as a local edit, which replayed the link to Jira on every load (R1-D1).
    if (
      writable &&
      !change.created &&
      !change.fullFields.length &&
      change.issueFields.every((f) => f === "resources" || f === "updated") &&
      change.issue?.resources?.every((r) => r.kind === "link")
    )
      return false;
    changedKeys.add(change.key);
    if (change.created) createdKeys.add(change.key);
    localFields.set(change.key, new Set(change.issueFields));
    fullFields.set(change.key, new Set(change.fullFields));
    if (change.issue === null) issues.delete(change.key);
    else if (change.created || !inJira.has(change.key)) issues.set(change.key, change.issue);
    else {
      const base = inJira.get(change.key)!;
      const patch = Object.fromEntries(
        change.issueFields.map((field) => [field, (change.issue as any)[field]]),
      );
      if (
        change.full?.fields.comment &&
        (change.fullFields.includes("comment") || change.issue.commentStates)
      )
        patch.comments = visibleCommentTotal(
          base.comments +
            (change.full?.fields.comment?.comments ?? []).filter((c: any) =>
              String(c.id).startsWith("local-"),
            ).length,
          change.full?.fields.comment?.comments ?? [],
          change.issue.commentStates,
        );
      issues.set(change.key, { ...base, ...patch });
    }
    if (change.full) {
      full.set(change.key, change.full);
      if (!change.created) needsFullRefresh.add(change.key);
    }
    return true;
  });
}
/** The local changes to save: issues made here, deleted here, or with fields still local. */
export function savedChanges(): LocalChange[] {
  const state = get();
  return [...changedKeys]
    .filter(
      (key) =>
        createdKeys.has(key) ||
        !state.issues.has(key) ||
        localFields.get(key)?.size ||
        fullFields.get(key)?.size,
    )
    .map((key) => ({
      key,
      issue: state.issues.get(key) ?? null,
      full: state.full.get(key),
      issueFields: [...(localFields.get(key) ?? [])],
      fullFields: [...(fullFields.get(key) ?? [])],
      created: createdKeys.has(key),
      tab: writeTab(key),
    }));
}
