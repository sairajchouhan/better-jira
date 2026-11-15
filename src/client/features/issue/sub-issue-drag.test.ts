import { expect, test } from "bun:test";
import { subIssueDragItem } from "./sub-issues";
import { get, set } from "@/client/state/store";

test("a dragged sub-issue row carries its Jira link, and its key under the sub-issue type", () => {
  const site = get().site;
  set({ site: "https://example.test" });
  try {
    expect(subIssueDragItem("KAN-9")).toEqual({
      "application/x-better-jira-sub-issue": "KAN-9",
      "text/uri-list": "https://example.test/browse/KAN-9",
      "text/plain": "https://example.test/browse/KAN-9",
      "text/html": '<a href="https://example.test/browse/KAN-9">https://example.test/browse/KAN-9</a>',
    });
  } finally {
    set({ site });
  }
});
