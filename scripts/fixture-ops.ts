import { rankBetween } from "../src/shared/view-model";
import type { Op } from "../src/shared/jira-ops";

/**
 * Jira's rank PUT (`/rest/agile/1.0/issue/rank`, see src/server/jira-writes.ts) for the fixture: the issue's new rank sits
 * right after `after` (`rankAfterIssue`) or right before `before` (`rankBeforeIssue`) among every other issue's rank, its own
 * left out. Undefined when the target has no rank, as Jira refuses that rank.
 */
export function rankFor(
  ranks: ReadonlyMap<string, string>,
  key: string,
  op: { after?: string; before?: string },
): string | undefined {
  const others = [...ranks].filter(([k]) => k !== key).map(([, rank]) => rank).sort();
  if (op.after !== undefined) {
    const after = ranks.get(op.after);
    return after === undefined ? undefined : rankBetween(after, others.find((rank) => rank > after));
  }
  if (op.before !== undefined) {
    const before = ranks.get(op.before);
    return before === undefined ? undefined : rankBetween(others.findLast((rank) => rank < before), before);
  }
  return undefined;
}

/** What an issue's status and rank ops leave it with, as Jira's transition and rank PUT would: the fixture's stand-in for
 * the server's applyOps on a drag's write. `ranks` are every issue's current ranks. */
export function boardOps(key: string, ops: readonly Op[], ranks: ReadonlyMap<string, string>): { status?: string; rank?: string } {
  const out: { status?: string; rank?: string } = {};
  for (const op of ops) {
    if (op.op === "status") out.status = op.status;
    if (op.op === "rank") {
      const rank = rankFor(ranks, key, op);
      if (rank !== undefined) out.rank = rank;
    }
  }
  return out;
}
