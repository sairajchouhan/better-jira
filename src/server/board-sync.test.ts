import { expect, test } from "bun:test";
import { readWholeBoard, syncHealthOf } from "./board-sync";

test("BJ-338: a board shows once its first page and columns are in, while its other pages are still being read", async () => {
  const log: string[] = [];
  const later = Promise.withResolvers<void>();
  const issues = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ key: `T-${from + i}` }));
  const read = readWholeBoard({
    page: async (startAt) => {
      log.push(`page ${startAt}`);
      if (startAt > 0) await later.promise; // Jira is slow with the rest
      return { issues: issues(startAt, startAt === 200 ? 50 : 100), total: 250 };
    },
    columns: async () => (log.push("columns"), { id: 7, name: "Team", columns: [] }),
    save: (saved) => log.push(`saved ${saved.length}`),
    shown: (columns, progress) => log.push(`shown ${columns.name} ${progress.loaded}/${progress.total}`),
    landed: (progress) => log.push(`landed ${progress.loaded}`),
    pageSize: 100,
    parallel: 4,
  });
  await Bun.sleep(5);
  // Shown on the first hundred, with the other pages asked for but not in.
  expect(log).toEqual(["page 0", "columns", "saved 100", "shown Team 100/250", "page 100", "page 200"]);
  later.resolve();
  expect(await read).toEqual({ loaded: 250, total: 250 });
  expect(log.slice(6)).toEqual(["saved 100", "landed 200", "saved 50", "landed 250"]);
});

test("a board whose first page fails is never shown", async () => {
  let shown = false;
  const read = readWholeBoard({
    page: async () => {
      throw new Error("Jira 503");
    },
    columns: async () => ({ id: 7, name: "Team", columns: [] }),
    save: () => {},
    shown: () => (shown = true),
    pageSize: 100,
    parallel: 4,
  });
  await expect(read).rejects.toThrow("Jira 503");
  expect(shown).toBe(false);
});

test("BJ-338: a board shown after its first page still counts as on its first sync until every page is read", () => {
  const states = [
    { id: 1, progress: { loaded: 100, total: 900 } }, // shown, still reading
    { id: 2, progress: { loaded: 400, total: 500 } }, // a later full sync of a board read before
    { id: 3, error: "Jira rejected your token (401)." },
    { id: 4, error: "Jira rejected your token (401)." },
  ];
  expect(syncHealthOf(states, (board) => board === 2)).toEqual({
    errors: ["Jira rejected your token (401)."],
    syncing: [{ board: 1, loaded: 100, total: 900 }],
  });
});
