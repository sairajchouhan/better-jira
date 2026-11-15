import { type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { adfToMarkdown, copyKinds, copyShortcuts, copyToast, fillPrompt, issueCopy, PAGE_URL_COPIED } from "./issue-copy";
import { CODING_TOOLS, promptLink, TRUNCATED } from "./coding-tools";

test("clipboard projections retain rich formatting, tables and exact IDs/URLs", () => {
  const issue: Issue = {
    key: "TEST-1",
    boards: [1],
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
    boards: [1],
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
    boards: [1],
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

test("B5: Copy as prompt fills Linear's template with the key, the branch and the issue as Markdown, and toasts Linear's line", () => {
  const issue: Issue = {
    key: "DRFT-7",
    boards: [1],
    summary: "Fix the menu",
    status: "todo",
    assignee: null,
    labels: ["ui"],
    updated: "",
    resolved: null,
    comments: 0,
    description: "Steps here.",
  };
  const prompt = issueCopy("as prompt", issue, undefined, "", "Todo", "Ada Lovelace");
  expect(prompt).toBe(
    `Work on Jira issue DRFT-7:\n\nSuggested branch name: ada/drft-7-fix-the-menu\n\n${issueCopy("everything as Markdown", issue, undefined, "", "Todo")}`,
  );
  expect(prompt).toContain("Steps here.");
  expect(fillPrompt({ "issue.identifier": "A-1", "issue.branchName": "b", context: "c" }, "{{context}} {{issue.identifier}} {{other}}")).toBe(
    "c A-1 {{other}}",
  );
  expect(copyToast("as prompt", issue, prompt)).toEqual({ text: "Prompt copied to clipboard", icon: "copy" });
  // Linear's Copy submenu lists it last, after the branch, with ⌘⌥P.
  expect(copyKinds.at(-1)).toBe("as prompt");
  expect(copyShortcuts["as prompt"]).toBe("copy-prompt");
});

test("B5: a coding tool's deep link carries the prompt, cut to the tool's limit with Linear's truncation note", () => {
  const byId = (id: string) => CODING_TOOLS.find((t) => t.id === id)!;
  expect(CODING_TOOLS.map((t) => t.name)).toEqual(["Claude Code desktop", "Codex desktop", "Cursor", "T3 Code"]);
  expect(byId("t3Code").link("Work on A-1")).toBe("t3code://new?prompt=Work%20on%20A-1");
  expect(byId("claudeCodeDesktop").link("a b")).toBe("claude://code/new?q=a%20b");
  expect(byId("codex").link("a b")).toBe("codex://new?prompt=a%20b");
  // Cursor's link encodes the prompt twice.
  expect(byId("cursor").link("a b")).toBe("cursor://anysphere.cursor-deeplink/prompt?text=a%2520b");
  const long = "x".repeat(5000);
  const link = byId("t3Code").link(long);
  expect(link.length).toBeLessThanOrEqual(2000);
  expect(decodeURIComponent(link.slice("t3code://new?prompt=".length)).endsWith(TRUNCATED)).toBe(true);
  // The longest start that fits: one more character would not.
  const kept = decodeURIComponent(link.slice("t3code://new?prompt=".length)).length - TRUNCATED.length;
  expect(`t3code://new?prompt=${encodeURIComponent(long.slice(0, kept + 1) + TRUNCATED)}`.length).toBeGreaterThan(2000);
  expect(promptLink("short", (p) => p, 2000)).toBe("short");
  expect(byId("cursor").link(long).length).toBeLessThanOrEqual(8000);
  expect(byId("cursor").link("x".repeat(1500))).not.toContain("Truncated");
});
