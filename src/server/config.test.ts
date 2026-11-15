import { expect, test } from "bun:test";
import {
  boardFromInput,
  boardProject,
  boardIDs,
  configuration,
  siteURL,
  withAddedBoard,
  withoutAddedBoard,
} from "./config";
const env = {
  JIRA_URL: "https://example.atlassian.net/",
  JIRA_EMAIL: "person@example.invalid",
  JIRA_TOKEN: "test-only",
  JIRA_BOARDS: "12,34,12",
};
test("setup validates site and board IDs and separates caches by account and site", () => {
  const first = configuration(env);
  expect(first.site).toBe("https://example.atlassian.net");
  expect(first.boards).toEqual([12, 34]);
  expect(configuration({ ...env, JIRA_EMAIL: "another@example.invalid" }).cachePath).not.toBe(
    first.cachePath,
  );
  expect(configuration({ ...env, JIRA_URL: "https://other.atlassian.net" }).cachePath).not.toBe(
    first.cachePath,
  );
  expect(configuration(env, { cachePath: "my-cache.db" }).cachePath).toBe("my-cache.db");
  const saved = {
    site: "https://work.atlassian.net",
    boards: [9],
    port: 3000,
    cachePath: "cache.db",
  };
  expect(() => configuration({ ...env, JIRA_BOARDS: "" }, saved)).toThrow("JIRA_BOARDS");
  expect(configuration({ ...env, JIRA_BOARDS: "5" }, saved).cachePath).not.toBe("cache.db");
  expect(
    configuration({ ...env, JIRA_URL: "https://work.atlassian.net", JIRA_BOARDS: "" }, saved),
  ).toMatchObject({ boards: [9], cachePath: "cache.db" });
  for (const url of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/path",
    "https://example.com?token=x",
  ])
    expect(() => siteURL(url)).toThrow();
  for (const value of ["", "1,", "-1", "1.5", "NaN"]) expect(() => boardIDs(value)).toThrow();
  expect(() => configuration({ ...env, PORT: "0" })).toThrow();
  expect(() => configuration({ ...env, JIRA_TOKEN: "" })).toThrow("bun run setup");
});
test("boards added in the app join env or saved boards for their own site only", () => {
  const site = "https://example.atlassian.net",
    other = "https://work.atlassian.net";
  let local = withAddedBoard({ site: other, boards: [9] }, site, 7);
  local = withAddedBoard(local, site, 7);
  local = withAddedBoard(local, other, 8);
  expect(local.addedBoards).toEqual({ [site]: [7], [other]: [8] });
  // Env site: env boards plus its own added ones; the saved site's boards and additions stay out.
  expect(configuration(env, local).boards).toEqual([12, 34, 7]);
  // Saved site: its saved boards plus its additions.
  expect(configuration({ ...env, JIRA_URL: other, JIRA_BOARDS: "" }, local).boards).toEqual([9, 8]);
  // Added boards alone are enough.
  expect(configuration({ ...env, JIRA_BOARDS: "" }, withAddedBoard({}, site, 5)).boards).toEqual([
    5,
  ]);
});
test("board links and IDs parse to a board on the connected site", () => {
  const site = "https://example.atlassian.net";
  expect(boardFromInput(" 12 ", site)).toBe(12);
  expect(boardFromInput(`${site}/jira/software/projects/KAN/boards/1`, site)).toBe(1);
  expect(boardFromInput(`${site}/jira/software/c/projects/KAN/boards/34/backlog?x=1`, site)).toBe(
    34,
  );
  expect(boardFromInput(`${site}/secure/RapidBoard.jspa?rapidView=12&view=planning`, site)).toBe(
    12,
  );
  expect(() => boardFromInput("https://other.atlassian.net/jira/boards/1", site)).toThrow(
    "other.atlassian.net",
  );
  for (const bad of ["", "0", "KAN", `${site}/browse/KAN-1`, `${site}/jira/boards/1x`])
    expect(() => boardFromInput(bad, site)).toThrow();
});
test("BJ-24: a board added in the app can be removed again; setup's boards stay", () => {
  const site = "https://example.atlassian.net";
  const local = withAddedBoard(withAddedBoard({}, site, 7), site, 12);
  expect(configuration(env, local).setupBoards).toEqual([12, 34]);
  const removed = withoutAddedBoard(local, site, 7);
  expect(removed.addedBoards).toEqual({ [site]: [12] });
  expect(configuration(env, removed).boards).toEqual([12, 34]);
});

test("Ship should-fix: a board's project is its configuration's location, in either of Jira's field names; none outside a project", () => {
  expect(boardProject({ type: "project", key: "EMP", name: "Empty project" })).toEqual({ key: "EMP", name: "Empty project" });
  expect(boardProject({ type: "project", projectKey: "EMP", projectName: "Empty project" })).toEqual({ key: "EMP", name: "Empty project" });
  expect(boardProject({ type: "user", name: "Someone" })).toBeNull();
  expect(boardProject(undefined)).toBeNull();
});
