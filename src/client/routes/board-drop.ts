import { type Issue } from "@/shared/issue-model";
import { rankBetween } from "@/shared/view-model";

/**
 * What a drop of `keys` (one card, or a selection in list order) into a board cell does: each card, in order, with the rank
 * that lands it before `before` (undefined: the cell's end) and after the card placed just before it, when the board is in
 * manual order; in any other order the cards only change group, so they get no rank. `cell` is the cell's cards as shown;
 * `issue` finds a dropped card, which may come from another cell.
 */
export function dropPlan(
  cell: readonly Issue[],
  keys: readonly string[],
  before: string | undefined,
  order: { manual: boolean; descending: boolean },
  issue: (key: string) => Issue | undefined,
): { key: string; rank?: string }[] {
  let list = cell.filter((i) => !keys.includes(i.key));
  return keys.map((key) => {
    const moved = issue(key);
    if (!order.manual || !moved) return { key };
    const rank = rankAt(list, before, order.descending);
    list = placeBefore(list, { ...moved, rank }, before);
    return { key, rank };
  });
}

type Move = { key: string; rank?: string };

/**
 * Makes a drop's moves (`dropPlan`) with `move`, as one undoable edit when several cards land together (`together`, the undo
 * history's `record`): ⌘Z puts a dragged selection back at once, and a big one never pushes older edits out of the history
 * one card at a time.
 */
export function dropAll(
  plan: readonly Move[],
  move: (m: Move) => void,
  together: (keys: string[], label: string, fn: () => void) => void,
) {
  if (plan.length < 2) plan.forEach(move);
  else together(plan.map((m) => m.key), `move ${plan.length} issues`, () => plan.forEach(move));
}

/** The rank for a card placed before `before` (or at the end) in a cell shown in `list` order. */
function rankAt(list: readonly Issue[], before: string | undefined, descending: boolean) {
  const i = list.findIndex((x) => x.key === before),
    at = i < 0 ? list.length : i,
    prev = list[at - 1]?.rank,
    next = list[at]?.rank;
  return descending ? rankBetween(next, prev) : rankBetween(prev, next);
}

function placeBefore(list: readonly Issue[], issue: Issue, before: string | undefined) {
  const at = list.findIndex((x) => x.key === before);
  return at < 0 ? [...list, issue] : [...list.slice(0, at), issue, ...list.slice(at)];
}
