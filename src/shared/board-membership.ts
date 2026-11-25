import type { Issue } from "./issue-model";

/**
 * Which boards an issue is on. In Jira an issue sits on every board whose filter holds it, so the mirror sends each issue with
 * all of them (server/issue-store.ts decides). Everything that asks "is this issue on that board" asks `onBoard`; everything
 * that needs one board for an issue (its statuses, where opening it goes) asks `boardFor`.
 */

/** Whether `board` holds the issue. */
export const onBoard = (issue: Pick<Issue, "boards">, board: number | undefined) =>
  board !== undefined && issue.boards.includes(board);

/** The one board an issue opens on and takes its statuses from: the board being viewed when that holds it, else the first that
 *  does in the sidebar's order, else (an issue no configured board holds, such as one only linked from a board issue) the board
 *  being viewed. */
export const boardFor = (issue: Pick<Issue, "boards"> | undefined, viewing: number) =>
  !issue || onBoard(issue, viewing) || !issue.boards.length ? viewing : issue.boards[0]!;

/** An issue as saved by an older build, with one `board`, read as the boards that hold it. */
export const withMembership = <T extends object>(issue: T): Omit<T, "board" | "boards"> & Pick<Issue, "boards"> => {
  const { board, boards, ...rest } = issue as T & { board?: unknown; boards?: unknown };
  if (Array.isArray(boards) && boards.every(Number.isFinite)) return { ...rest, boards: boards as number[] };
  return { ...rest, boards: Number.isFinite(board) ? [board as number] : [] };
};

/** Whether some board holds both issues. */
export const sharesBoard = (a: Pick<Issue, "boards">, b: Pick<Issue, "boards">) => a.boards.some((board) => b.boards.includes(board));

/**
 * The tab's issues after boards were added (`remote`: the server's issues, `known`: the boards the tab had) or `removed`. An
 * issue a new board holds arrives if the tab lacked it; one the tab has takes the server's boards (a shared issue joins the new
 * board, as it is on both); a removed board leaves every issue, and one no board holds any more leaves the tab. Other fields stay
 * the tab's own, with its local edits.
 */
export function rejoinBoards<T extends Pick<Issue, "key" | "boards">>(
  local: ReadonlyMap<string, T>,
  remote: readonly T[],
  known: ReadonlySet<number>,
  removed: ReadonlySet<number> = new Set(),
): Map<string, T> {
  const issues = new Map(local);
  for (const issue of remote) {
    const mine = issues.get(issue.key);
    if (!mine) {
      if (issue.boards.some((b) => !known.has(b))) issues.set(issue.key, issue);
    } else if (String(mine.boards) !== String(issue.boards)) issues.set(issue.key, { ...mine, boards: issue.boards });
  }
  if (removed.size)
    for (const [key, issue] of issues) {
      if (!issue.boards.some((b) => removed.has(b))) continue;
      const left = issue.boards.filter((b) => !removed.has(b));
      if (left.length) issues.set(key, { ...issue, boards: left });
      else issues.delete(key);
    }
  return issues;
}
