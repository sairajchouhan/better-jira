import { expect, test } from "bun:test";
import { fuzzyScore, menuFilter } from "./fuzzy-score";

test("BJ-180: Linear's search score ranks exact, then prefix, then word-start, then mid-word matches", () => {
  expect(fuzzyScore("tada", "tada")).toBe(1);
  expect(fuzzyScore("Tada", "tada")).toBe(0.9999);
  const prefix = fuzzyScore("tada", "ta"),
    word = fuzzyScore("party_tada", "ta"),
    inner = fuzzyScore("potato", "ta");
  expect(prefix).toBeGreaterThan(word);
  expect(word).toBeGreaterThan(inner);
  expect(fuzzyScore("tada", "zz")).toBe(0);
  expect(fuzzyScore(["nope", "tada"], "tada")).toBe(1);
});

test("FILTER-5: the shared menu filter ranks by Linear's score and searches a row by its keywords instead of its id", () => {
  // "to" finds Status › To Do first: a word-start label match beats a category whose name only contains it mid-word.
  expect(menuFilter("Status To Do todo", "to", ["To Do"])).toBeGreaterThan(menuFilter("Creator", "to"));
  for (const [label, query] of [["To Do", "todo"], ["In Progress", "inprog"], ["Assignee", "asign"]])
    expect(menuFilter(label!, query!)).toBeGreaterThan(0);
  expect(menuFilter("Status", "revi")).toBe(0);
  // A value is matched on its label: the path and the id in its value don't make it match.
  expect(menuFilter("Status To Do todo", "status", ["To Do"])).toBe(0);
});
