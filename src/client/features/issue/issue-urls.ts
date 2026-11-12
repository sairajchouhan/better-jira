/** Where an issue opens: in Jira, or in this app for an issue Jira doesn't have yet. */
import { isLocalIssue } from "@/client/state/local-edits";
import { get, type Issue } from "@/client/state/store";

export function jiraIssueURL(key: string) {
  return `${get().site}/browse/${encodeURIComponent(key)}`;
}
/** The issue in this app, for links that open here (and in a new tab with ⌘-click). */
export function appURL(issue: Issue) {
  const url = new URL(location.origin);
  url.searchParams.set("board", String(issue.board));
  url.searchParams.set("issue", issue.key);
  return url.href;
}
export function issueURL(issue: Issue) {
  return isLocalIssue(issue.key) && typeof location !== "undefined"
    ? appURL(issue)
    : jiraIssueURL(issue.key);
}
