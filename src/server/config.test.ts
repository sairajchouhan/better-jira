import { describe, expect, test } from "bun:test";
import { configuration, withAddedBoard, withoutAddedBoard, type LocalSettings } from "./config";

const ENV = {
  JIRA_URL: "https://team.atlassian.net",
  JIRA_EMAIL: "dev@team.com",
  JIRA_TOKEN: "secret",
  JIRA_BOARDS: "10,20",
};

describe("board add/remove persistence in LocalSettings", () => {
  test("removing a board hides setup/env boards and re-adding brings them back", () => {
    const site = "https://team.atlassian.net";
    let local: LocalSettings = { site, boards: [10, 20] };

    // Remove board 10 (configured in both env JIRA_BOARDS and settings.boards).
    local = withoutAddedBoard(local, site, 10);
    expect(local.boards).toEqual([20]);
    expect(local.removedBoards?.[site]).toEqual([10]);
    expect(configuration(ENV, local).boards).toEqual([20]);

    // Add board 30 from the app.
    local = withAddedBoard(local, site, 30);
    expect(configuration(ENV, local).boards).toEqual([20, 30]);

    // Re-add board 10: clears it from removedBoards and puts it back.
    local = withAddedBoard(local, site, 10);
    expect(local.removedBoards?.[site]).toEqual([]);
    expect(configuration(ENV, local).boards).toEqual([10, 20, 30]);
  });

  test("removing every board leaves configuration throwing a clear error", () => {
    const site = "https://team.atlassian.net";
    let local: LocalSettings = { site, boards: [10] };
    local = withoutAddedBoard(local, site, 10);
    expect(() => configuration({ ...ENV, JIRA_BOARDS: "10" }, local)).toThrow(/No Jira boards are chosen/);
  });
});
