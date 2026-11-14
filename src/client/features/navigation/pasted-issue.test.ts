import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { browseURL, opensNewTab, pastedIssue, pastedRow } from "./pasted-issue";

const place = { site: "https://acme.atlassian.net", origin: "http://localhost:4000" };
const read = (q: string) => pastedIssue(q, place);

test("a /browse/ link on this Jira site names its issue, with a trailing slash, a query or a lower-case key", () => {
  expect(read("https://acme.atlassian.net/browse/DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("  https://acme.atlassian.net/browse/DRFT-970/  ")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("https://acme.atlassian.net/browse/DRFT-970?focusedCommentId=12#c")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("https://acme.atlassian.net/browse/drft-970")).toEqual({ kind: "link", key: "DRFT-970" });
});

test("a board or list link on this Jira site names its selectedIssue", () => {
  expect(read("https://acme.atlassian.net/jira/software/c/projects/DRFT/boards/12?selectedIssue=DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("https://acme.atlassian.net/jira/software/c/projects/DRFT/boards/12")).toBeUndefined();
});

test("this app's issue page, its document page and a list's ?issue= name the issue; a relative path is this app's", () => {
  expect(read("http://localhost:4000/issue/DRFT-970/some-title")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("http://localhost:4000/issue/DRFT-970/document/d1")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("http://localhost:4000/board/3/all?issue=DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("/issue/DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("http://localhost:4000/inbox")).toBeUndefined();
});

test("a link is completed as Linear's sEt completes it: protocol-relative and scheme-less links get https", () => {
  expect(read("//acme.atlassian.net/browse/DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
  expect(read("acme.atlassian.net/browse/DRFT-970")).toEqual({ kind: "link", key: "DRFT-970" });
});

test("an issue link on another Atlassian site is elsewhere; any other link names nothing", () => {
  expect(read("https://other.atlassian.net/browse/PX-3")).toEqual({ kind: "elsewhere" });
  expect(read("https://other.atlassian.net/jira/software/projects/PX/boards/1?selectedIssue=PX-3")).toEqual({ kind: "elsewhere" });
  expect(read("https://other.atlassian.net/wiki/spaces/ENG")).toBeUndefined();
  expect(read("https://github.com/acme/widgets/pull/42")).toBeUndefined();
  expect(read("https://acme.atlassian.net/browse/not a key")).toBeUndefined();
});

test("text with whitespace around a slash is a search, not a link (Linear's aEt)", () => {
  expect(read("see https://acme.atlassian.net/browse/DRFT-970")).toBeUndefined();
  expect(read("/issue/DRFT-970/fix the login")).toBeUndefined();
});

test("a key typed alone names its issue, hyphen optional, any case; a one-letter prefix is no Jira key", () => {
  expect(read("drft-970")).toEqual({ kind: "key", key: "DRFT-970" });
  expect(read("drft970")).toEqual({ kind: "key", key: "DRFT-970" });
  expect(read("DRFT 970")).toEqual({ kind: "key", key: "DRFT-970" });
  expect(read("v2")).toBeUndefined();
  expect(read("hello")).toBeUndefined();
});

test("the server reads an issue by its /browse/ page", () => {
  expect(browseURL("https://acme.atlassian.net", "DRFT-970")).toBe("https://acme.atlassian.net/browse/DRFT-970");
});

const issue = { key: "DRFT-970", summary: "Fix it" } as Issue;
const details = { title: "Fix it", status: { name: "In Review", category: "indeterminate" } };

test("the store's issue is the row, opening here, before any server read", () => {
  expect(pastedRow({ kind: "link", key: "DRFT-970" }, issue, details)).toEqual({ kind: "app", issue });
  expect(pastedRow({ kind: "key", key: "DRFT-970" }, issue, undefined)).toEqual({ kind: "app", issue });
});

test("an issue only Jira has is the server's read, once it answers", () => {
  expect(pastedRow({ kind: "link", key: "OPS-7" }, undefined, details)).toEqual({ kind: "jira", key: "OPS-7", details });
  expect(pastedRow({ kind: "key", key: "OPS-7" }, undefined, details)).toEqual({ kind: "jira", key: "OPS-7", details });
  expect(pastedRow({ kind: "link", key: "OPS-7" }, undefined, undefined)).toBeUndefined();
});

test("a link no issue answers says so; a typed key Jira doesn't know adds no row", () => {
  expect(pastedRow({ kind: "link", key: "OPS-404" }, undefined, null)).toEqual({ kind: "missing" });
  expect(pastedRow({ kind: "elsewhere" }, undefined, undefined)).toEqual({ kind: "missing" });
  expect(pastedRow({ kind: "key", key: "OPS-404" }, undefined, null)).toBeUndefined();
  expect(pastedRow(undefined, undefined, undefined)).toBeUndefined();
});

test("⌘ on a Mac, Ctrl elsewhere, opens the pick in a new tab", () => {
  expect(opensNewTab({ metaKey: true, ctrlKey: false }, true)).toBe(true);
  expect(opensNewTab({ metaKey: false, ctrlKey: true }, true)).toBe(false);
  expect(opensNewTab({ metaKey: false, ctrlKey: true }, false)).toBe(true);
  expect(opensNewTab({ metaKey: true, ctrlKey: false }, false)).toBe(false);
});
