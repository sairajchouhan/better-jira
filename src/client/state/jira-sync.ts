import { type Full, type Issue } from "@/shared/issue-model";
/**
 * Sending local edits to Jira. Each edit's before/after (`send`) becomes ops that the outbox (outbox.ts) sends one job
 * at a time per issue; Jira's answer gives created issues and comments their Jira ids everywhere (`currentKey`,
 * `firstKey`), settles the edited fields, and shows what Jira refused. Saved changes are owned by the tab that made
 * them: after a load (`restartSync`, `resumeSync`) this tab sends its own and claims those of tabs that closed, over
 * Web Locks and a BroadcastChannel.
 */
import type { LocalChange, LocalState } from "./local-data";
import { createOutbox, type Answer } from "./outbox";
import { aliasAttachments, prepareOps, settleUploads } from "./jira-media";
import { namesKey, renameCommentIds, renameIds, type Side } from "@/shared/jira-ops";
import { jiraCommentId } from "@/client/features/media/media-edits";
import {
  adoptJira,
  forgetIssue,
  installChanges,
  releaseAttachments,
  releaseJiraFields,
  renameIssue,
  snapshot,
} from "./local-edits";
import { rewriteHistory } from "./undo-history";
import { rekeyNotification, showNotification } from "./app-notifications";
import { returnRejectedComment } from "@/client/features/comments/rejected-comment";
import { navigate } from "@/client/features/navigation/app-navigation";
import { claimChanges, flushLocalChanges, localDataOpen, queueSave, storedChanges } from "./local-database";
import { get, set } from "./store";
import { refusedSelectionCreate, forgetSelectionCreate } from "./selection-create";
import { actions, beginCreate } from "./issue-actions";

/** Marks issues changed by this tab, so other tabs take its copy. */
export const touch = (...keys: string[]) => writes.touch(...keys);
const tabId = crypto.randomUUID(),
  TAB_LOCK = "better-jira-tab:";
/** Held while this tab is open, so other tabs know its saved changes are still being sent. */
let tabLock: Promise<void> | undefined;
/** Claims the saved changes of closed tabs and sends them (set once loaded, on a writable site with Web Locks). */
let takeOverClosed: (() => Promise<void>) | undefined;
// A closing tab says goodbye, so an open tab sends what it left unsent (a create still on its way) at once, not at its
// next load. Its lock goes with the tab: waiting for it means the claim sees the tab closed (BJ-19).
const tabChannel =
  typeof window !== "undefined" && typeof BroadcastChannel === "function"
    ? new BroadcastChannel("better-jira-tabs")
    : undefined;
tabChannel?.addEventListener("message", ({ data }) => {
  const takeOver = takeOverClosed;
  if (typeof data?.closed === "string" && takeOver)
    void navigator.locks.request(TAB_LOCK + data.closed, () => {}).then(takeOver);
});
if (tabChannel)
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) tabChannel.postMessage({ closed: tabId });
  });
const holdTabLock = () =>
  (tabLock ??= new Promise((resolve) =>
    navigator.locks.request(TAB_LOCK + tabId, () => (resolve(), new Promise(() => {}))),
  ));
/** The URLs of an issue's Jira remote links, or undefined if they can't be read. */
async function jiraLinks(key: string) {
  try {
    const response = await fetch(`/api/issues/${encodeURIComponent(key)}`);
    if (!response.ok) return;
    const full: Full = await response.json();
    return new Set((full.remotelinks ?? []).map((l) => l.url));
  } catch {}
}

