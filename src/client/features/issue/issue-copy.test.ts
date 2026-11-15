import { type Issue } from "@/shared/issue-model";
import { afterEach, expect, test } from "bun:test";
import { adfToMarkdown, copyIssue, copyKinds, copyShortcuts, copyToast, fillPrompt, ID_LINK_COPIED, issueCopy, PAGE_URL_COPIED } from "./issue-copy";
import { deferred, fakeClipboard } from "@/client/test/fake-clipboard";
import { modifiers } from "@/client/lib/modifier-keys";
import { toasts } from "@/client/components/toast-queue";
import { get, set } from "@/client/state/store";
import type { ReactElement } from "react";
/** The newest toast's text. */
const lastToast = () => (toasts.all().at(-1)?.content as ReactElement<{ notice: { text: string } }> | undefined)?.props.notice.text;
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
  // Linear's `uM`: "KEY: Title", only brackets escaped, the URL as it is.
  expect(issueCopy("title as link", issue, undefined, "https://example.test/browse/TEST-1", "Todo")).toBe(
    "[TEST-1: Fix \\[menu\\]](https://example.test/browse/TEST-1)",
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

const copied: Issue = {
  key: "KAN-7",
  boards: [1],
  summary: "Fix [the menu](https://x.test/m) <now>",
  status: "todo",
  assignee: null,
  labels: [],
  updated: "",
  resolved: null,
  comments: 0,
};
const KAN_7 = "https://example.test/browse/KAN-7";
let clip: ReturnType<typeof fakeClipboard> | undefined;
const realFetch = globalThis.fetch;
afterEach(() => {
  clip?.restore();
  clip = undefined;
  (modifiers as { altKey: boolean }).altKey = false;
  globalThis.fetch = realFetch;
});

test("Copy title as link puts Linear's HTML anchor and the Markdown link on the clipboard", async () => {
  clip = fakeClipboard();
  await copyIssue("title as link", copied, KAN_7);
  expect(clip.writes).toEqual([
    {
      "text/html": `<a href="${KAN_7}">KAN-7: Fix the menu &lt;now&gt;&#8203;</a>`,
      "text/plain": `[KAN-7: Fix the menu <now>](${KAN_7})`,
    },
  ]);
  expect(lastToast()).toBe("Issue title copied to clipboard");
});

test("Copy ID copies the key, and with ⌥ held copies it as a link", async () => {
  clip = fakeClipboard();
  await copyIssue("ID", copied, KAN_7);
  expect(clip.writes).toEqual([{ "text/plain": "KAN-7" }]);
  (modifiers as { altKey: boolean }).altKey = true;
  await copyIssue("ID", copied, KAN_7);
  expect(clip.writes[1]).toEqual({ "text/html": `<a href="${KAN_7}">KAN-7&#8203;</a>`, "text/plain": `[KAN-7](${KAN_7})` });
  expect(lastToast()).toBe(ID_LINK_COPIED.text);
});

test("⌥ Copy ID copies the plain key where the browser has no ClipboardItem", async () => {
  clip = fakeClipboard({ rich: false });
  (modifiers as { altKey: boolean }).altKey = true;
  await copyIssue("ID", copied, KAN_7);
  expect(clip.writes).toEqual([{ "text/plain": "KAN-7" }]);
});

test("Copy everything as Markdown starts the clipboard write before the issue's comments load", async () => {
  clip = fakeClipboard();
  const response = deferred<Response>();
  globalThis.fetch = (() => response.promise) as unknown as typeof fetch;
  const issue = { ...copied, key: "KAN-8" }, issues = get().issues;
  set({ issues: new Map(issues).set(issue.key, issue) });
  const done = copyIssue("everything as Markdown", issue, KAN_7);
  expect(clip.calls).toEqual(["write"]);
  response.resolve(
    new Response(JSON.stringify({ key: "KAN-8", fields: { description: null, comment: { comments: [] } } })),
  );
  await done;
  expect(clip.writes[0]?.["text/plain"]).toStartWith("# KAN-8 Fix");
  expect(lastToast()).toBe('Issue "KAN-8" content copied to clipboard');
  set({ issues });
});
