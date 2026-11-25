import { type CommentState, type ImageCrop, type MediaEdit, type User, type Issue, type Full, type IssueDraft, type RankAnchor } from "@/shared/issue-model";
/**
 * The edits a person makes to issues. Each action records one undo step (undo-history.ts) whose before/after is sent
 * to Jira (jira-sync.ts) on a writable site, and is kept locally until Jira has it (local-edits.ts). Files are kept
 * locally first (local-database.ts), or uploaded to Jira at once on a writable site.
 */
import { cancelWrites, touch } from "./jira-sync";
import { fetchJson } from "./server-data";
import {
  addLocalFiles,
  localFiles,
  nextSeq,
  queueSave,
} from "./local-database";
import { forgetLastEdit, record, rewriteHistoricIssue } from "./undo-history";
import {
  clearLocalEdits,
  editCount,
  isLocalIssue,
  markChanged,
  markCreated,
  patchFields,
  patchIssue,
  withJiraLinks,
} from "./local-edits";
import { announceCreated, showNotification } from "./app-notifications";
import { assignableUsers, projectChoices, statusById, statuses } from "@/shared/board-catalog";
import { createDefaults } from "@/shared/create-defaults";
import { createAssignee, startAssignee } from "@/shared/auto-assign";
import { savedAutomations } from "./browser-preferences";
import { viewSettings } from "@/client/features/views/view-settings";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import { adfToText } from "@/client/features/editor/adf";
import { type Grouping } from "@/shared/view-model";
import { documentHasMedia, normalizeDocument, sameDocument, textToAdf, type AdfDocument } from "@/shared/document";
import { reminderTime } from "@/client/features/reminders/reminder-display";
import { typeChoices, canHaveSubIssues, canParent, defaultIssueType } from "@/shared/issue-properties";
import { canNest, epicLocked, epicOf, epicPatch, parentOf } from "@/shared/epics";
import { replyParent, visibleCommentTotal } from "@/client/features/comments/comment-thread";

import {
  resourceMediaIds,
  type DocumentProperties,
  type IssueResource,
  type LinkPreview,
} from "@/shared/issue-resource";
import { recordRelation } from "@/client/features/issue/issue-activity";
import { newSubIssueDraft, removeSubIssueDraft } from "@/client/features/issue/sub-issue-draft";
import { inverseKind, type Relation } from "@/shared/relations";
import { Unreachable, uploadPlaced } from "./jira-media";
import { trackDraftUpload } from "@/client/features/issue/draft-uploads";
import type { Attachment } from "@/shared/attachment-media";
import { get, set, timed, ME, boardOf, issueBoardId } from "./store";
import { onBoard } from "@/shared/board-membership";

/** The status a new issue gets from the view's scope: Active creates in the first open status outside the backlog. */
function scopeStatus() {
  const prefs = viewSettings(get().board, get()),
    board = get().boards.find((b) => b.id === get().board);
  return prefs.scope === "active"
    ? board?.columns
        .find((c) => !/backlog/i.test(c.name) && c.statuses.some((s) => s.category !== "done"))
        ?.statuses.find((s) => s.category !== "done")?.id
    : undefined;
}
/** Opens the create composer; false when local storage refused it. */
export function beginCreate(draft: IssueDraft = {}): boolean {
  if (!get().canEdit) {
    set({ perf: "Retry local storage before creating an issue" });
    return false;
  }
  const status = scopeStatus(),
    composed: IssueDraft = { ...(status ? { status } : {}), ...(get().mine ? { assignee: ME } : {}), ...draft };
  // Linear's composer edits an issue `Issue.create` already made, so "Auto-assign to self" shows you in its assignee
  // chip, where "No assignee" can still clear it (shared/auto-assign.ts).
  const assignee = createAssignee(composed.assignee, ME, savedAutomations());
  ui.send({
    type: "overlay.open",
    overlay: "create",
    draft: assignee === undefined ? composed : { ...composed, assignee },
  });
  return true;
}

/**
 * Create from the list on screen (C, V, New issue, a group's "+"): the new issue also takes its properties from the view's
 * filters (Linear's create defaults, see create-defaults.ts), so it lands in the view. `draft` (a group's values) wins over them.
 * An issue page or the inbox shows no view, so there the composer starts as `beginCreate` leaves it.
 */
