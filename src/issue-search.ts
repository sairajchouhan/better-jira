import { matchRank } from "./search-rank";
import type { Issue } from "./store";

/** The issue key a query names, hyphen optional ("sam11", "sam 11", "SAM-11" → "SAM-11"), as Linear's
 *  `identifierMatch({ matchWithoutHyphen, exact })`; letters only, so "sam11" is never SAM1-1 (a key with digits still matches typed in full). */
export function shorthandKey(q: string): string | undefined {
  const m = /^([A-Za-z]+)[- ]?([1-9]\d{0,8})$/.exec(q.trim());
  return m ? `${m[1]!.toUpperCase()}-${Number(m[2])}` : undefined;
}

/** Issues matching every typed word: the key the query names first, then title matches, then the most recently updated (top 50). */
export function matchIssues(issues: Map<string, Issue>, q: string): Issue[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const exact = shorthandKey(q) ?? q.trim().toUpperCase();
  const rank = (i: Issue) => {
    const title = matchRank(i.summary, q);
    return i.key === exact ? -1 : title < 0 ? 6 : title;
  };
  return [...issues.values()]
    .filter((i) => i.key === exact || words.every((w) => `${i.key} ${i.summary}`.toLowerCase().includes(w)))
    .map((i) => [rank(i), i] as const)
    .sort(([ra, a], [rb, b]) => ra - rb || (a.updated < b.updated ? 1 : -1))
    .slice(0, 50)
    .map(([, i]) => i);
}
