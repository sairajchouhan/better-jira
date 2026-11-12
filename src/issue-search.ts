import { matchRank } from "./search-rank";
import { adfToText } from "./document";
import type { IssueResource } from "./issue-resource";
import type { Issue } from "./store";

/** The issue key a query names, hyphen optional ("sam11", "sam 11", "SAM-11" → "SAM-11"), as Linear's
 *  `identifierMatch({ matchWithoutHyphen, exact })`; letters only, so "sam11" is never SAM1-1 (a key with digits still matches typed in full). */
export function shorthandKey(q: string): string | undefined {
  const m = /^([A-Za-z]+)[- ]?([1-9]\d{0,8})$/.exec(q.trim());
  return m ? `${m[1]!.toUpperCase()}-${Number(m[2])}` : undefined;
}

/** A query's "quoted phrases" (an unclosed quote runs to the end) and its other words, lower-cased. */
export function parseQuery(q: string) {
  const lower = q.toLowerCase();
  return {
    phrases: [...lower.matchAll(/"([^"]*)"?/g)].map((m) => m[1]!.trim()).filter(Boolean),
    words: lower.replace(/"[^"]*"?/g, " ").split(/\s+/).filter(Boolean),
  };
}

/** Issues whose key, title, description or comments hold every typed word and quoted phrase: the key the query names
 *  first, then title matches, then the most recently updated (top 50). */
const haystack = (i: Issue) =>
  `${i.key} ${i.summary}\n${i.description ?? ""}\n${i.commentText ?? ""}`.toLowerCase();

export function matchIssues(issues: Map<string, Issue>, q: string): Issue[] {
  const { phrases, words } = parseQuery(q);
  const terms = [...phrases, ...words];
  const exact = shorthandKey(q) ?? q.trim().toUpperCase();
  const rank = (i: Issue) => {
    const title = matchRank(i.summary, terms.join(" "));
    return i.key === exact ? -1 : title < 0 ? 6 : title;
  };
  return [...issues.values()]
    .filter((i) => i.key === exact || terms.every((t) => haystack(i).includes(t)))
    .map((i) => [rank(i), i] as const)
    .sort(([ra, a], [rb, b]) => ra - rb || (a.updated < b.updated ? 1 : -1))
    .slice(0, 50)
    .map(([, i]) => i);
}

export type DocumentMatch = { issue: Issue; resource: IssueResource };
/** Documents whose title or body holds every typed word and quoted phrase (every document for an empty query): title
 *  matches first, then the most recently updated (top 50). */
export function matchDocuments(issues: Map<string, Issue>, q: string): DocumentMatch[] {
  const { phrases, words } = parseQuery(q);
  const terms = [...phrases, ...words];
  return [...issues.values()]
    .flatMap((issue) => (issue.resources ?? []).filter((r) => r.kind === "document").map((resource) => ({ issue, resource })))
    .filter(({ resource }) => {
      const text = `${resource.title}\n${adfToText(resource.body)}`.toLowerCase();
      return terms.every((t) => text.includes(t));
    })
    .map((m) => [matchRank(m.resource.title, terms.join(" ")), m] as const)
    .map(([rank, m]) => [rank < 0 ? 6 : rank, m] as const)
    .sort(([ra, a], [rb, b]) => ra - rb || (a.resource.updated < b.resource.updated ? 1 : -1))
    .slice(0, 50)
    .map(([, m]) => m);
}
