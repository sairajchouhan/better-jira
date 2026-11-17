import { useSyncExternalStore } from "react";
import { pullRequestStatusIn, type PullRequest } from "@/shared/pull-requests";
import { queryClient } from "./server-data";

/** Every pull request list read so far (card-badges' `["pull-requests", key, count, status]`). */
const pullRequestLists = () => queryClient.getQueriesData<PullRequest[]>({ queryKey: ["pull-requests"] });

export function usePullRequestStatus(url: string) {
  const status = () => pullRequestStatusIn(pullRequestLists(), url);
  return useSyncExternalStore((changed) => queryClient.getQueryCache().subscribe(changed), status, status);
}
