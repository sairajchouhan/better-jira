import { Debouncer } from "@tanstack/pacer";

export type Point = { x: number; y: number };

/**
 * Linear's hover intent (`nst`, startup-root, with `tst = { sensitivity: 2, interval: 100 }`), which its links use to prefetch
 * on hover (`xst` → `sst`): a target fires once the pointer has stayed within `sensitivity` px of one spot for `interval` ms,
 * so a pointer sweeping across cards fires none of them. It fires once per stay; leaving the target ends the stay.
 * `over` without a point (a highlight moved by the keyboard, a hover with no position) starts the wait without the stillness
 * check.
 */
export function createHoverIntent<T>(
  run: (target: T) => void,
  { interval = 100, sensitivity = 2, keyOf = (target: T): unknown => target } = {},
) {
  let stay: { key: unknown; at?: Point; fired: boolean } | undefined;
  const wait = new Debouncer(
    (target: T) => {
      if (stay) stay.fired = true;
      run(target);
    },
    { wait: interval },
  );
  return {
    over(target: T, at?: Point) {
      const key = keyOf(target),
        was = stay?.key === key ? stay : undefined;
      if (was && (was.fired || (at && was.at && Math.abs(at.x - was.at.x) + Math.abs(at.y - was.at.y) < sensitivity))) return;
      stay = { key, at, fired: false };
      wait.maybeExecute(target);
    },
    out() {
      stay = undefined;
      wait.cancel();
    },
  };
}
