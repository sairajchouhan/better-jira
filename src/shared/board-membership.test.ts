import { expect, test } from "bun:test";
import { boardFor, onBoard, rejoinBoards, sharesBoard, withMembership } from "./board-membership";

const shared = { key: "TEAM-1", boards: [1, 2] },
  team = { key: "TEAM-2", boards: [1] },
  linked = { key: "OTHER-9", boards: [] as number[] };

test("an issue on two boards is on each of them, and on no other", () => {
  expect([1, 2, 3].map((b) => onBoard(shared, b))).toEqual([true, true, false]);
  expect(onBoard(shared, undefined)).toBe(false);
  expect(onBoard(linked, 1)).toBe(false);
  expect(sharesBoard(shared, team)).toBe(true);
  expect(sharesBoard(linked, team)).toBe(false);
});

test("an issue opens on the board on screen when that holds it, else its first board, else the board on screen", () => {
  expect(boardFor(shared, 2)).toBe(2);
  expect(boardFor(shared, 1)).toBe(1);
  expect(boardFor(team, 2)).toBe(1);
  expect(boardFor(linked, 2)).toBe(2);
  expect(boardFor(undefined, 3)).toBe(3);
});

test("an issue saved with one board reads as that board's list", () => {
  expect(withMembership({ key: "A-1", board: 2 })).toEqual({ key: "A-1", boards: [2] });
  expect(withMembership({ key: "A-1", boards: [1, 2] })).toEqual({ key: "A-1", boards: [1, 2] });
  expect(withMembership({ key: "A-1" })).toEqual({ key: "A-1", boards: [] });
});

test("adding a board brings its issues and puts shared ones on it too; removing one takes it off, and drops issues left on none", () => {
  const local = new Map([
    [shared.key, { ...shared, boards: [1], summary: "edited here" }],
    [team.key, { ...team, summary: "team" }],
  ]);
  const squad = { key: "SQUAD-1", boards: [2], summary: "squad" };
  const added = rejoinBoards(local, [{ ...shared, summary: "server" }, { ...team, summary: "server" }, squad], new Set([1]));
  expect(added.get("TEAM-1")).toEqual({ key: "TEAM-1", boards: [1, 2], summary: "edited here" });
  expect(added.get("TEAM-2")).toEqual({ key: "TEAM-2", boards: [1], summary: "team" });
  expect(added.get("SQUAD-1")).toEqual(squad);
  // A missing issue on a board the tab already had stays missing (a local delete).
  expect(rejoinBoards(new Map(), [team], new Set([1])).size).toBe(0);

  const removed = rejoinBoards(added, [], new Set([1, 2]), new Set([2]));
  expect(removed.get("TEAM-1")?.boards).toEqual([1]);
  expect(removed.has("SQUAD-1")).toBe(false);
  expect(removed.get("TEAM-2")?.boards).toEqual([1]);
});