export function beginCreateInView(draft: IssueDraft = {}): boolean {
  const s = get(),
    page = s.panel && !!s.selected && (s.view === "page" || !!s.document),
    board = s.boards.find((b) => b.id === s.board);
  if (page || s.inbox || !board) return beginCreate(draft);
  const saved = s.editorDraft ? undefined : s.savedViews.find((v) => v.id === s.activeViewId)?.filters;
  const defaults = createDefaults(saved, viewSettings(s.board, s).filters, {
    board,
    people: assignableUsers(ME, s.options.users, s.issues.values()),
    me: ME,
    defaultStatus: scopeStatus() ?? board.columns[0]?.statuses[0]?.id,
    lookup: (key) => s.issues.get(key),
  }, draft);
  return beginCreate(defaults);
}

const now = () => new Date().toISOString();
/** Linear's `assignToState` options: `skipSelfAssign` when the same edit already chose the assignee. */
type StatusOptions = { skipSelfAssign?: boolean };
/** On a writable site a crop uploads as a new Jira attachment, which takes the original's place in the description. Read-only sites keep it as a local view edit. */
export async function saveCrop(key: string, id: string, crop: ImageCrop, file: File) {
  const edit = () => ({ ...get().issues.get(key)?.mediaEdits?.[id], crop });
  if (!get().writable) {
    actions.mediaEdit(key, id, edit());
    return;
  }
  const [saved] = await addLocalFiles([file]),
    issue = get().issues.get(key);
  if (!issue || !saved) return;
  let swapped = false;
  const swap = (node: any): any => {
    if (!node || typeof node !== "object") return node;
    if (["media", "mediaInline"].includes(node.type) && node.attrs?.id === id) {
      swapped = true;
      const { width, height } = node.attrs;
      return {
        ...node,
        attrs: {
          ...node.attrs,
          id: saved.id,
          collection: "local",
          localId: saved.id,
          ...(width && height
            ? { width: Math.round(width * crop.width), height: Math.round(height * crop.height) }
            : {}),
        },
      };
    }
    return Array.isArray(node.content) ? { ...node, content: node.content.map(swap) } : node;
  };
  const description = swap(normalizeDocument(get().full.get(key)?.fields.description));
  record(key, `crop image on ${key}`, () => {
    patchIssue(key, {
      attachments: [...(issue.attachments ?? []), saved],
      ...(swapped ? {} : { mediaEdits: { ...issue.mediaEdits, [id]: edit() } }),
    });
    if (swapped) patchFields(key, () => ({ description }));
  });
}
/** Local copies of files picked into an issue's editor, which places them at once. */
export const keepIssueFiles = (files: File[]) => localFiles()(files);
/**
 * Files a composer keeps for an issue Jira hasn't made yet; they upload once it is made. Linear's composer uploads a file
 * the moment it is picked, so one picked offline is refused as Linear refuses it.
 */
export async function keepComposerFiles(files: File[]) {
  if (get().writable && !navigator.onLine) throw new Unreachable(new Error("The browser is offline."));
  return localFiles()(files);
}
/**
 * Sends a file an issue's editor placed to Jira under its local id, then lists it with the issue's attachments. The upload
 * is noted while it goes, so a copy Jira keeps that no description, comment or draft shows is removed later
 * (draft-uploads). A read-only site, or an issue Jira hasn't made yet, keeps it here (the write that places it uploads it
 * once Jira has the issue).
 */
export async function uploadIssueFile(key: string, file: Attachment, picked: File) {
  if (get().writable && !isLocalIssue(key))
    await trackDraftUpload(get().namespace, key, { id: file.id, name: picked.name, size: picked.size }, () =>
      uploadPlaced(key, file.id, picked),
    );
  const issue = get().issues.get(key);
  if (issue)
    record(key, `attached files to ${key}`, () =>
      patchIssue(key, { attachments: [...(issue.attachments ?? []), file] }),
    );
}
/** Submission id → the issue it created. */
const submissions = new Map<string, string>();

