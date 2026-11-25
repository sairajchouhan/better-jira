import { useMemo } from "react";
import type { Issue, User } from "@/shared/issue-model";
import { jiraUser as accountUser } from "@/shared/person-name";

/** A Jira user record (`creator`, `reporter`, a comment's `author`) as this app's user; null for none. */
export const jiraUser = (a: any): User | null => (a ? accountUser(a) : null);

/**
 * BJ-14: who created the issue (its creator, not its reporter) and when, from the mirrored issue or else Jira's fields. One
 * object while those hold, so the description history built from it (Linear's `creation` version) is not rebuilt every render.
 * `fields` is Jira's record for the issue; without it there is no creation yet.
 */
export function useIssueCreation(issue: Pick<Issue, "created" | "creator">, fields: any) {
  const at: string = issue.created ?? fields?.created;
  const record = fields?.creator ?? fields?.reporter;
  const known = !!fields;
  return useMemo(
    () => (known ? { at, actor: issue.creator ?? jiraUser(record) } : undefined),
    [known, at, issue.creator, record],
  );
}
