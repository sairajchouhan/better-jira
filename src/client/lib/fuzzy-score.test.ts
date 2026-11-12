import { expect, test } from "bun:test";
import { breadcrumbKeywords, breadcrumbScore, fuzzyScore, menuFilter, MIN_APPLICABILITY } from "./fuzzy-score";

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

test("5.10: a hoisted row scores by its breadcrumb as Linear's secondaryString, below an equal row of the menu itself", () => {
  // "status" finds Status › Todo by its breadcrumb, though "Todo" alone doesn't match it.
  expect(menuFilter("Status Todo todo", "status", ["Todo"])).toBe(0);
  const value = menuFilter("Status Todo todo", "status", breadcrumbKeywords("Todo", ["Status"]));
  expect(value).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  expect(value).toBeLessThan(menuFilter("Status", "status"));
  // Its own label still matches, 0.15 under the same label unhoisted.
  expect(breadcrumbScore(["Todo"], "Status Todo", "todo")).toBeCloseTo(fuzzyScore("Todo", "todo") - 0.15);
  // A weak hit of 3+ characters scores 0.34 when the label contains it, else 0.29 when the breadcrumb does; 2 characters don't.
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "ckin")).toBeCloseTo(MIN_APPLICABILITY + 0.1);
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "emov")).toBeCloseTo(MIN_APPLICABILITY + 0.05);
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "zq")).toBe(0);
});
