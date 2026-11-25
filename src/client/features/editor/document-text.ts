import { adfToText as text } from "@/shared/document";
import { smartLink, type SmartLinkDetails } from "@/shared/smart-link";
import { get } from "@/client/state/store";
import { queryClient } from "@/client/state/query-client";

/** Resolve text from the same mirror and cached reads as the rendered chip, without fetching. */
export const adfToText = (node: unknown): string => text(node, (url) => {
  const link = smartLink(url);
  const issue = link?.kind === "issue" && link.site === get().site ? get().issues.get(link.key) : undefined;
  return issue ? { title: issue.summary } : queryClient.getQueryData<SmartLinkDetails>(["smart-link", url]);
});
