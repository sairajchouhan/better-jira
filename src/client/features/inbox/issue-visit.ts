/** Reading an issue anywhere but the inbox reads its notifications, by Linear's rules (`MarkNotificationAsRead` chunk):
 *  `useIssueVisit` for the issue, `useCommentsSeen` for its comments. The inbox's own rows read by its 300 ms rule instead,
 *  as Linear skips both when the issue was opened from the inbox (`issueOrigin.type === "inbox"`). */
import { useEffect, useSyncExternalStore, type RefObject } from "react";
import { createSeenTracker } from "@/shared/inbox-visit";
import { useStore } from "@/client/state/store";
import { inboxShown } from "@/client/features/navigation/navigation";
import { commentSeen, useFeed, visitIssue } from "./inbox";

/** Linear's `C`: whether this window has focus, from its focus and blur events. */
const subscribeFocus = (notify: () => void) => {
  addEventListener("focus", notify);
  addEventListener("blur", notify);
  return () => {
    removeEventListener("focus", notify);
    removeEventListener("blur", notify);
  };
};
const hasFocus = () => typeof document !== "undefined" && document.hasFocus();
export const useWindowFocus = () => useSyncExternalStore(subscribeFocus, hasFocus, () => false);

/** Linear's `z`: when the issue shows in a focused window, and again when its comment count changes, its notifications
 *  without a comment are read. The feed's first fetch stands in for Linear's `waitForSync`. */
export function useIssueVisit(key: string, comments: number) {
  const fromInbox = useStore(inboxShown);
  const focused = useWindowFocus();
  const fetched = useFeed("all").dataUpdatedAt > 0;
  useEffect(() => {
    if (!fromInbox && focused && fetched) visitIssue(key);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Linear's `z` runs again when the comment count changes.
  }, [key, fromInbox, focused, fetched, comments]);
}

const later = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};
/** Linear's `j`/`M` for every comment under `root` (`[data-comment]`, its thread's lead in `data-comment-parent`): one
 *  IntersectionObserver for the issue, and a MutationObserver for comments that mount or leave as threads fold. */
export function useCommentsSeen(key: string, root: RefObject<HTMLElement | null>) {
  const fromInbox = useStore(inboxShown);
  useEffect(() => {
    const scope = root.current;
    if (fromInbox || !scope || typeof IntersectionObserver === "undefined") return;
    const tracker = createSeenTracker({ later, focused: hasFocus, seen: (comment) => commentSeen(key, comment) });
    const commentOf = (node: Element) => {
      const id = (node as HTMLElement).dataset.comment!,
        parentId = (node as HTMLElement).dataset.commentParent;
      return parentId ? { id, parentId } : { id };
    };
    const view = new IntersectionObserver((entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) tracker.show(commentOf(entry.target));
        else tracker.hide(commentOf(entry.target).id);
    });
    const each = (node: Node, fn: (comment: Element) => void) => {
      if (!(node instanceof Element)) return;
      if (node.matches("[data-comment]")) fn(node);
      node.querySelectorAll("[data-comment]").forEach(fn);
    };
    each(scope, (c) => view.observe(c));
    const tree = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((n) => each(n, (c) => view.observe(c)));
        record.removedNodes.forEach((n) =>
          each(n, (c) => {
            view.unobserve(c);
            tracker.remove(commentOf(c).id);
          }),
        );
      }
    });
    tree.observe(scope, { childList: true, subtree: true });
    addEventListener("focus", tracker.focus);
    return () => {
      removeEventListener("focus", tracker.focus);
      tree.disconnect();
      view.disconnect();
      tracker.dispose();
    };
  }, [key, fromInbox, root]);
}
