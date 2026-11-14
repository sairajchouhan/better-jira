import { useLayoutEffect, useRef, useState } from "react";

/**
 * One function for the component's life that always calls the latest `fn`: a handler a memoised row can take without every row
 * re-rendering whenever its parent re-renders. It is for event handlers, which run after the render that made them has committed;
 * never call it during render.
 */
export function useStableCallback<Args extends unknown[], Result>(fn: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  const [stable] = useState(() => (...args: Args) => latest.current(...args));
  return stable;
}
