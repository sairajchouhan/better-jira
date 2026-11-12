import { useState, type KeyboardEvent } from "react";

/**
 * Linear opens a menu from a pointer with no row highlighted: Enter does nothing, ArrowDown highlights the first row and ArrowUp the
 * last, and moving the pointer or typing wakes it. cmdk always selects its first row, so until then `[data-pristine]` hides that
 * selection (index.css) and Menu's ArrowRight ignores it. Spread `props` on the Menu; call `wake` when the search changes.
 */
export function usePristine(initial: boolean) {
  const [pristine, setPristine] = useState(initial);
  const wake = () => setPristine(false);
  return {
    pristine,
    wake,
    props: {
      "data-pristine": pristine || undefined,
      onPointerMove: wake,
      onKeyDown: (event: KeyboardEvent) => {
        if (!pristine) return;
        if (event.key === "ArrowDown" || event.key === "Enter") event.preventDefault();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") wake();
      },
    },
  };
}
