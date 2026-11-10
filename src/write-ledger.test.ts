import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { LEDGER_MAX_AGE_MS, writeLedger } from "./write-ledger";

test("sync review 9: the write ledger drops rows older than its age limit, keeping older builds' rows and recent ones", () => {
  const db = new Database(":memory:");
  // A ledger an older build made: no times.
  db.run("CREATE TABLE created_issues (client TEXT PRIMARY KEY, key TEXT NOT NULL)");
  db.run("INSERT INTO created_issues VALUES ('old-build', 'K-1')");
  let now = 1_000_000_000_000;
  const ledger = writeLedger(db, () => now);
  expect(ledger.made("old-build")?.key).toBe("K-1");
  ledger.remember("comment:a", "10");
  now += LEDGER_MAX_AGE_MS / 2;
  ledger.intend("upload:b");
  now += LEDGER_MAX_AGE_MS / 2 + 1;
  ledger.prune();
  expect(ledger.made("old-build")).toBe(undefined);
  expect(ledger.made("comment:a")).toBe(undefined);
  expect(ledger.made("upload:b")).toEqual({
    key: "",
    at: 1_000_000_000_000 + LEDGER_MAX_AGE_MS / 2,
  });
});
