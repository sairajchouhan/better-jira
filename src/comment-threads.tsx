import { useEffect, useState, type ReactNode } from "react";
import { Adf } from "./adf";
import { normalizeDocument } from "./document";
import { adfToMarkdown } from "./issue-copy";
import { Icon } from "./icons";
import { Confirm } from "./menu-surface";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { ReactionPicker, shortcode } from "./reactions";
import { RichEditor } from "./rich-editor-loader";
import {
  ME,
  actions,
  addIssueFiles,
  addLocalFiles,
  beginCreate,
  get,
  set,
  type Issue,
} from "./store";
import { mentionDraft, visibleComments, type IssueComment } from "./comment-thread";

type Props = {
  issue: Issue;
  comments: IssueComment[];
  avatar: (comment: IssueComment) => ReactNode;
  me: ReactNode;
  timestamp: (date: string, id: string) => ReactNode;
  events?: { at: string; node: ReactNode }[];
};
export function CommentThreads(props: Props) {
  const comments = visibleComments(props.comments, props.issue.commentStates);
  const threads = comments
    .filter((c) => !c.parentId)
    .map((root) => ({
      at: root.created,
      node: (
        <Thread
          key={root.id}
          {...props}
          root={root}
          replies={comments.filter((c) => c.parentId === root.id)}
        />
      ),
    }));
  // Property history interleaves with threads by time, as in Linear's Activity.
  return [...threads, ...(props.events ?? [])]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .map((item) => item.node);
}
function Thread({
  issue,
  root,
  replies,
  avatar,
  me,
  timestamp,
}: Props & { root: IssueComment; replies: IssueComment[] }) {
  const state = issue.commentStates?.[root.id] ?? {};
  const [expanded, setExpanded] = useState(() =>
    [root, ...replies].some((c) => location.hash === `#comment-${c.id}`),
  );
  const [replying, setReplying] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [composer, setComposer] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null),
    [menu, setMenu] = useState<{
      anchor: HTMLElement;
      comment: IssueComment;
      point?: { x: number; y: number };
    } | null>(null),
    [reaction, setReaction] = useState<{ anchor: HTMLElement; id: string } | null>(null);
  const draftKey = `better-jira:reply-draft:${get().namespace}:${issue.key}:${root.id}`;
  const draft = () => {
    try {
      return normalizeDocument(JSON.parse(localStorage.getItem(draftKey) ?? '""'));
    } catch {
      return normalizeDocument("");
    }
  };
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
      try {
        localStorage.setItem(draftKey, JSON.stringify(mentionDraft(draft(), comment.author)));
      } catch {}
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
          : [comment, ...(!comment.parentId ? replies : [])]
              .map((c) => adfToMarkdown(c.body))
              .join("\n\n");
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
          <span className="ml-auto flex">
            <button
              aria-label="Add reaction"
              title="Add reaction"
              aria-expanded={reaction?.id === comment.id}
              className="comment-hover-action"
              onClick={(e) => setReaction({ anchor: e.currentTarget, id: comment.id })}
            >
              <Icon name="smile" size={14} />
            </button>
            <button
              aria-label="Reply to comment"
              title="Reply"
              className="comment-hover-action"
              onClick={() => replyTo(comment)}
            >
              <Icon name="undo" size={14} />
            </button>
            <button
              aria-label={comment.parentId ? "Reply options" : "Comment options"}
              title="Comment options"
              aria-expanded={menu?.comment.id === comment.id}
              className="comment-hover-action"
              onClick={(e) => setMenu({ anchor: e.currentTarget, comment })}
            >
              <Icon name="dots" size={14} />
            </button>
          </span>
        </div>
        <div className="comment-body">
          {editing === comment.id ? (
            <RichEditor
              id={`edit-${comment.id}`}
              label="Edit comment"
              autoFocus
              initial={comment.body}
              issueKey={issue.key}
              attachments={issue.attachments}
              onFiles={(files) => addIssueFiles(issue.key, files)}
              saveLabel="Save comment"
              onSave={(body) => {
                actions.editComment(issue.key, comment.id, body);
                setEditing(null);
                restoreFocus(comment.id);
              }}
              onCancel={() => {
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
            <p className="px-3 pt-2 text-[12px] text-fg-3">Original comment removed</p>
          )}
          {rows.map(render)}
          {
            <div className="comment-reply-composer">
              {replying ? (
                <RichEditor
                  key={composer}
                  id={`reply-${root.id}`}
                  variant="comment"
                  scope={`${issue.key}:reply:${root.id}`}
                  onLateMedia={(merge) => {
                    try {
                      localStorage.setItem(draftKey, JSON.stringify(merge(draft())));
                    } catch {}
                  }}
                  label="Reply to thread"
                  placeholder="Reply…"
                  autoFocus
                  initial={draft()}
                  issueKey={issue.key}
                  attachments={issue.attachments}
                  onFiles={(files) => addIssueFiles(issue.key, files)}
                  saveLabel="Submit reply"
                  onChange={(body) => {
                    try {
                      localStorage.setItem(draftKey, JSON.stringify(body));
                    } catch {}
                  }}
                  onSave={(body) => {
                    if (actions.comment(issue.key, body, root.id)) {
                      try {
                        localStorage.removeItem(draftKey);
                      } catch {}
                      setComposer((n) => n + 1);
                      setReplying(false);
                      requestAnimationFrame(() =>
                        document.querySelector<HTMLElement>("main")?.focus(),
                      );
                    }
                  }}
                  onCancel={cancelReply}
                />
              ) : (
                <div className="comment-reply-row">
                  {me}
                  <button
                    aria-label="Reply to thread"
                    className="comment-reply-open"
                    onClick={() => setReplying(true)}
                  >
                    Leave a reply…
                  </button>
                  <button
                    aria-label="Attach to reply"
                    title="Attach images, files, or videos"
                    className="comment-reply-attach"
                    onClick={attachReply}
                  >
                    <Icon name="paperclip" size={14} />
                  </button>
                  <button
                    aria-label="Submit reply"
                    title="Submit comment (⌘↵)"
                    className="comment-reply-send"
                    onClick={() => setReplying(true)}
                  >
                    <Icon name="up" size={14} />
                  </button>
                </div>
              )}
            </div>
          }
        </>
      )}
      {preparing && (
        <p role="status" className="px-3 py-2 text-[12px] text-fg-3">
          Copying comment attachments…
        </p>
      )}
      {copyError && (
        <p role="alert" className="px-3 py-2 text-[12px]">
          {copyError}
        </p>
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
              ? [{ name: "Edit", icon: "pencil" as const, run: () => setEditing(comment.id) }]
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
                    danger: true,
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
        <Confirm
          title="Delete this comment?"
          detail="You cannot undo this action."
          action="Delete"
          onConfirm={() => {
            actions.deleteComment(issue.key, deleting);
            setDeleting(null);
          }}
          close={() => setDeleting(null)}
        />
      )}
    </li>
  );
}
