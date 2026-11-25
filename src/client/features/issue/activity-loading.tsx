import { useState, type ReactNode } from "react";
import { LoadingCaret } from "@/client/components/empty-state";

/**
 * Linear holds an issue's comments, history and comment box together until they are all there: `IssueCommentsAndHistory`
 * (`Hl`, IssueCommentsAndHistory chunk) sits in a SuspenseObserver (`Hv`, startup-root) whose fallback is `Oi`, and the
 * Activity heading stays outside it. So the rows never land one by one above a comment box that is already showing, and
 * nothing below the Activity moves.
 */

/** Linear's fallback `Oi` (`u` in the DuplicatedByIcon chunk): a relative box holding a `noPadding` LoadingContainer over a
 *  300px flex, which is to say 300px kept for the Activity (`.activity-loading`) with the loading caret at its top-left. */
export function ActivityLoadingState() {
  return (
    <div className="activity-loading" data-activity-loading>
      <LoadingCaret label="Loading activity" />
    </div>
  );
}

/** Which issue the Activity shows, whether it has shown its content yet, and whether the fallback showed first. */
export type ActivityReveal = { identity: string; ready: boolean; waited: boolean };

/** One render's step. Once shown, an issue's Activity stays: a later read (a new `updated`, the Jira key an issue made here
 *  gets, which keeps its `firstKey`) never puts the fallback back over a comment being written. Another issue starts over. */
export function revealStep(previous: ActivityReveal | undefined, identity: string, loading: boolean): ActivityReveal {
  if (!previous || previous.identity !== identity) return { identity, ready: !loading, waited: loading };
  if (previous.ready || loading) return previous;
  return { ...previous, ready: true };
}

/** `revealStep` across renders, set while rendering (React's "storing information from previous renders") so the first render
 *  of another issue already shows its fallback rather than the last issue's content. */
export function useActivityReveal(identity: string, loading: boolean): ActivityReveal {
  const [reveal, setReveal] = useState(() => revealStep(undefined, identity, loading));
  const next = revealStep(reveal, identity, loading);
  if (next !== reveal) setReveal(next);
  return next;
}

/** The boundary itself: the fallback until `ready`, then the comments, history and comment box together, faded in
 *  (`suspenseFadeIn`) only when the fallback had shown (`fadeIn`), as Linear's SuspenseObserver does. */
export function ActivityGate({ ready, fadeIn, children }: { ready: boolean; fadeIn: boolean; children: ReactNode }) {
  if (!ready) return <ActivityLoadingState />;
  return <div className={fadeIn ? "ui-suspense-fade-in" : undefined}>{children}</div>;
}
