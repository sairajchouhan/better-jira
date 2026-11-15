import type { Database } from "bun:sqlite";

/**
 * The mirror's issues and which boards hold them. In Jira an issue sits on every board whose filter holds it (a team board and a
 * squad board over one project share issues), so membership is many-to-many: one row per issue and board, written only when that
 * board's sync reads the issue and swept by that board's full sync. An issue's content is one row however many boards hold it.
 *
 * An issue no board holds (one linked from a board issue, a parent in another project, one the inbox names) is kept as content
 * with no membership once something asks for it by key, as Linear hydrates a model its sync didn't bring (`hydrateModel`). It
 * is listed with `boards: []`, so it opens anywhere but sits on no board, and it leaves when Jira deletes it.
 *
 * This is the one place membership is decided. Reads send each issue with `boards`: the configured boards that hold it, in the
 * sidebar's order.
 */
export function issueStore(db: Database) {
  migrateIssueStore(db);
  const upsert = db.query(
    // A poll page fetched before a write must not replace the newer row the write's refresh saved.
    `INSERT INTO issues (key, slim, full) VALUES ($key, $slim, $full)
     ON CONFLICT(key) DO UPDATE SET
       slim=CASE WHEN COALESCE(json_extract(excluded.slim,'$.updated'),'')>=COALESCE(json_extract(issues.slim,'$.updated'),'') THEN excluded.slim ELSE issues.slim END,
       full=CASE WHEN COALESCE(json_extract(excluded.slim,'$.updated'),'')>=COALESCE(json_extract(issues.slim,'$.updated'),'') THEN excluded.full ELSE issues.full END`,
  );
  const member = db.query<{ seen: number }, [string, number]>("SELECT seen FROM issue_boards WHERE key = ? AND board = ?");
  const see = db.query(
    "INSERT INTO issue_boards (key, board, seen) VALUES (?, ?, ?) ON CONFLICT(key, board) DO UPDATE SET seen = excluded.seen",
  );
  const boardsOfKey = db.query<{ board: number }, [string]>("SELECT board FROM issue_boards WHERE key = ? ORDER BY board");
  const updatedOf = db.query<{ updated: string | null }, [string]>(
    "SELECT json_extract(slim,'$.updated') AS updated FROM issues WHERE key = ?",
  );
  const boardsOf = (key: string) => boardsOfKey.all(key).map((r) => r.board);
  const inList = (boards: readonly number[]) => boards.map((b) => Number(b)).filter(Number.isFinite).join(",") || "NULL";
  /** Each issue on one of `boards`, and each kept on no board, with the boards that hold it in `boards`' order. */
  const listed = <Row extends { key: string; slim: string }>(boards: readonly number[], columns: string, join = "") => {
    const order = new Map(boards.map((b, i) => [b, i]));
    return db
      .query<Row & { held: string | null }, []>(
        `SELECT ${columns}, (SELECT group_concat(m.board) FROM issue_boards m WHERE m.key = i.key AND m.board IN (${inList(boards)})) AS held
         FROM issues i ${join}
         WHERE i.key IN (SELECT key FROM issue_boards WHERE board IN (${inList(boards)}))
            OR NOT EXISTS (SELECT 1 FROM issue_boards m WHERE m.key = i.key)`,
      )
      .all()
      .map(({ held, ...row }) => {
        const on = (held ? held.split(",") : [])
          .map(Number)
          .sort((a, b) => order.get(a)! - order.get(b)!);
        return { ...(row as unknown as Row), slim: withBoards(row.slim, on) };
      });
  };
  return {
    /** A board's sync read the issue: it is on that board as of `seen`. Returns whether that is new. */
    see(key: string, board: number, seen: number) {
      const known = member.get(key, board) !== null;
      see.run(key, board, seen);
      return !known;
    },
    /** Without a board to say otherwise, an issue made from a board's composer starts on that board: when no configured board
     *  holds it yet, `board` does until that board's own sync says. Jira's board search lags a fresh create, so it isn't asked. */
    claim(key: string, board: number, configured: readonly number[]) {
      if (!configured.includes(board) || boardsOf(key).some((b) => configured.includes(b))) return;
      see.run(key, board, Date.now());
    },
    /** Saves the issue's content when it is new or no older than the saved copy. A board's sync says first that the board holds
     *  it (`see`); saved alone, an issue no board holds is kept on none. */
    put(row: { key: string; slim: unknown; full: unknown }) {
      upsert.run({ key: row.key, slim: JSON.stringify(row.slim), full: JSON.stringify(row.full) });
    },
    /** When Jira last changed the saved copy ("" when there is none). */
    updated: (key: string) => updatedOf.get(key)?.updated ?? "",
    /** Every board that holds the issue, configured or not. */
    boardsOf,
    /** How many issues the mirror has on the board. */
    count: (board: number) =>
      db.query<{ n: number }, [number]>("SELECT count(*) AS n FROM issue_boards WHERE board = ?").get(board)!.n,
    /** After a full sync of `board` that started at `since`: issues it no longer holds leave it, and one that just left its last
     *  board leaves the mirror. Issues kept on no board aren't this board's to sweep. Returns how many left the board. */
    sweep(board: number, since: number) {
      return db.transaction(() => {
        const gone = db
          .query<{ key: string }, [number, number]>("DELETE FROM issue_boards WHERE board = ? AND seen < ? RETURNING key")
          .all(board, since);
        const orphan = db.query("DELETE FROM issues WHERE key = $key AND NOT EXISTS (SELECT 1 FROM issue_boards WHERE key = $key)");
        for (const { key } of gone) orphan.run({ key });
        return gone.length;
      })();
    },
    /** On start: boards no longer configured let go of their issues. An issue only they held leaves the mirror; one a configured
     *  board holds stays on it, and one kept on no board stays kept. Returns the boards let go. */
    forgetBoards(configured: readonly number[]) {
      return db.transaction(() => {
        const kept = inList(configured);
        const gone = db
          .query<{ board: number }, []>(`SELECT DISTINCT board FROM issue_boards WHERE board NOT IN (${kept})`)
          .all()
          .map((r) => r.board);
        // Issues first: once their memberships go, an issue only a dropped board held looks like one kept on no board.
        db.run(
          `DELETE FROM issues WHERE key IN (SELECT key FROM issue_boards)
             AND key NOT IN (SELECT key FROM issue_boards WHERE board IN (${kept}))`,
        );
        db.run(`DELETE FROM issue_boards WHERE board NOT IN (${kept})`);
        return gone;
      })();
    },
    /** Jira deleted the issue. */
    remove(key: string) {
      db.transaction(() => {
        db.query("DELETE FROM issue_boards WHERE key = ?").run(key);
        db.query("DELETE FROM issues WHERE key = ?").run(key);
      })();
    },
    /** The board's issues' stored rows. */
    rowsOn: (board: number) =>
      db
        .query<{ key: string; slim: string; full: string }, [number]>(
          "SELECT i.key, i.slim, i.full FROM issues i JOIN issue_boards m ON m.key = i.key WHERE m.board = ?",
        )
        .all(board),
    /** Every issue on the configured `boards`, and every issue kept on no board, as JSON with its `boards`. Issues only on other
     *  boards (removed from the sidebar, until the next start forgets them) are left out. */
    slims: (boards: readonly number[]) => listed<{ key: string; slim: string }>(boards, "i.key, i.slim").map((r) => r.slim),
    /** The same issues with what enrichment stored for them (see `propertyEntries`). */
    propertyRows: (boards: readonly number[]) =>
      listed<{ key: string; slim: string; data: string | null; source_updated: string | null }>(
        boards,
        "i.key, i.slim, p.data, p.source_updated",
        "LEFT JOIN issue_properties p ON p.key = i.key",
      ),
  };
}
export type IssueStore = ReturnType<typeof issueStore>;

