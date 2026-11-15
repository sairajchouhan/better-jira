import { expect, test } from "bun:test";
import { initialOf, jiraUser, UNKNOWN_USER } from "./person-name";

test("a Jira account without a name still has one, and an initial; nothing throws on a malformed record", () => {
  expect(jiraUser({ accountId: "a1", displayName: "Ada Example" }).name).toBe("Ada Example");
  expect(jiraUser({ accountId: "a2" }).name).toBe(UNKNOWN_USER);
  expect(jiraUser({ accountId: "a3", displayName: "  " }).name).toBe(UNKNOWN_USER);
  // The fixture's create answered an assignee as a bare string; the board went blank on `name[0]` (ship bar blocker 3).
  expect(jiraUser("a4")).toMatchObject({ id: "a4", name: UNKNOWN_USER });
  expect(initialOf("Ada")).toBe("A");
  expect(initialOf("🦊 Fox")).toBe("🦊");
  for (const missing of [undefined, null, "", "  "]) expect(initialOf(missing)).toBe("?");
});
