import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { adfToMarkdown, copyToast, issueCopy, PAGE_URL_COPIED } from "./issue-copy";

test("clipboard projections retain rich formatting, tables and exact IDs/URLs", () => {
  const issue: Issue = {
    key: "TEST-1",
    board: 1,
    summary: "Fix [menu]",
    status: "todo",
    assignee: null,
    labels: ["ui"],
    updated: "",
    resolved: null,
    comments: 0,
  };
  expect(issueCopy("ID", issue, undefined, "https://example.test/browse/TEST-1", "Todo")).toBe(
    "TEST-1",
  );
  expect(issueCopy("URL", issue, undefined, "https://example.test/browse/TEST-1", "Todo")).toBe(
    "https://example.test/browse/TEST-1",
  );
  expect(issueCopy("title as link", issue, undefined, "https://example.test/a(b)", "Todo")).toBe(
    "[TEST-1 Fix \\[menu\\]](https://example.test/a%28b%29)",
  );
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "A|B" }] };
  const table = {
    type: "table",
    content: [{ type: "tableRow", content: [{ type: "tableHeader", content: [paragraph] }] }],
  };
  const bold = {
    type: "paragraph",
    content: [{ type: "text", text: "Rich", marks: [{ type: "strong" }] }],
  };
  expect(adfToMarkdown({ type: "doc", content: [bold, table] })).toBe(
    "**Rich**\n\n| A\\|B |\n| --- |",
  );
});

test("I18: the git branch name starts with the user's name, like Linear", () => {
  const issue: Issue = {
    key: "DRFT-53",
    board: 1,
    summary: "Fix the menu!",
    status: "todo",
    assignee: null,
    labels: [],
    updated: "",
    resolved: null,
    comments: 0,
  };
  expect(issueCopy("git branch name", issue, undefined, "", "Todo", "Sairaj Chouhan")).toBe(
    "sairaj/drft-53-fix-the-menu",
  );
  expect(issueCopy("git branch name", issue, undefined, "", "Todo")).toBe("drft-53-fix-the-menu");
});

test("R3-issue-fields-D3/D4: Copy title carries the ID and every copy action has Linear's toast", () => {
  const issue: Issue = {
    key: "KAN-7",
    board: 1,
    summary: "Fix the menu",
    status: "todo",
    assignee: null,
    labels: [],
    updated: "",
    resolved: null,
    comments: 0,
  };
  const url = "https://example.test/browse/KAN-7";
  const toast = (kind: Parameters<typeof issueCopy>[0]) =>
    copyToast(kind, issue, issueCopy(kind, issue, undefined, url, "Todo", "Ann Lee"));
  expect(issueCopy("title", issue, undefined, url, "Todo")).toBe("KAN-7: Fix the menu");
  expect(toast("ID")).toEqual({ text: '"KAN-7" copied to clipboard' });
  expect(toast("title")).toEqual({ text: '"KAN-7: Fix the menu" copied to clipboard' });
  expect(toast("URL")).toEqual({ text: "Copied issue link to clipboard", icon: "copy" });
  expect(toast("title as link")).toEqual({ text: "Issue title copied to clipboard" });
  expect(toast("issue as Markdown")).toEqual({ text: 'Issue "KAN-7" description copied to clipboard' });
  expect(toast("everything as Markdown")).toEqual({ text: 'Issue "KAN-7" content copied to clipboard' });
  expect(toast("git branch name")).toEqual({
    text: "ann/kan-7-fix-the-menu",
    detail: "Branch name copied to clipboard. Paste it into your favorite git client.",
  });
  expect(PAGE_URL_COPIED.text).toBe("Current URL copied to clipboard");
});
