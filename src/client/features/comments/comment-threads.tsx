import { loadable } from "@/client/lib/loadable";
import { newSubIssueDraft } from "@/client/features/issue/sub-issue-draft";
import { canHaveSubIssues } from "@/shared/issue-properties";

import { type Issue } from "@/shared/issue-model";
import type { Attachment } from "@/shared/attachment-media";
import { pageURL } from "@/client/features/navigation/app-navigation";
/* oxlint-disable react/memo-dependencies -- Memo keys describe semantic invalidation; render-local adapters are intentionally excluded. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { Debouncer } from "@tanstack/pacer";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf } from "@/client/features/editor/adf";
import { normalizeDocument, type AdfDocument } from "@/shared/document";
import { resourceMediaIds } from "@/shared/issue-resource";
import { adfToMarkdown } from "@/client/features/issue/issue-copy";
import { COPY_FAILED, showNotification } from "@/client/state/app-notifications";
import { Icon } from "@/client/components/icons";
import { IconButton, SendButton } from "@/client/components/button";
import { ConfirmDialog } from "@/client/components/dialog";
import { Text } from "@/client/components/text";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { ReactionPicker, ReactionPill } from "./reactions";
import { CommentEditEditor, FramedEditor, CommentComposer } from "@/client/features/editor/rich-editor-loader";
import { ME, get, set } from "@/client/state/store";
import { actions, beginCreate, keepIssueFiles, uploadIssueFile } from "@/client/state/issue-actions";
import { currentKey } from "@/client/state/jira-sync";
import { addLocalFiles } from "@/client/state/local-database";
import { commentDraftKey, onRejectedComment, restoreRejectedDraft } from "./rejected-comment";
import { readStored, writeStored } from "@/client/state/stored-state";
import { mentionDraft, visibleComments, type IssueComment } from "./comment-thread";
import { useAnchorHighlight, useLocationAnchor } from "./anchor-highlight";
import { copyText } from "@/client/lib/clipboard";

/** Copying a comment into a new issue; fetched by the idle walk. */
const commentCopy = loadable("comment-copy", () => import("./comment-copy"), 100);

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
    onFiles: keepIssueFiles,
    onUpload: async (file: Attachment, picked: File) => {
      await uploadIssueFile(key, file, picked);
      uploaded.current.add(file.id);
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
    return onRejectedComment((detail) => {
      if (currentKey(detail.key) !== currentKey(key) || !parents.includes(detail.parentId)) return false;
      latest.current(restoreRejectedDraft(draftKey, detail.body));
      return true;
    });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- The joined parent IDs track membership without reattaching for each new array identity.
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
  const key = commentDraftKey(issueKey),
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

/** An Activity entry that is not a comment thread, at its time. */
export type TimelineEvent = { at: string; node: ReactNode };
/** Where a run of entries sits among the threads, and when the thread after it starts. */
export type RunPlace = { position: "only" | "first" | "last" | "middle"; nextThread?: string };
type Props<E extends TimelineEvent = TimelineEvent> = {
  issue: Issue;
  comments: IssueComment[];
  avatar: (comment: IssueComment) => ReactNode;
  me: ReactNode;
  timestamp: (date: string, id: string) => ReactNode;
  events?: E[];
  /** Renders each run of events between threads (Linear folds a long one); by default every event as it is. */
  run?: (events: E[], place: RunPlace) => ReactNode;
  /** Keeps the text of an open edit; `null` when the edit closes. */
  trackEdit?: (id: string, body: AdfDocument | null) => void;
};
export function CommentThreads<E extends TimelineEvent>(props: Props<E>) {
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
  const { events: _events, run: _run, ...threadProps } = props;
  const threads = comments
    .filter((c) => !c.parentId)
    .map((root) => ({
      at: root.created,
      node: (
        <Thread
          key={root.id}
          {...threadProps}
          trackEdit={trackEdit}
          root={root}
          replies={comments.filter((c) => c.parentId === root.id)}
        />
      ),
    }));
  // Property history interleaves with threads by time, as in Linear's Activity; each run between threads renders together.
  const timeline = [
    ...threads.map((thread) => ({ ...thread, thread: true as const })),
    ...(props.events ?? []).map((event) => ({ at: event.at, event })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const nodes: ReactNode[] = [];
  let run: E[] = [];
  const close = (nextThread?: string) => {
    if (!run.length) return;
    const first = nodes.length === 0,
      last = nextThread === undefined;
    const position = first ? (last ? "only" : "first") : last ? "last" : "middle";
    nodes.push(props.run ? props.run(run, { position, nextThread }) : run.map((event) => event.node));
    run = [];
  };
  for (const item of timeline) {
    if ("event" in item) run.push(item.event);
    else {
      close(item.at);
      nodes.push(item.node);
    }
  }
  close();
  return [...nodes, ...kept];
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
  const { hash, entry } = useLocationAnchor();
  const linked = [root, ...replies].find((c) => hash === `comment-${c.id}`);
  const [expanded, setExpanded] = useState(!!linked);
  // A link to one of its comments opens a resolved thread before the comment rings (adjusting state while rendering, so the
  // highlight's layout effect finds the comment, not the collapsed row).
  const [opened, setOpened] = useState(linked ? `${hash}@${entry}` : "");
  if (linked && opened !== `${hash}@${entry}`) {
    setOpened(`${hash}@${entry}`);
    setExpanded(true);
  }
  const highlight = useAnchorHighlight(linked ? `comment-${linked.id}` : "");
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
      const url = pageURL(`comment-${comment.id}`);
      const text =
        kind === "link"
          ? url
          : !comment.parentId && replies.length
            ? // A thread names each author first, as Linear's "Copy thread as Markdown" does.
              [comment, ...replies]
                .map((c) => `**${c.author?.displayName ?? "Unknown"}:**\n${adfToMarkdown(c.body)}`)
                .join("\n\n")
            : adfToMarkdown(comment.body);
      await copyText(text);
      set({ perf: kind === "link" ? "Copied comment link" : "Copied comment as Markdown" });
    } catch {
      showNotification(COPY_FAILED);
    }
  };
  const [copyError, setCopyError] = useState(""),
    [preparing, setPreparing] = useState(false);
  const createFromComment = async (comment: IssueComment, parent = false) => {
    setMenu(null);
    setPreparing(true);
    setCopyError("");
    try {
      const { copyCommentDocument } = await commentCopy.load();
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
          ...(parent ? newSubIssueDraft(issue) : {}),
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
        data-comment-parent={comment.parentId}
        data-highlight={linked?.id === comment.id ? highlight : undefined}
        className={`comment-message anchor-highlight ${comment.parentId ? "comment-reply" : ""}`}
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
            // Linear's comment menu sits +2,+4 from the pointer; MenuSurface adds its +4,−1.
            point: { x: event.clientX - 2, y: event.clientY + 5 },
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
              appearance="comment-action"
              className="comment-hover-action"
              onClick={(e) => setReaction({ anchor: e.currentTarget, id: comment.id })}
            >
              <Icon name="smile" />
            </IconButton>
            <IconButton
              label="Reply to comment"
              appearance="comment-action"
              className="comment-hover-action"
              onClick={() => replyTo(comment)}
            >
              <Icon name="undo" />
            </IconButton>
            <IconButton
              label={comment.parentId ? "Reply options" : "Comment options"}
              tooltip="Comment options"
              aria-expanded={menu?.comment.id === comment.id}
              appearance="comment-action"
              className="comment-hover-action"
              onClick={(e) => setMenu({ anchor: e.currentTarget, comment })}
            >
              <Icon name="dots" />
            </IconButton>
          </span>
        </div>
        <div className="comment-body">
          {editing === comment.id ? (
            <CommentEditEditor
              id={`edit-${comment.id}`}
              label="Edit comment"
              autoFocus
              required
              initial={comment.body}
              issueKey={issue.key}
              attachments={issue.attachments}
              onFiles={editFiles.onFiles}
              onUpload={editFiles.onUpload}
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
        {!!reactions.length && (
          <div className="mt-2 flex gap-2">
            {reactions.map((emoji) => (
              <ReactionPill key={emoji} emoji={emoji} onRemove={() => toggleReaction(comment.id, emoji)} />
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
                  onUpload={replyFiles.onUpload}
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
                // enabled: with nothing to send yet, it opens the composer (RAJ-52).
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
                  <SendButton label="Submit reply" tooltip="Submit comment" onClick={() => setReplying(true)} />
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
            // On an epic, the sub-issue joins the epic as its Epic (subIssueParent, BJ-280); an initiative offers none.
            ...(canHaveSubIssues(get(), issue)
              ? [
                  {
                    name: "New sub-issue from comment…",
                    icon: "plus" as const,
                    run: () => void createFromComment(comment, true),
                  },
                ]
              : []),
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
