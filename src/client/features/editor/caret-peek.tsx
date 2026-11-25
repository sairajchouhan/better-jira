import { useRef, type ReactNode } from "react";
import { MENU_POPUP, useElevation, usePlacement } from "@/client/components/menu-surface";

/** Linear's suggestion-menu ⌥↑/⌥↓: to the start of this group (or the one before, from its start), or of the next one
 * (or the last item, from the last group). `groups` holds each item's group. */
export function groupStep(groups: readonly (string | undefined)[], at: number, by: 1 | -1): number {
  const starts = groups.flatMap((group, i) => (i === 0 || group !== groups[i - 1] ? [i] : []));
  if (by === 1) return starts.find((s) => s > at) ?? groups.length - 1;
  const current = starts.findLast((s) => s <= at) ?? 0;
  return at > current ? current : (starts.findLast((s) => s < current) ?? current);
}

/** The → preview of a caret menu's highlighted item, beside the menu (left of it when the right has no room). */
export function CaretPeek({ menu, at, children }: { menu: HTMLElement | null; at: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const elevation = useElevation();
  const style = usePlacement(
    ref,
    menu,
    (box, popup) => {
      if (!box) return {};
      const width = popup.offsetWidth,
        right = box.right + 4;
      return { left: right + width <= innerWidth - 8 ? right : Math.max(8, box.left - 4 - width), top: box.top };
    },
    at,
  );
  return (
    <div
      ref={ref}
      {...elevation.props}
      className={`${MENU_POPUP} fixed z-50 flex max-h-[400px] overflow-hidden`}
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}
