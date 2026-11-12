/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { Debouncer } from "@tanstack/pacer";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf } from "./adf";
import { normalizeDocument, type AdfDocument } from "./document";
import { resourceMediaIds } from "./issue-resource";
import { adfToMarkdown } from "./issue-copy";
import { Icon } from "./icons";
import { IconButton } from "./button";
import { ConfirmDialog } from "./dialog";
import { Text } from "./text";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { ReactionPicker, shortcode } from "./reactions";
import { FramedEditor, CommentComposer } from "./rich-editor-loader";
import {
  ME,
  actions,
  addIssueFiles,
  addLocalFiles,
  beginCreate,
  currentKey,
  get,
  REJECTED_COMMENT,
  restoreRejectedDraft,
  set,
  type Issue,
  type RejectedComment,
} from "./store";
import { readStored, writeStored } from "./stored-state";
import { noteDraftUploads, settleDraftUploads } from "./draft-uploads";
import { mentionDraft, visibleComments, type IssueComment } from "./comment-thread";

/**
 * Files a comment draft uploaded leave the issue again once the draft drops them, so a discarded upload is not left
 * attached in Jira (R1-D17). The 5 s wait lets the editor's undo bring a file back first.
 * A file dropped just before leaving the issue, or cut off by a reload, is removed on a later load (draft-uploads.ts).
 */
export function useDraftFiles(key: string) {
  const uploaded = useRef(new Set<string>()),
    draft = useRef<AdfDocument | undefined>(undefined);
  const sweep = useMemo(() => {
    const run = (body = draft.current) => {
      const kept = resourceMediaIds(body),
        gone = [...uploaded.current].filter((id) => !kept.has(id));
      for (const id of gone) uploaded.current.delete(id);
      if (gone.length) actions.dropDraftFiles(key, gone);
    };
    return { run, later: new Debouncer(() => run(), { wait: 5000 }) };
  }, [key]);
  // Leaving the issue only cancels: an upload may still be on its way into the saved draft.
  useEffect(() => () => sweep.later.cancel(), [sweep]);
  return {
    onFiles: async (files: File[]) => {
      const namespace = get().namespace,
        noted = get().writable ? noteDraftUploads(namespace, key, files) : [];
      let saved: Awaited<ReturnType<typeof addIssueFiles>> = [];
      try {
        saved = await addIssueFiles(key, files, noted);
      } finally {
        settleDraftUploads(
          namespace,
          noted,
          saved.map((file) => file.id),
        );
      }
      for (const file of saved) uploaded.current.add(file.id);
      return saved;
    },
    changed: (body: AdfDocument) => {
      draft.current = body;
      sweep.later.maybeExecute();
    },
    /** The sent body keeps its files; the rest go now. */
    sent: (body: AdfDocument) => {
      sweep.later.cancel();
      sweep.run(body);
      uploaded.current.clear();
      draft.current = undefined;
    },
  };
}

/** A comment Jira refused comes back into the composer that sent it, after anything typed since (R2-comments-D4). */
export function useRejectedComment(
  key: string,
  parents: (string | undefined)[],
  draftKey: string,
  restore: (body: AdfDocument) => void,
) {
  const latest = useRef(restore);
  latest.current = restore;
  const ids = parents.join(",");
  useEffect(() => {
    const listen = (event: Event) => {
      const { detail } = event as CustomEvent<RejectedComment>;
      if (currentKey(detail.key) !== currentKey(key) || !parents.includes(detail.parentId)) return;
      event.preventDefault();
      latest.current(restoreRejectedDraft(draftKey, detail.body));
    };
    addEventListener(REJECTED_COMMENT, listen);
    return () => removeEventListener(REJECTED_COMMENT, listen);
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- The joined parent IDs track membership without reattaching for each new array identity.
  }, [key, ids, draftKey]);
}

/** A comment composer's draft, kept per browser under `key` so a reload or a refused send never loses it. Writes don't re-render. */
export function commentDraft(key: string) {
  const read = () => readStored(key, normalizeDocument, normalizeDocument(""));
  return {
    read,
    save: (body: AdfDocument) => void writeStored(key, body),
    /** Applies a change to the stored draft, such as an upload that finished after the composer closed. */
    update: (change: (body: AdfDocument) => AdfDocument) => void writeStored(key, change(read())),
    clear: () => void writeStored(key, undefined),
  };
}

/** The issue's comment box: its stored draft and the composer generation. Sending starts an empty composer; a comment Jira
 *  refused starts one holding it, after anything typed since (R2-comments-D4). Both keep the caret in the box. */
