import { useStore } from "@/client/state/store";
import { IssuePeekContent } from "@/client/features/issue/issue-peek";
import { peekPlacement, usePeekKey } from "./view-peek-state";

const placement = peekPlacement();

/**
 * Linear's view peek container (useIsKeyPressedRef `Y` with `q`'s defaults, `data-view-peek`): fixed 88px from the top and 24px
 * from the right, at most 86vw wide and the window's height below its top, 12px corners on the elevated background with a border
 * and shadow, above the view (z-index 650). It slides in from 20px right. Its content takes no pointer events
 * (`._container_12ht3_6>*{pointer-events:none}`), so it never steals the hover from the item it shows.
 */
export function ViewPeek() {
  const key = usePeekKey();
  const issue = useStore((s) => (key ? s.issues.get(key) : undefined));
  if (!issue) return null;
  return (
    <div
      data-view-peek
      role="region"
      aria-label={`Peek ${issue.key}`}
      className="view-peek fixed z-[650] flex max-w-[86vw] overflow-x-hidden overflow-y-auto rounded-xl border border-(--bg-border) bg-card shadow-(--menu-shadow) *:pointer-events-none"
      style={{ top: placement.top, right: placement.right, maxHeight: placement.maxHeight }}
    >
      <IssuePeekContent issue={issue} />
    </div>
  );
}
