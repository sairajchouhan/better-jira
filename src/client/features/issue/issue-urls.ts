import { type Issue } from "@/shared/issue-model";
import { placeURL } from "@/client/features/navigation/app-navigation";
/** Where an issue opens: in Jira, or in this app for an issue Jira doesn't have yet. */
import { isLocalIssue } from "@/client/state/local-edits";
import { get } from "@/client/state/store";

export function jiraIssueURL(key: string) {
  return `${get().site}/browse/${encodeURIComponent(key)}`;
}
/** The issue in this app, for links that open here (and in a new tab with ⌘-click). */
export function appURL(issue: Issue) {
  return placeURL({ to: "issue", key: issue.key });
}
export function issueURL(issue: Issue) {
  return isLocalIssue(issue.key) && typeof location !== "undefined"
    ? appURL(issue)
    : jiraIssueURL(issue.key);
}
