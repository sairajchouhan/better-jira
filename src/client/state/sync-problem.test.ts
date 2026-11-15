import { expect, test } from "bun:test";
import { syncProblem, syncProgress } from "./sync-problem";

const fine = { errors: [], syncing: [] };
test("the footer warns when the server is gone or Jira can't be read, and is quiet otherwise", () => {
  expect(syncProblem(fine, false)).toBe("");
  expect(syncProblem(undefined, false)).toBe("");
  expect(syncProblem(fine, true)).toContain("Can't reach the better-jira server");
  expect(syncProblem({ errors: ["Jira rejected your email and API token (401)."], syncing: [] }, false)).toBe(
    "Not syncing with Jira: Jira rejected your email and API token (401).",
  );
});

test("a first sync says how far each board has got", () => {
  expect(syncProgress({ errors: [], syncing: [{ board: 12, loaded: 1200, total: 5400 }] })).toBe(
    "Board 12: 1,200 of 5,400 issues",
  );
  expect(syncProgress(fine)).toContain("settings");
});
