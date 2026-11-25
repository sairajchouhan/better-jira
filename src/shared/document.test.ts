import { expect, test } from "bun:test";
import { descriptionBases, descriptionBaseText } from "./document";

test("descriptionBaseText preserves the wire-stable conflict base format across builds", () => {
  const doc = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "See " },
          { type: "inlineCard", attrs: { url: "https://example.atlassian.net/browse/APP-1" } },
        ],
      },
      {
        type: "blockCard",
        attrs: { url: "https://github.com/org/repo/pull/42" },
      },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [{ type: "paragraph", content: [{ type: "text", text: "First item" }] }],
          },
        ],
      },
    ],
  };

  expect(descriptionBaseText(doc)).toBe(
    "See https://example.atlassian.net/browse/APP-1\n\nhttps://github.com/org/repo/pull/42\n\n- First item",
  );
  expect(descriptionBases(doc)).toEqual([
    "See https://example.atlassian.net/browse/APP-1\n\nhttps://github.com/org/repo/pull/42\n\n- First item",
    "See APP-1\n\norg/repo#42\n\n- First item",
    "See https://example.atlassian.net/browse/APP-1\n\n\n\n- First item",
  ]);
});
