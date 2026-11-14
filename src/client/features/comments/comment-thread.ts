import type { CommentState } from "@/shared/issue-model";
import type { AdfDocument, AdfNode } from "@/shared/document";
export type IssueComment = {
  id: string;
  parentId?: string;
  orphanedFrom?: string;
  body: AdfDocument;
  created: string;
  updated?: string;
  author?: { accountId: string; displayName: string; avatarUrls?: Record<string, string> };
};
export function visibleComments(
  comments: IssueComment[],
  states: Record<string, CommentState> = {},
) {
  const byId = new Map(comments.map((c) => [c.id, c]));
  // Jira keeps the replies of a deleted comment under its id; they stay one thread, led by the first.
  const orphans = new Map<string, string>();
  return comments.flatMap((comment) => {
    let root = comment;
    const visited = new Set<string>();
    while (true) {
      if (states[root.id]?.deleted) return [];
      visited.add(root.id);
      // A parent deleted here reads as one Jira already deleted, so its replies move to the orphan thread at once.
      const parent =
        root.parentId && !states[root.parentId]?.deleted ? byId.get(root.parentId) : undefined;
      if (!parent) break;
      // A malformed cycle has no root. Recover its comments rather than losing them.
      if (visited.has(parent.id)) {
        root = comment;
        break;
      }
      root = parent;
    }
    let lead = root.id;
    if (root.parentId) {
      lead = orphans.get(root.parentId) ?? root.id;
      orphans.set(root.parentId, lead);
    }
    const state = states[comment.id];
    return [
      {
        ...comment,
        parentId: lead === comment.id ? undefined : lead,
        orphanedFrom: lead === comment.id ? root.parentId : undefined,
        ...(state?.body ? { body: state.body, updated: state.updated } : {}),
      },
    ];
  });
}
export function visibleCommentTotal(
  total: number,
  comments: IssueComment[],
  states: Record<string, CommentState> = {},
) {
  return Math.max(0, total - comments.length + visibleComments(comments, states).length);
}
export function validCommentStates(
  value: unknown,
  document?: (value: unknown) => boolean,
): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (s) =>
      s &&
      typeof s === "object" &&
      ["resolved", "subscribed", "deleted"].every(
        (k) => s[k] === undefined || typeof s[k] === "boolean",
      ) &&
      (s.reactions === undefined ||
        (Array.isArray(s.reactions) && s.reactions.every((r: unknown) => typeof r === "string"))) &&
      (s.updated === undefined || typeof s.updated === "string") &&
      (s.body === undefined ||
        (s.body?.type === "doc" &&
          Array.isArray(s.body.content) &&
          (!document || document(s.body)))),
  );
}

/**
 * The comment a reply to `id` is filed under in Jira. Jira threads are one level deep (it rejects a
 * reply whose parent is itself a reply), so replying to a reply joins its thread, as in Jira's and
 * Linear's own UI. A thread whose first comment was deleted stays under the deleted comment's id.
 */
export function replyParent(
  comments: IssueComment[],
  id: string,
  states: Record<string, CommentState> = {},
) {
  const visible = visibleComments(comments, states),
    comment = visible.find((c) => c.id === id),
    root = comment?.parentId ? visible.find((c) => c.id === comment.parentId) : comment;
  return root && (root.orphanedFrom ?? root.id);
}

/** Starts a reply to someone's reply with an @mention of them, as Jira's Reply button does. The mention goes where the
 *  caret will be: Linear's Reply to comment focuses the reply box at its end (`focusAtEnd`), so with a saved draft the
 *  mention follows it and what is typed next follows the mention (R3-comments-D5). */
export function mentionDraft(draft: AdfDocument, author?: IssueComment["author"]): AdfDocument {
  const mentions = (n: AdfNode): boolean =>
    (n.type === "mention" && n.attrs?.id === author?.accountId) || !!n.content?.some(mentions);
  if (!author || mentions(draft)) return draft;
  const mention: AdfNode[] = [
      {
        type: "mention",
        attrs: { id: author.accountId, text: `@${author.displayName}`, accessLevel: "" },
      },
      { type: "text", text: " " },
    ],
    blocks = draft.content ?? [],
    last = blocks.at(-1);
  if (last?.type !== "paragraph")
    return { ...draft, content: [...blocks, { type: "paragraph", content: mention }] };
  const inline = last.content ?? [],
    end = inline.at(-1),
    spaced = !end || (end.type === "text" && /\s$/.test(end.text ?? "")) || end.type === "hardBreak";
  return {
    ...draft,
    content: [
      ...blocks.slice(0, -1),
      { ...last, content: [...inline, ...(spaced ? [] : [{ type: "text", text: " " }]), ...mention] },
    ],
  };
}
