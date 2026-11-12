import { expect, test } from "bun:test";
import { fuzzyScore } from "./fuzzy-score";

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
