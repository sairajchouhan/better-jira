/** What the server's mirror says about reading Jira (`/api/sync`, and the `sync` on every property poll). */
export type SyncHealth = {
  /** Why Jira can't be read, one line per distinct reason (server/jira-problem.ts). */
  errors: string[];
  /** Boards on their first read, and how far each has got. */
  syncing: { board: number; loaded: number; total: number }[];
};

/** The footer's warning: the server gone (the poll itself failed), else why the mirror can't read Jira; "" when all is well.
 *  Without it a stopped server, an expired token or a Jira outage leaves the app showing old data as if it were current. */
export function syncProblem(health: SyncHealth | undefined, pollFailed: boolean): string {
  if (pollFailed) return "Can't reach the better-jira server. Check that bun start is still running.";
  return health?.errors.length ? `Not syncing with Jira: ${health.errors.join(" ")}` : "";
}

/** The boot screen's line while the first sync reads a board: "Board 12: 1,200 of 5,400 issues". */
export function syncProgress(health: SyncHealth): string {
  if (!health.syncing.length) return "Reading your boards' settings from Jira…";
  const n = (value: number) => value.toLocaleString("en-US");
  return health.syncing
    .map((b) => `Board ${b.board}: ${n(b.loaded)} of ${n(b.total)} issues`)
    .join(". ");
}
