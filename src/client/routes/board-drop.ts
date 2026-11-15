import { type Issue, type RankAnchor } from "@/shared/issue-model";
import { anchorFor, rankBeside } from "@/shared/board-rank";

/** One dropped card: its new rank and the card Jira ranks it beside (manual order), or neither (its group changes only). */
export type Move = { key: string; rank?: string; rankAnchor?: RankAnchor };

/**
 * What a drop of `keys` (one card, or a selection in list order) before `before` (undefined: the cell's end) in a board or
 * list cell does. `cell` is the cell's cards as shown, so a filter, a swimlane or another board's cards never count; `issues`
 * are every card, for the ranks Jira holds around them. One plan for every drop: the mouse and React Aria's keyboard drag
 * (board columns, swimlane cells, list groups) and the ⌥↑/⌥↓ Move commands.
 *
 * Linear's handleIssuesDrop (`kFn`, `Vyt`, `HN`): each card lands after the card shown above it (or before the one shown
 * below at the top), and the next card of a selection after it. In manual order that card is the drop's rank anchor
 * (shared/board-rank.ts), and the rank lands the card right beside it on the whole board, where Jira will put it. In an
 * empty cell there is no card to rank beside, so the card only changes group, as Linear leaves its sort order. A drop that
 * leaves the cell's order as it is (the card back on its own place) moves nothing, so nothing is written.
 */
export function dropPlan(
  cell: readonly Issue[],
  keys: readonly string[],
  before: string | undefined,
  order: { manual: boolean; descending: boolean },
  issues: ReadonlyMap<string, Issue>,
): Move[] {
  const moving = new Set(keys),
    rest = cell.filter((i) => !moving.has(i.key)),
    // Before a card that is itself moving: before the first card after it that stays.
    from = cell.findIndex((i) => i.key === before),
    stays = from < 0 ? undefined : cell.slice(from).find((i) => !moving.has(i.key))?.key,
    found = rest.findIndex((i) => i.key === stays),
    at = found < 0 ? rest.length : found;
  const inCell = (key: string) => cell.some((i) => i.key === key);
  if (keys.every(inCell)) {
    const result = [...rest.slice(0, at).map((i) => i.key), ...keys, ...rest.slice(at).map((i) => i.key)];
    if (result.every((key, i) => cell[i]!.key === key)) return [];
  }
  // In any other order a card's place in its group is the ordering's: only a card from another group moves.
  if (!order.manual) return keys.filter((key) => !inCell(key)).map((key) => ({ key }));
  const placed = new Map<string, string>(),
    rankOf = (i: Issue) => placed.get(i.key) ?? i.rank;
  let above = rest[at - 1]?.key;
  const below = rest[at]?.key;
  return keys.map((key) => {
    const moved = issues.get(key),
      anchor = anchorFor(above, below, order.descending);
    if (!moved || !anchor) return { key };
    const waiting = new Set(keys.filter((k) => k !== key && !placed.has(k))),
      rank = rankBeside(anchor, moved, issues.values(), rankOf, waiting);
    if (rank === undefined) return { key };
    placed.set(key, rank);
    above = key;
    return { key, rank, rankAnchor: anchor };
  });
}

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
