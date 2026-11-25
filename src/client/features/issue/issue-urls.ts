import { type Issue } from "@/shared/issue-model";
import { placeURL } from "@/client/features/navigation/app-navigation";
/** Where an issue opens: in Jira, or in this app for an issue Jira doesn't have yet. */
import { isLocalIssue } from "@/client/state/local-edits";
import { get } from "@/client/state/store";

export function jiraIssueURL(key: string) {
  return `${get().site}/browse/${encodeURIComponent(key)}`;
}
/** The issue in this app, for links that open here (and in a new tab with ⌘-click). */
export function appURL(issue: Pick<Issue, "key">) {
  return placeURL({ to: "issue", key: issue.key });
}
export function issueURL(issue: Pick<Issue, "key">) {
  return isLocalIssue(issue.key) && typeof location !== "undefined"
    ? appURL(issue)
    : jiraIssueURL(issue.key);
}
/** The link an issue's row carries when dragged (Copy URL's link), from its key alone. */
export const issueKeyURL = (key: string) => issueURL({ key });
