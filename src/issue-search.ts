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

/** A query's "quoted phrases" (an unclosed quote runs to the end), its @people and its other words, lower-cased. */
export function parseQuery(q: string) {
  const lower = q.toLowerCase();
  const rest = lower.replace(/"[^"]*"?/g, " ").split(/\s+/).filter(Boolean);
  return {
    phrases: [...lower.matchAll(/"([^"]*)"?/g)].map((m) => m[1]!.trim()).filter(Boolean),
    words: rest.filter((w) => !w.startsWith("@")), // a lone "@" is a name still being typed
    people: rest.filter((w) => /^@./.test(w)).map((w) => w.slice(1)),
  };
}
/** BJ-62: `@name` refines search to issues assigned to someone whose name (any word of it) or id starts with it.
 *  ponytail: assignee only, typed; Linear's Search also has a Filter bar for any property. */
const assignedTo = (i: Issue, person: string) =>
  !!i.assignee &&
  (i.assignee.id.toLowerCase().startsWith(person) ||
    i.assignee.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(person)));

/** Issues whose key, title, description or comments hold every typed word and quoted phrase: the key the query names
 *  first, then title matches, then the most recently updated (top 50). */
const haystack = (i: Issue) =>
  `${i.key} ${i.summary}\n${i.description ?? ""}\n${i.commentText ?? ""}`.toLowerCase();

/** Linear's `searchViewOrdering` (Search's display options): "Most relevant", "Last updated" or "Last created". */
export const SEARCH_ORDERINGS = [
  ["relevance", "Most relevant"],
  ["updatedAt", "Last updated"],
  ["createdAt", "Last created"],
] as const;
export type SearchOrdering = (typeof SEARCH_ORDERINGS)[number][0];

export function matchIssues(issues: Map<string, Issue>, q: string, ordering: SearchOrdering = "relevance"): Issue[] {
  const { phrases, words, people } = parseQuery(q);
  const terms = [...phrases, ...words];
  const exact = shorthandKey(q) ?? q.trim().toUpperCase();
  const rank = (i: Issue) => {
    if (ordering !== "relevance") return 0;
    const title = matchRank(i.summary, terms.join(" "));
    return i.key === exact ? -1 : title < 0 ? 6 : title;
  };
  const date = (i: Issue) => (ordering === "createdAt" ? (i.created ?? "") : i.updated);
  return [...issues.values()]
    .filter((i) => i.key === exact || (terms.every((t) => haystack(i).includes(t)) && people.every((p) => assignedTo(i, p))))
    .map((i) => [rank(i), i] as const)
    .sort(([ra, a], [rb, b]) => ra - rb || (date(a) < date(b) ? 1 : -1))
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
