import { expect, test } from "bun:test";
import { keptChildren, keptIssues } from "./kept-issues";

test("BJ-341: an issue the mirror lacks is read from Jira once and kept; one Jira lacks is not; one it has isn't read", async () => {
  const saved = new Map<string, unknown>([["TEAM-1", {}]]);
  const reads: string[] = [];
  const answer = Promise.withResolvers<void>();
  const kept = keptIssues({
    has: (key) => saved.has(key),
    read: async (key) => {
      reads.push(key);
      await answer.promise;
      if (key === "NONE-1") throw Object.assign(new Error("Jira 404"), { status: 404 });
      if (key === "DOWN-1") throw Object.assign(new Error("Jira 503"), { status: 503 });
      return { key };
    },
    save: (raw) => saved.set(raw.key, raw),
  });
  expect(await kept("TEAM-1")).toBe(true);
  // Two asks while the read is out share it.
  const asks = [kept("OTHER-9"), kept("OTHER-9"), kept("NONE-1")];
  const down = kept("DOWN-1").catch((error: Error) => error.message);
  answer.resolve();
  expect(await Promise.all(asks)).toEqual([true, true, false]);
  expect(await down).toBe("Jira 503");
  expect(reads).toEqual(["OTHER-9", "NONE-1", "DOWN-1"]);
  expect(saved.get("OTHER-9")).toEqual({ key: "OTHER-9" });
  // Kept now: no second read.
  expect(await kept("OTHER-9")).toBe(true);
  expect(reads).toHaveLength(3);
});

test("every issue is an issue: a parent's children in another project or on no board are kept when it opens, whatever its type", async () => {
  const saved = new Map<string, any>([["TEAM-2", { key: "TEAM-2", fields: { updated: "2026-01-02" } }]]);
  const searched: string[] = [];
  const children = keptChildren({
    search: async (key) => {
      searched.push(key);
      return [
        { key: "OTHER-7", fields: { updated: "2026-01-01" } },
        { key: "TEAM-2", fields: { updated: "2026-01-02" } },
      ];
    },
    updated: (key) => saved.get(key)?.fields.updated ?? "",
    save: (raw) => saved.set(raw.key, raw),
  });
  // A level-0 parent (a Spike, a Story…) is asked like an epic; the cross-project child is kept, the held one not saved again.
  expect(await children("TEAM-1", 0)).toBe(true);
  expect(saved.has("OTHER-7")).toBe(true);
  expect(await children("TEAM-1", 0)).toBe(false);
  // A sub-task has no children: Jira is not asked.
  expect(await children("TEAM-3", -1)).toBe(false);
  expect(searched).toEqual(["TEAM-1", "TEAM-1"]);
});
