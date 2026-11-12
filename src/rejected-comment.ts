/**
 * A comment Jira refused goes back to its writer, so the text is never lost (R2-comments-D4): an open composer for that
 * thread takes it back; otherwise it waits in the issue's stored comment draft, after anything typed since.
 */
import { adfToText } from "./adf";
import { documentHasMedia, normalizeDocument, type AdfDocument } from "./document";
import { get } from "./store";

const REJECTED = "better-jira:comment-rejected";
export type RejectedComment = {
  key: string;
  parentId?: string;
  body: AdfDocument;
};

/** Where the issue's top-level comment box keeps its draft in this browser. */
export const commentDraftKey = (issueKey: string) =>
  `better-jira:comment-draft:${get().namespace}:${issueKey}`;

/** Puts a refused comment back into the saved draft at `draftKey`, after anything typed since, and returns it. */
export function restoreRejectedDraft(draftKey: string, body: AdfDocument): AdfDocument {
  let draft = normalizeDocument("");
  try {
    draft = normalizeDocument(JSON.parse(localStorage.getItem(draftKey) ?? '""'));
  } catch {}
  const merged =
    adfToText(draft).trim() || documentHasMedia(draft)
      ? { ...draft, content: [...(draft.content ?? []), ...(body.content ?? [])] }
      : body;
  try {
    localStorage.setItem(draftKey, JSON.stringify(merged));
  } catch {}
  return merged;
}

/** Hands a refused comment to the open composer that `take`s it; otherwise stores it in the issue's comment draft. */
export function returnRejectedComment(detail: RejectedComment) {
  const event = new CustomEvent(REJECTED, { detail, cancelable: true });
  if (dispatchEvent(event)) restoreRejectedDraft(commentDraftKey(detail.key), detail.body);
}

/** A composer offers to take refused comments: `take` returns true for one it now holds. Returns the unsubscribe. */
export function onRejectedComment(take: (comment: RejectedComment) => boolean) {
  const listen = (event: Event) => {
    if (take((event as CustomEvent<RejectedComment>).detail)) event.preventDefault();
  };
  addEventListener(REJECTED, listen);
  return () => removeEventListener(REJECTED, listen);
}