// --- Jira writes: each edit's before/after becomes ops, which the outbox sends one job at a time (see outbox.ts) ---
const writes = createOutbox(
  {
    post: (key, body) =>
      fetch(`/api/issues/${encodeURIComponent(key)}/ops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    prepare: (key, ops) => prepareOps(key, ops),
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
    },
    tabs: {
      id: tabId,
      stored: () => storedChanges(),
      save: () => (queueSave(), flushLocalChanges()),
      ...(typeof navigator !== "undefined" && navigator.locks
        ? {
            exclusive: (fn: (live: Set<string>) => Promise<void>) =>
              navigator.locks.request("better-jira-outbox", async () => {
                const held = (await navigator.locks.query()).held ?? [];
                await fn(
                  new Set(
                    held.flatMap((l) =>
                      l.name?.startsWith(TAB_LOCK) ? [l.name.slice(TAB_LOCK.length)] : [],
                    ),
                  ),
                );
              }),
          }
        : {}),
      claim: (live, only) => claimChanges(tabId, live, only),
    },
  },
  {
    pending: (count) => set({ pendingWrites: count }),
    status: (perf) => set({ perf }),
    retrying: (key, text, shown) =>
      set({
        perf: text,
        ...(shown ? { writeError: { key, text, retrying: true } } : {}),
      }),
    uploadsOnly: (key) => releaseAttachments(key),
    answered,
    moved: (from, to) => {
      if (get().issues.has(from)) rekey(from, to);
    },
    discarded: (key) => {
      if (get().issues.has(key)) discard(key, false);
    },
    takeOver: (change) => {
      set({
        issues: new Map(get().issues).set(change.key, change.issue!),
        ...(change.full ? { full: new Map(get().full).set(change.key, change.full) } : {}),
      });
      send([[change.key, {}, { issue: change.issue!, full: change.full }]]);
    },
  },
);
/** The key Jira gave an issue created here; views and closures holding the app key reach the issue through it. */
export const currentKey = (key: string) => writes.currentKey(key);
/** The first key an issue had in this session, so a view stays mounted when Jira assigns the real key. */
export const firstKey = (key: string) => writes.firstKey(key);
/** Image comments Jira already has; a replay re-sends only the rest. */
const jiraImageComments = (edits: Issue["mediaEdits"]) =>
  edits &&
  Object.fromEntries(
    Object.entries(edits).map(([id, edit]) => [
      id,
      { ...edit, comments: edit.comments?.filter((c) => jiraCommentId(c.id)) },
    ]),
  );
export function send(changes: [string, Side, Side][]) {
  if (!get().writable) return;
  // A change that queued no write (nothing to send, or a redo that only cancelled a held comment delete) gets no answer
  // for adopt() to settle, so its Jira fields would stay pinned over every refresh: Jira's copy owns them again (R2-comments-D1).
  for (const key of writes.queue(changes, get().issues))
    if (releaseJiraFields(key)) {
      touch(key);
      queueSave();
    }
  writes.flush();
}
/** Applies Jira's answer to a write: new keys and comment ids, Jira's copy (or a rollback), and what to tell the user. */
function answered({ key: sent, ops, result, created, refused, describes }: Answer) {
  if (created.has(sent)) {
    forgetSelectionCreate(sent);
    rekey(sent, created.get(sent)!);
  }
  // A deleted issue (full null) takes its upload slots with it.
  if (result.full !== undefined && result.key) settleUploads(result.key, result.full);
  // New comment ids too, so undo and redo address the comment Jira now has.
  const comments = new Map([...created].filter(([from]) => from !== sent));
  if (comments.size) {
    rewriteHistory((edits) => renameCommentIds(edits, comments));
    // An image thread keeps its place on the image under the Jira comment id.
    const key = result.key ?? sent,
      issue = get().issues.get(key);
    if (issue?.mediaEdits) {
      set({
        issues: new Map(get().issues).set(key, {
          ...issue,
          mediaEdits: renameCommentIds(issue.mediaEdits, comments),
        }),
      });
      touch(key);
      queueSave();
    }
  }
  // A rejected link or parent naming an issue created here leaves that issue in Jira on its own: say which.
  const orphans =
    ops[0]?.op === "create"
      ? []
      : [...new Set(Object.values(writes.keys()))].filter((created) =>
          JSON.stringify(ops).includes(`"${created}"`),
        );
  if (result.error)
    showNotification({
      text: `Jira did not save the change to ${result.key ?? sent}`,
      detail: `${result.error}${orphans.length ? ` ${orphans.join(", ")} was created in Jira, but not linked.` : ""}`,
    });
  // A comment Jira refused goes back into its composer, so the text is never lost (R2-comments-D4).
  if (result.error)
    for (const op of ops)
      if (op.op === "comment" && !created.has(op.ref))
        returnRejectedComment({ key: result.key ?? sent, parentId: op.parentId, body: op.body });
  adoptJira(result.key ?? sent, result, !!result.error, created, describes);
  for (const other of result.others ?? [])
    adoptJira(other.key, { issue: other, error: result.error }, false, created);
  if (refused) {
    const selection = refusedSelectionCreate(sent);
    const doc = selection && get().full.get(selection.source)?.fields.description;
    if (selection && doc) actions.description(selection.source, selection.restore(doc));
    discard(sent);
  }
  const key = result.key ?? sent;
  set({
    pendingWrites: writes.pending(),
    ...(result.error
      ? { writeError: { key, text: result.error } }
      : get().writeError?.key === key
        ? { writeError: null }
        : {}),
  });
}
/** Drops an issue made here that Jira refused to create, so no ghost stays or is created again after reload (R1-D24). */
function discard(key: string, reopen = true) {
  const issue = get().issues.get(key),
    description = get().full.get(key)?.fields.description;
  const issues = new Map(get().issues),
    full = new Map(get().full);
  issues.delete(key);
  full.delete(key);
  forgetIssue(key);
  touch(key);
  set({ issues, full });
  if (get().selected === key) navigate({ selected: null, panel: false });
  queueSave();
  // The composer comes back with what was typed, so a create Jira refuses loses nothing (R2-comments-D3).
  if (reopen && issue && !get().overlay)
    beginCreate({
      title: issue.summary,
      descriptionDoc: description,
      attachments: issue.attachments,
      status: issue.status,
      type: issue.type,
      priority: issue.priority,
      assignee: issue.assignee,
      labels: issue.labels,
      parent: issue.parent,
      project: issue.project,
      due: issue.due,
      milestones: issue.milestones,
    });
}
export const dismissWriteError = () => set({ writeError: null });
/** A new issue's app key becomes Jira's key everywhere: issues, references, undo history and queued writes. */
function rekey(from: string, to: string) {
  const ids = new Map([[from, to]]),
    mentions = (v: unknown) => namesKey(v, from);
  const { issues, full } = renameIssue(from, to);
  touch(from, to);
  const label = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g");
  rewriteHistory((edits) =>
    edits.map((edit) =>
      mentions(edit) ? { ...renameIds(edit, ids), label: edit.label.replace(label, to) } : edit,
    ),
  );
  writes.rename(from, to);
  set({ issues, full });
  // Saved at once: other tabs wait for this move to send their edits of the issue (sync check 7).
  queueSave();
  rekeyNotification(from, to);
  if (get().selected === from) navigate({ selected: to });
}
/** Takes up key moves another tab saved for issues it created (app key → Jira key). Returns whether any was new. */
export const learnKeys = (keys?: Record<string, string>) => writes.learnKeys(keys);
export const pendingJiraWrites = () => writes.pending();
export const hasPendingWrite = (key: string) => writes.has(key);
export const holdsCommentDelete = (id: string) => writes.holdsDelete(id);
export const holdsCommentDeletes = () => writes.holdsDeletes();
export const creatingIssue = () => writes.creating();
export const writeTab = (key: string) => writes.tab(key);

/** The app key → Jira key moves to save. */
export const keyMoves = () => writes.keys();
/** Writes not yet sent, so leaving the page would lose them until the next load. */
export const unsentWrites = () => writes.unsent();
/** Drops the writes queued for `key` (Jira already has the version shown). */
export const cancelWrites = (key: string) => writes.cancel(key);

let loaded: { remote: Issue[]; inJira: Map<string, Issue>; writable: boolean } = {
  remote: [],
  inJira: new Map(),
  writable: false,
};
/** Puts saved changes over Jira's copies, into `issues` and `full`; each stays with the tab that saved it. */
function install(changes: LocalChange[], issues: Map<string, Issue>, full: Map<string, Full>) {
  for (const change of installChanges(changes, issues, full, loaded.inJira, loaded.writable))
    writes.own(change.key, change.tab ?? "", change.created);
}
/** Starts a load over: forgets queued writes, then puts the saved changes into `issues` and `full` (Jira's copies, from
 *  `remote`) and takes the saved key moves. Call after resetLocalEdits, before the issues are set. */
export function restartSync(
  local: Pick<LocalState, "changes" | "keys">,
  remote: Issue[],
  issues: Map<string, Issue>,
  full: Map<string, Full>,
  writable: boolean,
) {
  writes.reset();
  loaded = { remote, inJira: new Map(remote.map((i) => [i.key, i])), writable };
  install(local.changes, issues, full);
  writes.restoreKeys(local.keys);
}
/** Once the loaded issues are set and saving has started: sends again what Jira hasn't taken of `saved`. */
export function resumeSync(saved: LocalChange[]) {
  // Saved local overrides are the durable outbox: whatever Jira hasn't taken yet is sent again.
  // An override for an issue Jira no longer has is not re-created; only issues made here are. Deletes are never replayed.
  // Only changes of tabs that have closed are replayed, by one tab: an open tab is still sending its own (R1-D6, R1-D7).
  const replay = async (keys?: Set<string>, changes = saved) =>
    send(
      await Promise.all(
        changes
          .filter(
            (change) =>
              (!keys || keys.has(change.key)) &&
              change.issue &&
              (change.created || loaded.remote.some((i) => i.key === change.key)),
          )
          .map(async (change): Promise<[string, Side, Side]> => {
            const after = snapshot(change.key),
              known = loaded.remote.find((i) => i.key === change.key),
              f = after.full;
            const full = f && {
              ...f,
              fields: {
                ...f.fields,
                description: change.fullFields.includes("description")
                  ? f.descriptionBase
                  : f.fields.description,
                comment: {
                  ...f.fields.comment,
                  comments: (f.fields.comment?.comments ?? []).filter(
                    (c: any) => !String(c.id).startsWith("local-"),
                  ),
                },
              },
            };
            // The mirror has no remote links: only links Jira lacks are sent again, and none are removed (R1-D1).
            const links =
              !change.created &&
              change.issueFields.includes("resources") &&
              after.issue?.resources?.some((r) => r.kind !== "document")
                ? await jiraLinks(change.key)
                : undefined;
            // Only fields still owned locally differ from Jira; the rest already match, so they send nothing.
            const remoteFields = Object.fromEntries(
              change.issueFields.map((field) => [
                field,
                field === "attachments"
                  ? aliasAttachments(change.key, known?.attachments ?? [])
                  : field === "mediaEdits"
                    ? jiraImageComments(after.issue?.mediaEdits)
                    : field === "resources"
                      ? after.issue?.resources?.filter(
                          (r) => r.kind === "document" || !r.url || !links || links.has(r.url),
                        )
                      : (known as any)?.[field],
              ]),
            );
            return [
              change.key,
              change.created
                ? {}
                : { issue: after.issue ? { ...after.issue, ...remoteFields } : known, full },
              after,
            ];
          }),
      ),
    );
  takeOverClosed =
    get().writable && navigator.locks && localDataOpen()
      ? () =>
          holdTabLock().then(() =>
            writes.claimClosed(async (claimed, changes) => {
              // A closed tab may have saved edits after this tab read the saved data: send and show the merged copy saved
              // now, as a takeover later on does (sync review 3-5).
              const saved = changes.filter((c) => claimed.has(c.key)),
                issues = new Map(get().issues),
                full = new Map(get().full);
              install(saved, issues, full);
              set({ issues, full });
              for (const key of claimed) writes.release(key);
              await replay(claimed, saved);
            }),
          )
      : undefined;
  if (get().writable) void (takeOverClosed ? takeOverClosed() : (writes.reset(true), replay()));
}
