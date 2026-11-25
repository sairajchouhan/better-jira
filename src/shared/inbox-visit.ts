/** What viewing an issue outside the inbox marks read: Linear's `MarkNotificationAsRead` chunk (2026-11-14). Pure. */
import type { InboxItem, InboxNote, Local } from "./inbox-model";

/** Linear's `M`: a comment that came into view in a focused window marks its notifications read 1 s later. */
export const COMMENT_SEEN_DELAY = 1_000;

type Note = Pick<InboxNote, "commentId" | "unread">;
/** A row's notifications as the feed loaded them: the group's first page, or the row alone when it is a single notification. */
export const notesOf = (item: InboxItem): Note[] =>
  item.group?.notes.length ? item.group.notes : [item];

/** The comments a seen comment clears: Linear's `Comment.markNotificationsAsRead` takes notifications on the comment and on
 *  its parent, so reading a reply clears the notification about the comment it answers. */
export const clearedComments = (comment: { id: string; parentId?: string }) =>
  comment.parentId ? [comment.id, comment.parentId] : [comment.id];

/**
 * Whether an issue's visit leaves its row with nothing unread, so the row (one Jira group: Jira reads groups, not single
 * notifications) can be marked read. Linear's rules:
 * - Opening the issue (`z` → `Issue.markNonImportantNotificationsAsRead`) clears every notification without a `commentId`.
 *   Linear keeps reminder, SLA and urgent-priority ones unless a newer one follows; Jira's bell sends none of those.
 * - A notification about a comment clears only once that comment, or a reply to it, has been seen (`seen`, see
 *   `clearedComments`).
 * A row this browser already reads (or that Jira reads) needs nothing. One marked unread here counts its head as unread.
 */
export function visitClears(
  item: InboxItem,
  local: Local | undefined,
  seen: ReadonlySet<string>,
): boolean {
  if (local?.read === true) return false;
  if (local?.read !== false && !item.unread) return false;
  const notes = notesOf(item),
    unread = notes.filter((n) => n.unread);
  return (unread.length ? unread : [item]).every((n) => !n.commentId || seen.has(n.commentId));
}

type SeenComment = { id: string; parentId?: string };
/**
 * Linear's comment rule (`j` latches, `M` marks): a comment that is in view while the window has focus is latched, and 1 s
 * later its notifications are read, even if it has scrolled away or the window lost focus since. The comment leaving the page
 * (its thread folded, the issue closed) cancels it. `seen` runs once per comment.
 */
export function createSeenTracker({
  later,
  focused,
  seen,
}: {
  later: (fn: () => void, ms: number) => () => void;
  focused: () => boolean;
  seen: (comment: SeenComment) => void;
}) {
  const visible = new Map<string, SeenComment>(),
    latched = new Map<string, () => void>(),
    done = new Set<string>();
  function latch() {
    if (!focused()) return;
    for (const [id, comment] of visible)
      if (!latched.has(id) && !done.has(id))
        latched.set(
          id,
          later(() => {
            latched.delete(id);
            done.add(id);
            seen(comment);
          }, COMMENT_SEEN_DELAY),
        );
  }
  return {
    /** The comment came into view. */
    show(comment: SeenComment) {
      visible.set(comment.id, comment);
      latch();
    },
    /** It scrolled out of view: a latched one still counts. */
    hide: (id: string) => void visible.delete(id),
    /** It left the page. */
    remove(id: string) {
      visible.delete(id);
      latched.get(id)?.();
      latched.delete(id);
    },
    /** The window took focus: what is in view now latches. */
    focus: latch,
    dispose() {
      for (const cancel of latched.values()) cancel();
      latched.clear();
      visible.clear();
    },
  };
}
