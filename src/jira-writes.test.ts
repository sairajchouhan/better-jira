import { expect, mock, test } from "bun:test";

// Jira's remote links for the issue, and the calls the write made.
let links: any[] = [];
const calls: string[] = [];
mock.module("./jira", () => ({
  JiraError: class extends Error {},
  jira: async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return path.endsWith("/remotelink") && !init?.method ? links : {};
  },
}));
mock.module("./mirror", () => ({
  ESTIMATES: [],
  refresh: async () => undefined,
}));
const { applyOps } = await import("./jira-writes");

test("R1-D1: a web link Jira already has, added in Jira's UI under another globalId, is not posted again", async () => {
  links = [{ id: 7, globalId: "jira-ui-1", object: { url: "https://a.test/", title: "A" } }];
  calls.length = 0;
  expect(
    (await applyOps("K-1", [{ op: "weblink", url: "https://a.test/", title: "A" }])).error,
  ).toBe(undefined);
  expect(calls).toEqual(["GET /rest/api/3/issue/K-1/remotelink"]);
  // Removing it deletes that link by id, which a globalId delete would miss.
  calls.length = 0;
  await applyOps("K-1", [{ op: "weblink", url: "https://a.test/", title: "A", remove: true }]);
  expect(calls).toEqual([
    "GET /rest/api/3/issue/K-1/remotelink",
    "DELETE /rest/api/3/issue/K-1/remotelink/7",
  ]);
});
