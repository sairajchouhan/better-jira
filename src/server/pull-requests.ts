import { pullRequestList, pullRequestProviders, type PullRequest } from "@/shared/pull-requests";

type Read = <T = any>(path: string) => Promise<T>;

/** The issue's pull requests from Jira's development panel, read-only: the issue's id, the providers its development summary counts
 *  pull requests for, then each provider's pull request detail. */
export async function readPullRequests(jira: Read, key: string): Promise<PullRequest[]> {
  const { id } = await jira<{ id: string }>(`/rest/api/3/issue/${encodeURIComponent(key)}?fields=created`);
  const at = `issueId=${encodeURIComponent(id)}`;
  const providers = pullRequestProviders(await jira(`/rest/dev-status/latest/issue/summary?${at}`));
  const details = await Promise.all(
    providers.map((type) =>
      jira(`/rest/dev-status/latest/issue/detail?${at}&applicationType=${encodeURIComponent(type)}&dataType=pullrequest`),
    ),
  );
  return pullRequestList(details);
}