export function useCommentDraft(issueKey: string) {
  const key = `better-jira:comment-draft:${get().namespace}:${issueKey}`,
    draft = commentDraft(key);
  const [composer, setComposer] = useState(() => ({
    generation: 0,
    initial: draft.read() as AdfDocument | "",
  }));
  useRejectedComment(issueKey, [undefined], key, (body) =>
    setComposer((c) => ({ generation: c.generation + 1, initial: body })),
  );
  return {
    key: composer.generation,
    initial: composer.initial,
    autoFocus: composer.generation > 0,
    save: draft.save,
    update: draft.update,
    sent: () => {
      draft.clear();
      setComposer((c) => ({ generation: c.generation + 1, initial: "" }));
    },
  };
}

type Props = {
  issue: Issue;
  comments: IssueComment[];
  avatar: (comment: IssueComment) => ReactNode;
  me: ReactNode;
  timestamp: (date: string, id: string) => ReactNode;
  events?: { at: string; node: ReactNode }[];
  /** Keeps the text of an open edit; `null` when the edit closes. */
  trackEdit?: (id: string, body: AdfDocument | null) => void;
};
export function CommentThreads(props: Props) {
  const comments = visibleComments(props.comments, props.issue.commentStates);
  const key = props.issue.key;
  // An edit open on a comment deleted elsewhere keeps its text here, with a note, instead of vanishing (R2-comments-D4).
  const edits = useRef(new Map<string, AdfDocument>()),
    [lost, setLost] = useState<{ key: string; id: string; body: AdfDocument }[]>([]);
  const present = props.comments.map((c) => c.id).join(",");
  useEffect(() => {
    const ids = new Set(present.split(","));
    const gone = [...edits.current].filter(([id]) => !ids.has(id));
    for (const [id] of gone) edits.current.delete(id);
    if (gone.length) setLost((list) => [...list, ...gone.map(([id, body]) => ({ key, id, body }))]);
  }, [present, key]);
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Leaving an issue clears its tracked comment edits.
  useEffect(() => () => edits.current.clear(), [key]);
  const trackEdit = (id: string, body: AdfDocument | null) =>
    body ? edits.current.set(id, body) : edits.current.delete(id);
  const drop = (id: string) => setLost((list) => list.filter((l) => l.id !== id));
  const kept = lost
    .filter((l) => l.key === key)
    .map(({ id, body }) => (
      <li key={`lost-${id}`} className="comment-thread" data-lost-edit={id}>
        <Text as="p" role="alert" variant="mini" color="muted" className="px-3 pt-2">
          This comment was deleted in Jira while you were editing it. Your text is kept here.
        </Text>
        <FramedEditor
          id={`lost-${id}`}
          label="Unsaved comment edit"
          initial={body}
          issueKey={key}
          attachments={props.issue.attachments}
          saveLabel="Post as new comment"
          onSave={(doc) => {
            if (actions.comment(key, doc)) drop(id);
          }}
          onCancel={() => drop(id)}
        />
      </li>
    ));
  const threads = comments
    .filter((c) => !c.parentId)
    .map((root) => ({
      at: root.created,
      node: (
        <Thread
          key={root.id}
          {...props}
          trackEdit={trackEdit}
          root={root}
          replies={comments.filter((c) => c.parentId === root.id)}
        />
      ),
    }));
  // Property history interleaves with threads by time, as in Linear's Activity.
  return [
    ...[...threads, ...(props.events ?? [])]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .map((item) => item.node),
    ...kept,
  ];
}
function Thread({
  issue,
  root,
  replies,
  avatar,
  me,
  timestamp,
  trackEdit = () => {},
}: Props & { root: IssueComment; replies: IssueComment[] }) {
  const state = issue.commentStates?.[root.id] ?? {};
  const [expanded, setExpanded] = useState(() =>
    [root, ...replies].some((c) => location.hash === `#comment-${c.id}`),
  );
  const [replying, setReplying] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [composer, setComposer] = useState(0);
  const replyFiles = useDraftFiles(issue.key),
    editFiles = useDraftFiles(issue.key);
  const [deleting, setDeleting] = useState<string | null>(null),
    [menu, setMenu] = useState<{
      anchor: HTMLElement;
      comment: IssueComment;
      point?: { x: number; y: number };
    } | null>(null),
    [reaction, setReaction] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const draftKey = `better-jira:reply-draft:${get().namespace}:${issue.key}:${root.id}`,
    reply = commentDraft(draftKey);
  const restoreFocus = (id = root.id) =>
    requestAnimationFrame(() => {
      const thread = document.querySelector<HTMLElement>(`[data-thread="${CSS.escape(root.id)}"]`);
      const target =
        document.querySelector<HTMLElement>(
          `[data-comment="${CSS.escape(id)}"] button[aria-label$="options"]`,
        ) ??
        thread?.querySelector<HTMLElement>(
          '[aria-label="Expand thread"], [aria-label="Comment options"]',
        ) ??
        document.getElementById("comment");
      target?.focus();
    });
  const hashTargets = [root, ...replies].map((c) => `comment-${c.id}`).join(",");
  useEffect(() => {
    const reveal = () => {
      if (hashTargets.split(",").includes(location.hash.slice(1))) {
        setExpanded(true);
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "center" }),
          ),
        );
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [hashTargets]);
  const cancelReply = () => {
    setReplying(false);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(
          `[data-thread="${CSS.escape(root.id)}"] [aria-label="Reply to thread"]`,
        )
        ?.focus(),
    );
  };
  // Replies are one level deep, as in Jira and Linear: replying to a reply joins this thread and mentions its author.
  const replyTo = (comment: IssueComment) => {
    if (comment.parentId && comment.author?.accountId !== ME.id)
      reply.update((draft) => mentionDraft(draft, comment.author));
    setComposer((n) => n + 1);
    setReplying(true);
  };
  const attachReply = () => {
    setReplying(true);
    let frames = 0;
    const choose = () => {
      const input = document
        .getElementById(`reply-${root.id}`)
        ?.closest(".rich-editor")
        ?.querySelector<HTMLInputElement>("input[type=file]");
      if (input) input.click();
      else if (frames++ < 60) requestAnimationFrame(choose);
    };
    requestAnimationFrame(choose);
  };
  useRejectedComment(
    issue.key,
    root.orphanedFrom ? [root.id, root.orphanedFrom] : [root.id],
    draftKey,
    () => {
      setComposer((n) => n + 1);
      setReplying(true);
    },
  );
  const toggleReaction = (id: string, emoji: string) => {
    const reactions = issue.commentStates?.[id]?.reactions ?? [];
    actions.commentState(issue.key, id, {
      reactions: reactions.includes(emoji)
        ? reactions.filter((r) => r !== emoji)
        : [...reactions, emoji],
    });
  };
  const copy = async (kind: "link" | "markdown", comment: IssueComment) => {
    try {
      const url = new URL(location.href);
      url.hash = `comment-${comment.id}`;
      const text =
        kind === "link"
          ? url.href
          : !comment.parentId && replies.length
            ? // A thread names each author first, as Linear's "Copy thread as Markdown" does.
              [comment, ...replies]
                .map((c) => `**${c.author?.displayName ?? "Unknown"}:**\n${adfToMarkdown(c.body)}`)
                .join("\n\n")
            : adfToMarkdown(comment.body);
      await navigator.clipboard.writeText(text);
      set({ perf: kind === "link" ? "Copied comment link" : "Copied comment as Markdown" });
    } catch {
      set({ perf: "Could not copy comment" });
    }
  };
  const [copyError, setCopyError] = useState(""),
    [preparing, setPreparing] = useState(false);
  const createFromComment = async (comment: IssueComment, parent = false) => {
    setMenu(null);
    setPreparing(true);
    setCopyError("");
    try {
      const { copyCommentDocument } = await import("./comment-copy");
      const copied = await copyCommentDocument(
        comment.body,
        issue.key,
        issue.attachments ?? [],
        addLocalFiles,
      );
      if (get().selected === issue.key && get().panel)
        beginCreate({
          descriptionDoc: copied.body,
          attachments: copied.attachments,
          ...(parent ? { parent: issue.key, project: issue.project } : {}),
        });
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : "Could not prepare the comment");
    } finally {
      setPreparing(false);
    }
  };
  const rows = [root, ...replies];
  const render = (comment: IssueComment) => {
    const reactions = issue.commentStates?.[comment.id]?.reactions ?? [];
    return (
      <div
        key={comment.id}
        id={`comment-${comment.id}`}
        data-comment={comment.id}
        className={`comment-message ${comment.parentId ? "comment-reply" : ""}`}
        onContextMenu={(event) => {
          if (editing === comment.id) return;
          const button = event.currentTarget.querySelector<HTMLElement>(
            'button[aria-label$="options"]',
          );
          if (!button) return;
          event.preventDefault();
          setMenu({
            anchor: button,
            comment,
            point: { x: event.clientX + 2, y: event.clientY + 4 },
          });
        }}
      >
        <div className="comment-head">
          {avatar(comment)}
          <span className="font-medium text-fg">{comment.author?.displayName}</span>
          {timestamp(comment.created, `comment-${comment.id}`)}
          {comment.updated &&
            (!!issue.commentStates?.[comment.id]?.body ||
              Date.parse(comment.updated) - Date.parse(comment.created) >= 1000) && (
              <span>· edited</span>
            )}
          {/* Linear's comment actions are medium IconButtons; `comment-hover-action` only reveals them on hover or focus. */}
          <span className="ml-auto flex">
            <IconButton
              label="Add reaction"
              aria-expanded={reaction?.id === comment.id}
              className="comment-hover-action"
              onClick={(e) => setReaction({ anchor: e.currentTarget, id: comment.id })}
            >
              <Icon name="smile" />
            </IconButton>
            <IconButton label="Reply to comment" className="comment-hover-action" onClick={() => replyTo(comment)}>
              <Icon name="undo" />
            </IconButton>
            <IconButton
              label={comment.parentId ? "Reply options" : "Comment options"}
              tooltip="Comment options"
              aria-expanded={menu?.comment.id === comment.id}
              className="comment-hover-action"
              onClick={(e) => setMenu({ anchor: e.currentTarget, comment })}
            >
              <Icon name="dots" />
            </IconButton>
          </span>
        </div>
        <div className="comment-body">
          {editing === comment.id ? (
            <FramedEditor
              id={`edit-${comment.id}`}
              label="Edit comment"
              autoFocus
              required
              initial={comment.body}
              issueKey={issue.key}
              attachments={issue.attachments}
              onFiles={editFiles.onFiles}
              onChange={(body) => {
                editFiles.changed(body);
                trackEdit(comment.id, body);
              }}
              saveLabel="Save comment"
              onSave={(body) => {
                trackEdit(comment.id, null);
                editFiles.sent(body);
                actions.editComment(issue.key, comment.id, body);
                setEditing(null);
                restoreFocus(comment.id);
              }}
              onCancel={() => {
                trackEdit(comment.id, null);
                editFiles.sent(comment.body);
                setEditing(null);
                restoreFocus(comment.id);
              }}
            />
          ) : (
            <Adf node={comment.body} issueKey={issue.key} attachments={issue.attachments} />
          )}
        </div>
        {/* Reaction pills are Linear's own emoji-count chip; no primitive draws them. */}
        {!!reactions.length && (
          <div className="mt-2 flex gap-2">
            {reactions.map((emoji) => (
              <button
                key={emoji}
                aria-label={`Remove ${emoji} reaction`}
                aria-pressed="true"
                title={`You reacted with :${shortcode(emoji)}:`}
                onClick={() => toggleReaction(comment.id, emoji)}
                className="reaction-pill"
              >
                <span>{emoji}</span>
                <span>1</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  return (
    <li
      data-thread={root.id}
      id={state.resolved && !expanded ? `comment-${root.id}` : undefined}
      className="comment-thread rounded-lg bg-card"
    >
      {/* Full-width disclosure rows: no primitive covers a thread's expand and collapse rows. */}
      {state.resolved && !expanded ? (
        <button
          aria-label="Expand thread"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12px] text-fg-3"
          onClick={() => setExpanded(true)}
        >
          <Icon name="check" size={14} />
          {rows.length} resolved {rows.length === 1 ? "comment" : "comments"} from{" "}
          {root.author?.displayName}
          <span className="ml-auto">Expand thread</span>
        </button>
      ) : (
        <>
          {state.resolved && (
            <button
              aria-label="Collapse thread"
              className="w-full px-3 pt-2 text-right text-[12px] text-fg-3"
              onClick={() => setExpanded(false)}
            >
              Collapse thread
            </button>
          )}
          {root.orphanedFrom && (
            <Text as="p" variant="mini" color="muted" className="px-3 pt-2">
              Original comment removed
            </Text>
          )}
          {rows.map(render)}
          {
            <div className="comment-reply-composer">
              {replying ? (
                <CommentComposer
                  key={composer}
                  id={`reply-${root.id}`}
                  scope={`${issue.key}:reply:${root.id}`}
                  onLateMedia={reply.update}
                  label="Reply to thread"
                  placeholder="Reply…"
                  autoFocus
                  initial={reply.read()}
                  issueKey={issue.key}
                  attachments={issue.attachments}
                  onFiles={replyFiles.onFiles}
                  saveLabel="Submit reply"
                  onChange={(body) => {
                    replyFiles.changed(body);
                    reply.save(body);
                  }}
                  onSave={(body) => {
                    if (actions.comment(issue.key, body, root.id)) {
                      replyFiles.sent(body);
                      reply.clear();
                      // A fresh, empty reply editor keeps the focus, as in Linear.
                      setComposer((n) => n + 1);
                    }
                  }}
                  onCancel={cancelReply}
                />
              ) : (
                // The closed composer stands in for the open one, so its attach and send wear the composer's tooltips. Send stays
                // enabled: with nothing to send yet, it opens the composer (RAJ-52, e2e/threads.pw.ts).
                <div className="comment-reply-row">
                  {me}
                  <button
                    aria-label="Reply to thread"
                    className="comment-reply-open"
                    onClick={() => setReplying(true)}
                  >
                    Leave a reply…
                  </button>
                  <IconButton
                    label="Attach to reply"
                    tooltip="Attach images, files, or videos"
                    size="small"
                    className="mr-[3px]"
                    onClick={attachReply}
                  >
                    <Icon name="paperclip" />
                  </IconButton>
                  {/* Linear's filled send circle has no Jx variant; `comment-reply-send` paints it, as rich-editor-submit does. */}
                  <IconButton
                    label="Submit reply"
                    tooltip="Submit comment"
                    shortcut="⌘↵"
                    size="small"
                    className="comment-reply-send"
                    onClick={() => setReplying(true)}
                  >
                    <Icon name="up" />
                  </IconButton>
                </div>
              )}
            </div>
          }
        </>
      )}
      {preparing && (
        <Text as="p" role="status" variant="mini" color="muted" className="px-3 py-2">
          Copying comment attachments…
        </Text>
      )}
      {copyError && (
        <Text as="p" role="alert" variant="mini" color="inherit" className="px-3 py-2">
          {copyError}
        </Text>
      )}
      {reaction && (
        <ReactionPicker
          anchor={reaction.anchor}
          close={() => setReaction(null)}
          choose={(emoji) => toggleReaction(reaction.id, emoji)}
        />
      )}
      {menu &&
        (() => {
          const comment = menu.comment,
            mine = comment.author?.accountId === ME.id;
          // Linear's comment menu groups and icons (RAJ-52, 2026-11-07).
          const entries: ActionEntry[] = [
            ...(mine
              ? [
                  {
                    name: "Edit",
                    icon: "pencil" as const,
                    run: () => {
                      setEditing(comment.id);
                      trackEdit(comment.id, comment.body);
                    },
                  },
                ]
              : []),
            {
              name: state.subscribed === false ? "Subscribe to thread" : "Unsubscribe from thread",
              icon: "bell",
              run: () =>
                actions.commentState(issue.key, root.id, {
                  subscribed: state.subscribed === false,
                }),
            },
            {
              name: state.resolved
                ? "Reopen thread"
                : comment.parentId
                  ? "Resolve thread with comment"
                  : "Resolve thread",
              icon: "check",
              divider: true,
              run: () => {
                actions.commentState(issue.key, root.id, { resolved: !state.resolved });
                setExpanded(false);
                restoreFocus();
              },
            },
            {
              name: "Copy link to comment",
              icon: "link",
              divider: true,
              run: () => void copy("link", comment),
            },
            {
              name:
                !comment.parentId && replies.length
                  ? "Copy thread as Markdown"
                  : "Copy content as Markdown",
              icon: "copy",
              run: () => void copy("markdown", comment),
            },
            {
              name: "New issue from comment…",
              icon: "plus",
              divider: true,
              run: () => void createFromComment(comment),
            },
            {
              name: "New sub-issue from comment…",
              icon: "plus",
              run: () => void createFromComment(comment, true),
            },
            ...(mine
              ? [
                  {
                    name: "Delete",
                    icon: "trash" as const,
                    divider: true,
                    run: () => setDeleting(comment.id),
                  },
                ]
              : []),
          ];
          return (
            <ActionMenu
              label="Comment options"
              anchor={menu.anchor}
              point={menu.point}
              align="end"
              entries={entries}
              close={() => setMenu(null)}
            />
          );
        })()}
      {deleting && (
        <ConfirmDialog
          title="Delete this comment?"
          description="You cannot undo this action."
          confirmLabel="Delete"
          onConfirm={() => {
            trackEdit(deleting, null);
            actions.deleteComment(issue.key, deleting);
            setDeleting(null);
          }}
          close={() => setDeleting(null)}
        />
      )}
    </li>
  );
}
