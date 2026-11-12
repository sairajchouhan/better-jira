import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { historyCache, MAX_VALUE, readHistory, slimHistory } from "./issue-history";

const entry = (id: number, items: any[], author: any = { accountId: "u1", displayName: "Ada Example" }) => ({
  id: String(id),
  created: "2026-01-02T03:04:05.000-0800",
  author,
  items,
});

test("BJ-13: the changelog is slimmed: document text dropped, long values cut, apps marked", () => {
  const [a, b] = slimHistory([
    entry(1, [
      { field: "description", fieldtype: "jira", fieldId: "description", fromString: "old body", toString: "new body" },
      { field: "summary", fieldtype: "jira", fieldId: "summary", fromString: "x".repeat(500), toString: "Short" },
    ]),
    entry(2, [{ field: "Team", fieldtype: "custom", fieldId: "customfield_1", to: "team-1", toString: "Builders" }], {
      accountId: "bot",
      displayName: "Automation for Jira",
      accountType: "app",
    }),
  ]);
  expect(a!.at).toBe("2026-01-02T11:04:05.000Z");
  expect(a!.items[0]).toMatchObject({ field: "description", fromString: "", toString: "" });
  expect(a!.items[1]!.fromString).toHaveLength(MAX_VALUE);
  expect(a!.items[1]!.toString).toBe("Short");
  expect(a!.actor?.app).toBeUndefined();
  expect(b!.actor).toMatchObject({ id: "bot", app: true });
  expect(b!.items[0]).toMatchObject({ custom: true, from: null, to: "team-1" });
});

test("BJ-13: every changelog page is read, oldest first", async () => {
  const paths: string[] = [];
  const all = Array.from({ length: 230 }, (_, i) => entry(i, []));
  const history = await readHistory(async (path: string) => {
    paths.push(path);
    const start = Number(new URL(path, "https://x").searchParams.get("startAt"));
    return { total: all.length, values: all.slice(start, start + 100) } as any;
  }, "TEST-1");
  expect(history.map((h) => h.id)).toEqual(all.map((e) => e.id));
  expect(paths).toHaveLength(3);
});

test("BJ-13: history is cached until Jira's updated stamp moves", async () => {
  const db = new Database(":memory:");
  let stamp = "one",
    reads = 0;
  const read = historyCache(
    db,
    async () => {
      reads++;
      return [];
    },
    () => stamp,
  );
  await read("TEST-1");
  await read("TEST-1");
  expect(reads).toBe(1);
  stamp = "two";
  await read("TEST-1");
  expect(reads).toBe(2);
});
