/** A board's columns as the app shows them: Jira's board configuration with each status's name and category. */
export type BoardColumns = { id: number; name: string; columns: { name: string; statuses: unknown[] }[]; project?: unknown };
export type Progress = { loaded: number; total: number };

/**
 * One full read of a board (mirror.ts `fullSync`). The first page and the board's columns are read together, and the board is
 * `shown` as soon as both are in, so a teammate's first sync opens the app on the first hundred issues instead of after every
 * one, as Linear renders the app while it is still bootstrapping ("Still setting up your workspace", startup-root). The
 * remaining pages are read `parallel` at a time, each `saved` as it lands, with `progress` counting them. Resolves once every
 * page is saved; a page that fails rejects it, and the next full sync reads the board again.
 */
export async function readWholeBoard({
  page,
  columns,
  save,
  shown,
  landed,
  pageSize,
  parallel,
}: {
  page: (startAt: number) => Promise<{ issues: unknown[]; total: number }>;
  columns: () => Promise<BoardColumns>;
  save: (issues: any[]) => void;
  shown: (columns: BoardColumns, progress: Progress) => void;
  landed?: (progress: Progress) => void;
  pageSize: number;
  parallel: number;
}): Promise<Progress> {
  const [first, config] = await Promise.all([page(0), columns()]);
  save(first.issues);
  const progress = { loaded: first.issues.length, total: first.total };
  shown(config, progress);
  const starts: number[] = [];
  for (let s = pageSize; s < first.total; s += pageSize) starts.push(s);
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      for (let s; (s = starts.shift()) !== undefined; ) {
        const { issues } = await page(s);
        save(issues);
        progress.loaded += issues.length;
        landed?.(progress);
      }
    }),
  );
  return progress;
}

/** Per board: why its last sync failed (in words) and, while a full sync reads it, how far that has got. */
export type BoardSyncState = { id: number; error?: string; progress?: Progress };
/** What the app shows about syncing (`/api/sync`, and the `sync` on every property poll): why Jira can't be read, one line per
 *  distinct reason, and the boards on their first read with how far each has got. A board shows after its first page, so a
 *  first read is one the board has never finished (`read`), not one whose columns are missing. */
export const syncHealthOf = (states: readonly BoardSyncState[], read: (board: number) => boolean) => ({
  errors: [...new Set(states.flatMap((b) => (b.error ? [b.error] : [])))],
  syncing: states.flatMap((b) => (b.progress && !read(b.id) ? [{ board: b.id, ...b.progress }] : [])),
});
