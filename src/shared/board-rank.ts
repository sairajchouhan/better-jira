import type { Issue, RankAnchor } from "./issue-model";
import { sharesBoard } from "./board-membership";
import { rankBetween } from "./view-model";

/**
 * Jira ranks a board as one list across its columns, and a drop is written as "rank before/after <issue>". The card it
 * names is the one the drop landed beside in the cell as shown (Linear's handleIssuesDrop `kFn` → `Vyt`: the dropped
 * card's neighbours are the target cell's shown siblings, dragged ones left out), never a card a filter, a swimlane or
 * another board hides: those it would jump past. This module turns that neighbour into the anchor Jira gets and the local
 * rank that lands the card where Jira will put it.
 */

/** The card a drop names, from its neighbours in the cell as shown (`above`, `below`): the one above by preference, as Linear
 *  places a dropped card from the card above when there is one (`HN`). In a descending cell the card shown above comes later
 *  in Jira's order. Undefined in an empty cell: there is nothing to rank beside, so the drop changes only its group. */
export function anchorFor(above: string | undefined, below: string | undefined, descending: boolean): RankAnchor | undefined {
  if (above !== undefined) return descending ? { before: above } : { after: above };
  if (below !== undefined) return descending ? { after: below } : { before: below };
  return undefined;
}

export const anchorKey = (anchor: RankAnchor) => ("after" in anchor ? anchor.after : anchor.before);

/**
 * The rank that puts `moved` right beside `anchor` in Jira's board order, as Jira's "rank after/before" does: between the
 * anchor and its next (or previous) ranked card among every issue sharing a board with `moved`, shown or not, so the local
 * order agrees with Jira's once a filter clears. `rankOf` reads a card's rank, so a drop of several cards sees the ones it
 * already placed; `skip` are cards not to rank against (the ones still moving). Undefined when the anchor has no rank.
 */
export function rankBeside(
  anchor: RankAnchor,
  moved: Issue,
  issues: Iterable<Issue>,
  rankOf: (issue: Issue) => string | undefined,
  skip: ReadonlySet<string>,
): string | undefined {
  const key = anchorKey(anchor),
    peers: string[] = [];
  let at: string | undefined;
  for (const issue of issues) {
    if (issue.key === moved.key || skip.has(issue.key) || !sharesBoard(issue, moved)) continue;
    const rank = rankOf(issue);
    if (rank === undefined) continue;
    if (issue.key === key) at = rank;
    else peers.push(rank);
  }
  if (at === undefined) return undefined;
  const anchorRank = at,
    own = rankOf(moved);
  const [low, high] =
    "after" in anchor
      ? [anchorRank, peers.filter((r) => r > anchorRank).reduce<string | undefined>((m, r) => (m === undefined || r < m ? r : m), undefined)]
      : [peers.filter((r) => r < anchorRank).reduce<string | undefined>((m, r) => (m === undefined || r > m ? r : m), undefined), anchorRank];
  // Already right beside the anchor on the board (a card moved to another column at its own rank): its rank stays.
  if (own !== undefined && (low === undefined || own > low) && (high === undefined || own < high)) return own;
  return rankBetween(low, high);
}

/**
 * The rank op for a change of `b`'s rank: the anchor its drop named (Jira ranks it beside that card), when this change set
 * it and the card is still known; else the card ranked just before it among the issues sharing its board, or just after
 * when it is first. The fallback serves a rank restored without a drop (⌘Z), whose place is its board neighbours.
 */
export function rankOp(a: Issue, b: Issue, issues: ReadonlyMap<string, Issue>): RankAnchor | undefined {
  const anchor = b.rankAnchor;
  if (anchor && JSON.stringify(anchor) !== JSON.stringify(a.rankAnchor)) {
    const key = anchorKey(anchor);
    if (key !== b.key && issues.has(key)) return anchor;
  }
  let prev: Issue | undefined, next: Issue | undefined;
  for (const i of issues.values()) {
    if (i.key === b.key || i.rank === undefined || !sharesBoard(i, b)) continue;
    if (i.rank < b.rank! && (!prev || i.rank > prev.rank!)) prev = i;
    if (i.rank > b.rank! && (!next || i.rank < next.rank!)) next = i;
  }
  return prev ? { after: prev.key } : next ? { before: next.key } : undefined;
}
