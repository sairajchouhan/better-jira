import { useEffect, useState, useSyncExternalStore } from "react";
import { QueryObserver } from "@tanstack/query-core";
import { queryClient } from "@/client/state/query-client";
import type { SmartLinkDetails } from "@/shared/smart-link";

type Key = readonly ["smart-link", string];
const detailsQuery = (url: string, enabled: boolean) => ({
  queryKey: ["smart-link", url] as Key,
  queryFn: async (): Promise<SmartLinkDetails | null> => {
    const response = await fetch(`/api/smart-link?url=${encodeURIComponent(url)}`);
    return response.ok ? response.json() : null;
  },
  enabled,
  staleTime: Infinity,
});
/** The server's one cached, read-only read behind a link on this Jira site (an issue off the board, a Confluence page): its
 *  title and status, null when Jira refuses it, undefined until it answers. The same URL anywhere on screen (a smart link, a
 *  link pasted into ⌘K) shares it. Nothing for other sites. */
export function useSmartLinkDetails(url: string, enabled: boolean) {
  const [observer] = useState(
    () => new QueryObserver<SmartLinkDetails | null, Error, SmartLinkDetails | null, SmartLinkDetails | null, Key>(queryClient, detailsQuery(url, enabled)),
  );
  useEffect(() => observer.setOptions(detailsQuery(url, enabled)), [observer, url, enabled]);
  const result = () => observer.getCurrentResult();
  const data = useSyncExternalStore((changed) => observer.subscribe(changed), result, result).data;
  // Until the effect above moves the observer to a new URL, its answer is the old URL's.
  return observer.getCurrentQuery().queryKey[1] === url ? data : undefined;
}
