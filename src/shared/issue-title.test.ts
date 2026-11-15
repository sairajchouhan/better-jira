import { expect, test } from "bun:test";
import { fitTitle, passesTitleLimit, TITLE_MAX, TITLE_TOO_LONG } from "./issue-title";

test("BJ-270: Jira's 255-character limit, in Linear's wording", () => {
  expect(TITLE_MAX).toBe(255);
  expect(TITLE_TOO_LONG).toBe("Title cannot be longer than 255 characters.");
});

test("BJ-270: a title made from other text is cut to the limit, never mid surrogate pair", () => {
  expect(fitTitle("short")).toBe("short");
  expect(fitTitle("x".repeat(300))).toHaveLength(255);
  const emoji = "x".repeat(254) + "😀";
  expect(fitTitle(emoji)).toBe("x".repeat(254));
});

test("BJ-270: an insert passes the limit only when the field would end up longer than it", () => {
  expect(passesTitleLimit({ length: 254, start: 254, end: 254 }, "a")).toBe(false);
  expect(passesTitleLimit({ length: 255, start: 255, end: 255 }, "a")).toBe(true);
  // Typing over a selection replaces it.
  expect(passesTitleLimit({ length: 255, start: 0, end: 1 }, "a")).toBe(false);
  expect(passesTitleLimit({ length: 200, start: 200, end: 200 }, "y".repeat(60))).toBe(true);
});