/** Of the mirror's meta keys, the sync state of boards no longer `configured` (when each last synced, its columns): forgotten
 *  with their issues, so a board put back later starts with a full sync, not an incremental one over an empty board. */
export const droppedBoardMeta = (keys: readonly string[], configured: readonly number[]) =>
  keys.filter((k) => {
    const board = k.match(/^(?:full|inc|fields|config):(\d+)$/)?.[1];
    return board !== undefined && !configured.includes(Number(board));
  });

/** The issue's stored JSON with the boards that hold it. */
export const withBoards = (slim: string, boards: readonly number[]) =>
  `{"boards":${JSON.stringify(boards)}${slim === "{}" ? "" : ","}${slim.slice(1)}`;

/**
 * Creates the issue tables, and moves a cache from before per-board membership (one `board` and `seen` on each issue, which the
 * last board to sync overwrote) onto `issue_boards`, keeping every row. Idempotent. Returns whether it moved an old cache: that
 * one kept only the last board's claim to a shared issue, so every board needs a full sync to find the rest.
 */
export function migrateIssueStore(db: Database) {
  db.run("CREATE TABLE IF NOT EXISTS issues (key TEXT PRIMARY KEY, slim TEXT NOT NULL, full TEXT NOT NULL)");
  db.run(
    "CREATE TABLE IF NOT EXISTS issue_boards (key TEXT NOT NULL, board INTEGER NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY (key, board)) WITHOUT ROWID",
  );
  db.run("CREATE INDEX IF NOT EXISTS issue_boards_board ON issue_boards (board, seen)");
  const columns = db
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('issues')")
    .all()
    .map((c) => c.name);
  if (!columns.includes("board")) return false;
  db.transaction(() => {
    db.run("INSERT OR IGNORE INTO issue_boards (key, board, seen) SELECT key, board, seen FROM issues");
    db.run("ALTER TABLE issues DROP COLUMN board");
    db.run("ALTER TABLE issues DROP COLUMN seen");
  })();
  return true;
}
