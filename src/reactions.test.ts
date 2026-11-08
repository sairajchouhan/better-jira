import { expect, test } from "bun:test";
import { searchEmoji } from "./reactions";

test("emoji search ranks exact names first and knows common aliases (R1-D77)", () => {
  expect(searchEmoji("eyes")[0]).toBe("👀");
  expect(searchEmoji("heart")[0]).toBe("❤️");
  expect(searchEmoji("smile")[0]).toBe("😄");
  expect(searchEmoji("thumbsup")[0]).toBe("👍");
  expect(searchEmoji(":+1:")[0]).toBe("👍");
  expect(searchEmoji("goggles")).toEqual(["🥽"]);
});