// Local overrides are saved separately from the read-only Jira mirror.
export const actions = {
  /** `document` targets one of the issue's documents, as Linear's document Remind me does. */
  remind(key: string, at: string | null, document?: string) {
    if (at !== null && (!Number.isFinite(Date.parse(at)) || Date.parse(at) <= Date.now())) return;
    const reminder = at ? { at } : null,
      issue = get().issues.get(key);
    record(key, `${at ? "set" : "cancel"} reminder on ${key}`, () =>
      patchIssue(
        key,
        document
          ? {
              resources: issue?.resources?.map((r) =>
                r.id === document ? { ...r, reminder } : r,
              ),
            }
          : { reminder },
      ),
    );
    showNotification({
      text: at ? "Reminder set" : "Reminder canceled",
      ...(at ? { detail: `You will receive a reminder on ${reminderTime(at)}` } : {}),
    });
  },
  deliverReminder(key: string, document?: string) {
    const issue = get().issues.get(key),
      target = document ? issue?.resources?.find((r) => r.id === document) : issue;
    if (
      !get().canEdit ||
      !issue ||
      !target?.reminder ||
      target.reminder.delivered ||
      Date.parse(target.reminder.at) > Date.now()
    )
      return;
    // Delivery is a fact, not a user edit. Preserve it in historical snapshots without adding an undo step.
    const deliver = <T extends { reminder?: { at: string; delivered?: boolean } | null }>(
      item: T,
    ): T =>
      item.reminder && Date.parse(item.reminder.at) <= Date.now()
        ? { ...item, reminder: { ...item.reminder, delivered: true } }
        : item;
    const delivered = (item: Issue): Issue =>
      document
        ? { ...item, resources: item.resources?.map((r) => (r.id === document ? deliver(r) : r)) }
        : deliver(item);
    rewriteHistoricIssue(key, delivered);
    const next = delivered(issue);
    patchIssue(key, document ? { resources: next.resources } : { reminder: next.reminder });
    markChanged(key);
    touch(key);
    queueSave();
    showNotification({
      text: `Reminder: ${document ? (target as IssueResource).title || "New document" : issue.summary}`,
      key,
    });
  },
  /** False when the issue already has this URL. */
  resource(key: string, resource: IssueResource) {
    const issue = get().issues.get(key);
    if (!issue) return false;
    if (
      resource.url &&
      (issue.resources?.some((r) => r.url === resource.url) || issue.links?.includes(resource.url))
    )
      return false;
    record(
      key,
      `${resource.kind === "document" ? "create document" : "add resource"} on ${key}`,
      () =>
        patchIssue(key, {
          resources: [...(issue.resources ?? []).filter((r) => r.id !== resource.id), resource],
        }),
    );
    return true;
  },
  /** A link's fetched preview is display only: not an edit, so it never marks the issue changed or sends it to Jira (R1-D1). */
  linkPreview(key: string, id: string, preview: LinkPreview) {
    const issue = get().issues.get(key);
    if (!issue?.resources?.some((r) => r.id === id && r.kind !== "document")) return;
    const add = (item: Issue): Issue => ({
      ...item,
      resources: item.resources?.map((r) => (r.id === id ? { ...r, preview } : r)),
    });
    rewriteHistoricIssue(key, add);
    set({ issues: new Map(get().issues).set(key, add(issue)) });
  },
  removeResource(key: string, id: string) {
    const issue = get().issues.get(key),
      resource = issue?.resources?.find((r) => r.id === id);
    if (!issue || !resource) return;
    const resources = issue.resources?.filter((r) => r.id !== id),
      removed = resourceMediaIds(resource),
      retained = resourceMediaIds(get().full.get(key)?.fields.description);
    for (const other of resources ?? []) resourceMediaIds(other, retained);
    for (const comment of get().full.get(key)?.fields.comment?.comments ?? [])
      resourceMediaIds(comment.body, retained);
    record(
      key,
      `${resource.kind === "document" ? "delete document" : "remove resource"} ${resource.title || "New document"} on ${key}`,
      () => {
        patchIssue(key, {
          resources,
          attachments: issue.attachments?.filter((a) => !removed.has(a.id) || retained.has(a.id)),
        });
        // The projection's `links` lists the remote link's URL until Jira's copy comes back; left there, it shows as a bare-URL
        // row while Jira deletes it (R3-relations-D8). Not pinned as a local field: the next read of Jira owns it again.
        const now = get().issues.get(key);
        if (resource.url && now?.links?.includes(resource.url))
          set({
            issues: new Map(get().issues).set(key, {
              ...now,
              links: now.links.filter((url) => url !== resource.url),
            }),
          });
      },
    );
  },
  /** `restore` always keeps the replaced version, however recent the last edit was. */
  editResource(
    key: string,
    id: string,
    patch: Partial<Pick<IssueResource, "title" | "body">>,
    session?: string,
    restore = false,
  ) {
    const issue = get().issues.get(key),
      resource = issue?.resources?.find((r) => r.id === id);
    if (!issue || !resource) return;
    if (
      Object.entries(patch).every(
        ([key, value]) =>
          JSON.stringify(resource[key as keyof IssueResource]) === JSON.stringify(value),
      )
    )
      return;
    const at = now(),
      history = resource.history ?? [];
    // Keep the version before a new editing session after a minute of inactivity.
    const replaced = { title: resource.title, body: normalizeDocument(resource.body) },
      last = history.at(-1);
    const checkpoint =
      (restore || Date.parse(at) - Date.parse(resource.updated) >= 60000) &&
      !!(resource.title || documentHasMedia(resource.body) || adfToText(resource.body)) &&
      !(
        last &&
        last.title === replaced.title &&
        JSON.stringify(normalizeDocument(last.body)) === JSON.stringify(replaced.body)
      );
    const revisions = checkpoint
      ? [
          ...history,
          {
            ...replaced,
            at: resource.updated,
            author: resource.editedBy ?? resource.owner ?? { ...ME },
          },
        ].slice(-100)
      : history;
    record(
      key,
      `edit document on ${key}`,
      () =>
        patchIssue(key, {
          resources: issue.resources?.map((r) =>
            r.id === id
              ? { ...r, ...patch, updated: at, editedBy: { ...ME }, history: revisions }
              : r,
          ),
        }),
      session,
    );
  },
  documentProperties(
    key: string,
    id: string,
    patch: Omit<DocumentProperties, "editedBy" | "history">,
  ) {
    const issue = get().issues.get(key);
    if (!issue?.resources?.some((r) => r.id === id && r.kind === "document")) return;
    record(key, `change document settings on ${key}`, () =>
      patchIssue(key, {
        resources: issue.resources?.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      }),
    );
  },
  async restoreJira(key: string) {
    if (isLocalIssue(key) || !get().canEdit) return;
    const edits = editCount(key);
    try {
      const [remote, full] = await Promise.all([
        fetchJson<Issue[]>("/api/issues"),
        fetchJson<Full>(`/api/issues/${encodeURIComponent(key)}`),
      ]);
      const issue = remote.find((i) => i.key === key);
      if (!issue) throw new Error("Issue is no longer in the Jira mirror");
      // An edit made after the click is newer than the choice to restore: keep it and say so (sync check 6).
      if (editCount(key) !== edits) {
        showNotification({
          text: `Didn't restore ${key}`,
          detail:
            "You edited it while Jira's version loaded. Restore again to discard your changes.",
        });
        return;
      }
      // Jira already has this version: queued edits are dropped and nothing is written (R2-D3).
      cancelWrites(key);
      record(
        key,
        `restore Jira version of ${key}`,
        () => {
          clearLocalEdits(key);
          // The mirror's list carries no remote links: take them from the full record, or the restore would delete them in Jira (R2-issue-fields-D2).
          const current = get().issues.get(key);
          set({
            issues: new Map(get().issues).set(key, {
              ...issue,
              resources: withJiraLinks(current?.resources, full.remotelinks, true),
            }),
            full: new Map(get().full).set(key, full),
            perf: `Restored mirrored Jira version of ${key}`,
          });
          dispatchEvent(new CustomEvent("jira-restored", { detail: key }));
          ui.send({ type: "overlay.close" });
        },
        undefined,
        true,
      );
    } catch {
      showNotification({
        text: "Could not read the Jira version",
        detail: "Nothing was restored. Your local changes are still here.",
      });
    }
  },
  patch(
    key: string,
    patch: IssueDraft &
      Partial<
        Pick<
          Issue,
          "links" | "resources" | "relations" | "reactions" | "watchers" | "watchersComplete"
        >
      >,
  ) {
    timed(`edit ${key}`, () => record(key, `edit ${key}`, () => patchIssue(key, patch)));
  },
  /** `place` is where the card was dropped in manual order: its rank and the card Jira ranks it beside (routes/board-drop.ts). */
  drop(key: string, boardId: number, groups: { by: Grouping; id: string }[], place?: { rank?: string; rankAnchor?: RankAnchor }) {
    const issue = get().issues.get(key),
      board = get().boards.find((b) => b.id === boardId);
    if (!issue || !board || !onBoard(issue, boardId)) return;
    // Jira only changes a type within its hierarchy level (no Subtask ↔ Task), like the type menu: a drop onto another level is ignored.
    const types = get().options.types?.[issue.project?.key ?? ""];
    if (
      types &&
      groups.some(
        ({ by, id }) =>
          by === "type" && id !== issue.type && !typeChoices(issue.type, types, []).includes(id),
      )
    )
      return;
    // Only a standard issue goes into an epic, its project (shared/epics.ts): a drop moving an epic or a sub-issue to another
    // project group is ignored, as the type menu ignores a drop it can't make.
    const lookup = (k: string) => get().issues.get(k);
    if (
      groups.some(({ by, id }) => by === "project" && id !== (epicOf(issue, lookup) ?? "$none")) &&
      epicLocked(issue, lookup)
    )
      return;
    // A drop into an assignee group chooses the assignee itself, so a started column doesn't also assign you (`skipSelfAssign`).
    const skipSelfAssign = groups.some(({ by }) => by === "assignee");
    // One drag, including its column and row changes, is one undoable edit.
    record(key, `move ${key}`, () => {
      if (place?.rank !== undefined) patchIssue(key, { rank: place.rank, rankAnchor: place.rankAnchor });
      for (const { by, id } of groups) {
        const current = get().issues.get(key)!;
        if (by === "status") {
          const col = board.columns.findIndex((c) => c.name === id);
          if (col >= 0) actions.move(key, col, { skipSelfAssign });
        } else if (by === "category") {
          const status = statuses(board).find((s) => s.category === id);
          if (status) actions.status(key, status.id, { skipSelfAssign });
        } else if (by === "assignee")
          actions.assign(
            key,
            id === "$none"
              ? null
              : id === ME.id
                ? ME
                : ([...get().issues.values()].find((i) => i.assignee?.id === id)?.assignee ?? null),
          );
        else if (by === "project" && id !== (epicOf(current, lookup) ?? "$none"))
          actions.patch(key, epicPatch(id === "$none" ? null : id));
        else if (by === "priority" || by === "type")
          actions.patch(key, { [by]: id === "$none" ? undefined : id });
        else if (by === "label")
          actions.patch(key, {
            labels: id === "$none" ? [] : [...new Set([...current.labels, id])],
          });
        // Parent groups are parent issues (parentOf): "No parent" never takes an issue's epic away, and no epic becomes one.
        else if (
          by === "parent" &&
          id !== (parentOf(current, lookup) ?? "$none") &&
          // Jira takes a parent only one hierarchy level up (`canParent`): a Bug dropped on a Spike's group stays put.
          (id === "$none" || (canNest(lookup(id) ?? {}, current) && canParent(get(), lookup(id) ?? {}, current)))
        ) {
          let ancestor = id;
          const seen = new Set([key]);
          let cycle = false;
          while (ancestor && ancestor !== "$none") {
            if (seen.has(ancestor)) {
              cycle = true;
              break;
            }
            seen.add(ancestor);
            ancestor = get().issues.get(ancestor)?.parent ?? "";
          }
          if (!cycle) actions.patch(key, { parent: id === "$none" ? undefined : id });
        }
      }
    });
  },
  /** Move to a column's first status; no-op if the issue is already in that column. */
  move(key: string, col: number, options: StatusOptions = {}) {
    const c = boardOf(key)?.columns[col];
    if (c?.statuses[0] && !c.statuses.some((x) => x.id === get().issues.get(key)?.status))
      actions.status(key, c.statuses[0].id, options);
  },
  /**
   * Every status change (S, ⌘K, the issue menu, a drag, the sidebar's status) comes through here, as all of Linear's go through
   * `Issue.assignToState`: so "On move to started status, assign to yourself" assigns an unassigned issue in the same undo step
   * as the move, with no toast of its own (shared/auto-assign.ts).
   */
  status(key: string, id: string, { skipSelfAssign = false }: StatusOptions = {}) {
    const i = get().issues.get(key);
    const s = statusById(boardOf(key), id);
    ui.send({ type: "overlay.close" });
    if (!i || !s || i.status === id) return;
    const assignee = startAssignee(i, s.category, ME, savedAutomations(), skipSelfAssign);
    timed(`move ${key} → ${s.name}`, () =>
      record(key, `move ${key}`, () =>
        patchIssue(key, {
          status: s.id,
          statusSince: now(),
          started: i.started ?? (s.category === "indeterminate" ? now() : undefined),
          resolved: s.category === "done" ? (i.resolved ?? now()) : null,
          ...(assignee ? { assignee: { ...assignee } } : {}),
        }),
      ),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      record(key, `assign ${key}`, () => patchIssue(key, { assignee: user }));
      ui.send({ type: "overlay.close" });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== get().issues.get(key)?.summary)
      timed(`edit ${key} summary`, () =>
        record(key, `rename ${key}`, () => patchIssue(key, { summary: summary.trim() })),
      );
  },
  mediaEdit(key: string, id: string, edit: MediaEdit) {
    const issue = get().issues.get(key);
    if (issue)
      record(key, `image edit on ${key}`, () =>
        patchIssue(key, { mediaEdits: { ...issue.mediaEdits, [id]: edit } }),
      );
  },
  /** restore: always keep the version being replaced (unless it is already the newest entry), even inside the one-minute window. */
  description(key: string, value: string | AdfDocument, restore = false) {
    const previous = normalizeDocument(get().full.get(key)?.fields.description);
    const document = normalizeDocument(value);
    // Any new version replaces one Jira refused: it is sent from Jira's copy, or is Jira's copy.
    const f = get().full.get(key);
    if (f?.descriptionRejected) {
      const { descriptionRejected: _r, descriptionError: _e, ...rest } = f;
      set({ full: new Map(get().full).set(key, rest) });
      if (get().writeError?.key === key) set({ writeError: null });
      touch(key);
      queueSave();
    }
    if (sameDocument(document, previous)) return;
    timed(`edit ${key} description`, () =>
      record(key, `description on ${key}`, () => {
        patchFields(key, () => ({ description: document }));
        // Autosave writes often; one history entry per minute of editing keeps the revision list readable.
        const history = get().issues.get(key)?.descriptionHistory ?? [],
          last = history.at(-1),
          recent = !!last && Date.now() - Date.parse(last.at) < 60_000;
        const keep = restore
          ? !(
              last &&
              JSON.stringify(normalizeDocument(last.document ?? last.text)) ===
                JSON.stringify(previous)
            )
          : !recent;
        patchIssue(key, {
          description: adfToText(document),
          descriptionHistory: keep
            ? [...history, { text: adfToText(previous), document: previous, at: now() }]
            : history,
        });
      }),
    );
  },
  /** Use Jira's version: drops a refused description (and any unsaved text) into the description history, so it can still be restored. */
  discardDescription(key: string, unsaved?: AdfDocument) {
    const f = get().full.get(key),
      issue = get().issues.get(key),
      dropped = unsaved ?? f?.descriptionRejected;
    if (f?.descriptionRejected) {
      const { descriptionRejected: _r, descriptionError: _e, ...rest } = f;
      set({ full: new Map(get().full).set(key, rest) });
    }
    if (issue && dropped && adfToText(dropped) !== adfToText(f?.fields.description)) {
      const doc = normalizeDocument(dropped);
      markChanged(key);
      set({
        issues: new Map(get().issues).set(key, {
          ...issue,
          descriptionHistory: [
            ...(issue.descriptionHistory ?? []),
            { text: adfToText(doc), document: doc, at: now() },
          ],
        }),
      });
    }
    if (get().writeError?.key === key) set({ writeError: null });
    touch(key);
    queueSave();
  },
  /** `replyTo` may be any comment in a thread; the reply is filed under the thread's Jira parent. */
  comment(key: string, value: string | AdfDocument, replyTo?: string): boolean {
    const body = typeof value === "string" ? textToAdf(value) : normalizeDocument(value);
    const parentId =
      replyTo &&
      replyParent(
        get().full.get(key)?.fields.comment?.comments ?? [],
        replyTo,
        get().issues.get(key)?.commentStates,
      );
    if (replyTo && !parentId) return false;
    if (
      (!adfToText(body).trim() && !documentHasMedia(body)) ||
      !get().full.has(key) ||
      !get().canEdit
    )
      return false;
    timed(`comment on ${key}`, () =>
      record(key, `comment on ${key}`, () => {
        const c = {
          id: `local-${nextSeq()}`,
          ...(parentId ? { parentId } : {}),
          author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "48x48": ME.avatar } },
          body,
          created: now(),
        };
        patchFields(key, (f) => ({
          comment: {
            ...f.comment,
            comments: [...(f.comment?.comments ?? []), c],
            total: (f.comment?.total ?? 0) + 1,
          },
        }));
        patchIssue(key, { comments: (get().issues.get(key)?.comments ?? 0) + 1 });
      }),
    );
    return true;
  },
  commentState(key: string, id: string, patch: CommentState) {
    const issue = get().issues.get(key),
      full = get().full.get(key);
    if (!issue || !full) return;
    const comments = full.fields.comment?.comments ?? [];
    if (!comments.some((c: any) => c.id === id)) return;
    record(key, `update comment on ${key}`, () => {
      const commentStates = {
        ...issue.commentStates,
        [id]: { ...issue.commentStates?.[id], ...patch },
      };
      patchIssue(key, {
        commentStates,
        comments: visibleCommentTotal(
          full.fields.comment?.total ?? comments.length,
          comments,
          commentStates,
        ),
      });
    });
  },
  editComment(key: string, id: string, value: AdfDocument) {
    const comment = get().full.get(key)?.fields.comment?.comments?.find((c: any) => c.id === id),
      body = normalizeDocument(value);
    if (
      !comment ||
      comment.author?.accountId !== ME.id ||
      (!adfToText(body).trim() && !documentHasMedia(body))
    )
      return;
    actions.commentState(key, id, { body, updated: now() });
  },
  deleteComment(key: string, id: string) {
    const comment = get().full.get(key)?.fields.comment?.comments?.find((c: any) => c.id === id);
    // Linear confirms first and shows no toast; local undo history still covers it.
    if (comment?.author?.accountId === ME.id) actions.commentState(key, id, { deleted: true });
  },
  /** Removes files a comment draft uploaded and then dropped, unless the description, a comment or a resource shows them. */
  dropDraftFiles(key: string, ids: string[]) {
    const issue = get().issues.get(key),
      full = get().full.get(key);
    if (!issue) return;
    const used = resourceMediaIds(full?.fields.description);
    for (const c of full?.fields.comment?.comments ?? []) resourceMediaIds(c.body, used);
    for (const c of Object.values(issue.commentStates ?? {})) resourceMediaIds(c.body, used);
    for (const r of issue.resources ?? []) resourceMediaIds(r, used);
    const drop = new Set(ids.filter((id) => !used.has(id)));
    if (issue.attachments?.some((a) => drop.has(a.id)))
      record(key, `remove unused draft files from ${key}`, () =>
        patchIssue(key, { attachments: issue.attachments!.filter((a) => !drop.has(a.id)) }),
      );
  },
  /** Like Linear, creating from the composer stays on the board and confirms with a toast; `open` shows the new issue instead. */
  create(summary: string, draft: IssueDraft = {}, more = false, open = false) {
    if (!get().canEdit) return;
    // The submit itself is guarded, not just its button: one submission makes one issue (comments smoke F1).
    const made = draft.submission && submissions.get(draft.submission);
    if (made) return made;
    const board = get().boards.find((b) => b.id === (draft.board ?? get().board));
    const status = statusById(board, draft.status) ?? statuses(board)[0];
    if (!board || !status || !summary.trim() || (draft.subIssues?.some(title => title.trim()) && !canHaveSubIssues(get(), draft))) return;
    // The board's Jira project (its location, else its issues'): an empty board creates there too.
    const boardsIssues = [...get().issues.values()].filter((i) => onBoard(i, board.id));
    const project = draft.project ?? projectChoices(boardsIssues, board)[0];
    const prefix = boardsIssues[0]?.key.split("-")[0] ?? project?.key ?? "LOCAL";
    const key = `${prefix}-NEW${nextSeq()}`;
    markCreated(key);
    if (draft.submission) submissions.set(draft.submission, key);
    const {
      descriptionDoc,
      related,
      subIssues,
      title: _title,
      copy: _copy,
      submission: _submission,
      board: _board,
      ...fields
    } = draft;
    const document = normalizeDocument(descriptionDoc ?? draft.description ?? "");
    // "Auto-assign to self" for creates that skip the composer (sub-issues, inline sub-issue rows); null stays "No assignee".
    const assignee = createAssignee(fields.assignee, ME, savedAutomations());
    timed(`create ${key}`, () =>
      record(key, `create ${key}`, () => {
        const issue: Issue = {
          key,
          boards: [board.id],
          summary: summary.trim(),
          type: defaultIssueType(get().options.types?.[project?.key ?? ""]),
          priority: get().writable ? undefined : "Normal",
          assignee: null,
          labels: [],
          rank: "0",
          comments: 0,
          updated: now(),
          created: now(),
          statusSince: now(),
          creator: ME,
          milestones: [],
          prCount: 0,
          watchers: [],
          watchersComplete: true,
          project,
          ...fields,
          ...(assignee !== undefined ? { assignee } : {}),
          description: adfToText(document),
          status: status.id,
          resolved: status.category === "done" ? now() : null,
        };
        const full: Full = {
          key,
          fields: {
            description: document,
            created: now(),
            comment: { comments: [], total: 0 },
            reporter: {
              accountId: ME.id,
              displayName: ME.name,
              avatarUrls: { "48x48": ME.avatar },
            },
          },
        };
        set({
          issues: new Map(get().issues).set(key, issue),
          full: new Map(get().full).set(key, full),
        });
        if (related && get().issues.has(related.key)) {
          if (related.kind === "parent") actions.patch(related.key, { parent: key });
          else actions.relate(key, related.key, related.kind);
        }
        for (const [index, title] of (subIssues ?? []).entries()) {
          if (title.trim()) actions.create(title, {
            ...newSubIssueDraft(issue),
            submission: draft.submission ? `${draft.submission}:child:${index}` : undefined,
            board: board.id,
          }, true);
        }
        // "Create more" keeps the composer open; otherwise open the issue, or stay on the board with a toast.
        if (!more) {
          navigate(open ? { selected: key, panel: true } : { selected: key });
          ui.send({ type: "overlay.close" });
        }
        // "Create more" keeps the composer open, so the toast is its only confirmation (Linear); with Jira writes it waits for Jira.
        if (more || !open) announceCreated(key);
      }),
    );
    return key;
  },
  /** With Jira writes this only asks first (DeleteConfirm); the dialog calls back with `confirmed`. */
  remove(key: string, confirmed = false) {
    // Jira cannot restore a deleted issue; undo would only create a copy under a new key, re-posting comments as you.
    if (get().writable && !confirmed) {
      set({ deleting: key });
      return;
    }
    const related = [...get().issues.values()].filter(
      (i) => i.parent === key || i.relations?.some((r) => r.key === key),
    );
    record([key, ...related.map((i) => i.key)], `delete ${key}`, () => {
      for (const issue of related)
        patchIssue(issue.key, {
          ...(issue.parent === key ? { parent: undefined } : {}),
          relations: issue.relations?.filter((r) => r.key !== key),
        });
      const issues = new Map(get().issues),
        full = new Map(get().full);
      issues.delete(key);
      full.delete(key);
      set({
        issues,
        full,
        perf: get().writable ? `Deleted ${key} in Jira.` : `Deleted ${key}. Undo to restore.`,
      });
      // A sub-issue row's delete keeps its parent open.
      if (get().selected === key) navigate({ selected: null, panel: false });
      ui.send({ type: "overlay.close" });
    });
    if (get().writable) {
      forgetLastEdit(`delete ${key}`);
      removeSubIssueDraft(get().namespace, key);
    }
  },
  /** Linear's Make a copy: the composer, prefilled, saves the copy; nothing is created until then. */
  duplicate(key: string) {
    const issue = get().issues.get(key);
    if (!issue) return;
    navigate({ board: issueBoardId(issue) });
    beginCreate({
      title: `${issue.summary} (copy)`,
      copy: true,
      status: issue.status,
      assignee: issue.assignee,
      priority: issue.priority,
      labels: [...issue.labels],
      project: issue.project,
      milestones: issue.milestones,
      due: issue.due,
      parent: issue.parent,
      type: issue.type,
      descriptionDoc: normalizeDocument(
        get().full.get(key)?.fields.description ?? issue.description,
      ),
    });
  },
  /** `linked`: what the row shows of a target the mirror doesn't hold, kept when Change to… re-adds the relation (BJ-15). */
  relate(key: string, target: string, kind: string, remove = false, linked?: Relation["issue"]) {
    if (key === target) return;
    const inverse = inverseKind(kind);
    record([key, target], `${remove ? "remove" : "add"} relation`, () => {
      for (const [from, to, relation] of [
        [key, target, kind],
        [target, key, inverse],
      ] as const) {
        const issue = get().issues.get(from),
          held = issue?.relations?.find((r) => r.key === to && r.kind === relation);
        if (!issue || !!held !== remove) continue;
        const relations = (issue.relations ?? []).filter(
          (r) => r.key !== to || r.kind !== relation,
        );
        if (!remove)
          relations.push({ key: to, kind: relation, ...(from === key && linked ? { issue: linked } : {}) });
        patchIssue(from, {
          relations,
          activity: [
            ...recordRelation(
              issue.activity ?? [],
              // A Jira link kind keeps its phrase, so Activity names a removed "is caused by" link as Jira does.
              { key: to, kind: relation, ...(held?.label ? { label: held.label } : {}) },
              remove,
              ME,
              now(),
              () => crypto.randomUUID(),
            ),
          ],
        });
      }
    });
  },
  /** Turn a relation into another kind as one undoable edit (BJ-52, Linear's relation pill › Change to…). */
  changeRelation(key: string, target: string, from: string, to: string) {
    const linked = get().issues.get(key)?.relations?.find((r) => r.key === target)?.issue;
    record([key, target], "change relation", () => {
      actions.relate(key, target, from, true);
      actions.relate(key, target, to, false, linked);
    });
  },
};
