import { Debouncer } from "@tanstack/pacer";
import { useEffect, useState } from "react";
import { type Issue, type IssueDraft } from "@/shared/issue-model";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "@/shared/document";
import { adfToText } from "@/client/features/editor/adf";
import { readStored, writeStored } from "@/client/state/stored-state";
import { switchBoard } from "./composer-draft";

/**
 * The create composer's local draft: everything in it (title, description, every property, pending sub-issues and links,
 * attached files, Create more), kept in this browser so a reload, a crash or a closed tab loses nothing. Linear's
 * `Dot("CreateIssue")` (startup-root) keeps the same: one draft per user under `CreateIssue_<userId>__DRAFT__` in
 * localStorage, its Create more and sub-issues beside it (`setLocalDraftMeta`), merged back into the composer when it next
 * opens (`applyLocalDraft` → `applyDraftValues` → `mergeInto`). The synced "Save to drafts" list is a different thing
 * (Linear's IssueDraft models; here `composer-drafts:v1`); this is the single unsaved one.
 */
export type ComposerLocalDraft = {
  fields: IssueDraft;
  title: string;
  description: AdfDocument;
  labels: string[];
  attachments: NonNullable<Issue["attachments"]>;
  /** Linear's draft meta `createMore`. */
  more: boolean;
};

/** One per account, as Linear's `draftName` is `<name>_<userId>`. */
export const localDraftKey = (namespace: string) => `better-jira:create-issue-draft:v1:${namespace}`;

/** How long after the last change the draft is written; a reload or close in between flushes it at once. */
export const SAVE_WAIT = 400;

/** What a composer was opened with that is never part of a draft: a submit id, the editor waiting on a selection, suggestions
 *  from the view's filters, the copy flag. */
const TRANSIENT = ["submission", "fromSelection", "suggestedAssignees", "suggestedEpics", "copy"] as const;
function persistable(fields: IssueDraft): IssueDraft {
  const kept = { ...fields };
  for (const key of TRANSIENT) delete kept[key];
  return kept;
}

/**
 * Linear keeps a draft only when it holds something worth finishing (`W.eligibleForDraft`, startup-entry): a title of 3+
 * characters, a description of 3+ characters, or any title with any description. Properties alone are not a draft.
 */
export function draftEligible(title: string, description: AdfDocument): boolean {
  const name = title.trim(),
    text = adfToText(description).trim(),
    hasDescription = !!text || documentHasMedia(description);
  return name.length >= 3 || text.length >= 3 || (!!name && hasDescription);
}

function parse(raw: unknown): ComposerLocalDraft | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Partial<ComposerLocalDraft>;
  if (!d.fields || typeof d.fields !== "object" || typeof d.title !== "string") return undefined;
  return {
    fields: persistable(d.fields),
    title: d.title,
    description: normalizeDocument(d.description),
    labels: Array.isArray(d.labels) ? d.labels.filter((l): l is string => typeof l === "string") : [],
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
    more: d.more === true,
  };
}

export function readLocalDraft(namespace: string): ComposerLocalDraft | undefined {
  return readStored(localDraftKey(namespace), parse, undefined);
}

/** Writes the draft, or removes it once it no longer holds anything worth keeping (the composer emptied, an issue created). */
export function writeLocalDraft(namespace: string, draft: ComposerLocalDraft | undefined) {
  const keep = draft && draftEligible(draft.title, draft.description);
  return writeStored(
    localDraftKey(namespace),
    keep ? { ...draft, fields: persistable(draft.fields) } : undefined,
    "Could not keep the issue draft locally",
  );
}

/**
 * What a composer opens with. An opener that brings content of its own (a copy, a create Jira refused, text from a selection
 * or a comment) opens as given. Otherwise the stored draft comes back over what the opener set, its values winning field by
 * field as Linear's `mergeInto` does; a board that is gone falls back to the opener's, without that board's statuses, people,
 * epic and versions (`switchBoard`).
 */
export function resumeDraft(
  initial: IssueDraft,
  stored: ComposerLocalDraft | undefined,
  boards: readonly number[],
): ComposerLocalDraft {
  const own: ComposerLocalDraft = {
    fields: initial,
    title: initial.title ?? "",
    description: normalizeDocument(initial.descriptionDoc ?? initial.description ?? ""),
    labels: initial.labels ?? [],
    attachments: initial.attachments ?? [],
    more: false,
  };
  if (!stored || seeded(initial)) return own;
  const board = stored.fields.board;
  if (board === undefined || boards.includes(board)) return { ...stored, fields: { ...initial, ...stored.fields } };
  const { board: _gone, ...rest } = switchBoard(stored.fields, board, -1);
  return { ...stored, fields: { ...initial, ...rest } };
}

/** An opener that filled in the title or description itself: its content is the draft. */
export function seeded(initial: IssueDraft): boolean {
  return !!initial.copy || initial.title !== undefined || initial.descriptionDoc !== undefined || initial.description !== undefined;
}

/**
 * The composer's writer: `save` writes the latest draft `SAVE_WAIT` after the last call (TanStack Pacer), `flush` writes a
 * pending one now (a reload, the composer closing), `clear` drops the draft and anything pending (an issue created, the draft
 * saved to the drafts list, or discarded); a later `save` writes again.
 */
export function localDraftWriter(namespace: string) {
  let latest: ComposerLocalDraft | undefined;
  const debouncer = new Debouncer(() => writeLocalDraft(namespace, latest), { wait: SAVE_WAIT });
  return {
    save(next: ComposerLocalDraft) {
      latest = next;
      debouncer.maybeExecute();
    },
    flush: () => debouncer.flush(),
    clear() {
      debouncer.cancel();
      latest = undefined;
      writeLocalDraft(namespace, undefined);
    },
  };
}

/**
 * Keeps the open composer's draft in localStorage: every change goes to the writer, and a pending write lands when the page
 * hides (a reload, a closed tab) or the composer closes. `enabled` false (a copy) writes nothing.
 */
export function useComposerLocalDraft(namespace: string, enabled: boolean, draft: ComposerLocalDraft) {
  const [writer] = useState(() => localDraftWriter(namespace));
  const { fields, title, description, labels, attachments, more } = draft;
  useEffect(() => {
    if (enabled) writer.save({ fields, title, description, labels, attachments, more });
  }, [writer, enabled, fields, title, description, labels, attachments, more]);
  useEffect(() => {
    window.addEventListener("pagehide", writer.flush);
    return () => {
      window.removeEventListener("pagehide", writer.flush);
      writer.flush();
    };
  }, [writer]);
  return writer;
}
