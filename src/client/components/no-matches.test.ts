import { expect, test } from "bun:test";
import { splitByMatches } from "./no-matches";

const opts = (counts: number[]) => counts.map((count, i) => ({ id: i, count }));

test("fewer than ten options are all listed inline, as Linear's a<10 keeps them", () => {
  const { matched, unmatched } = splitByMatches(opts([3, 0, 0, 0, 0, 0, 0, 0, 0]), (o) => o.count, () => false);
  expect(matched.length).toBe(9);
  expect(unmatched).toEqual([]);
});

test("ten or more split off the zero-count options, but never a selected one", () => {
  const { matched, unmatched } = splitByMatches(opts([3, 0, 2, 0, 0, 0, 0, 0, 0, 0]), (o) => o.count, (o) => o.id === 1);
  expect(matched.map((o) => o.id)).toEqual([0, 1, 2]);
  expect(unmatched.map((o) => o.id)).toEqual([3, 4, 5, 6, 7, 8, 9]);
});
