const wordChar = /[\p{L}\p{N}]/u;
/**
 * How well `text` matches `query`, lower is better: 0 exact, 1 prefix, 2 the query as whole words,
 * 3 the query at a word start, 4 the query anywhere, 5 every query word somewhere; -1 no match.
 */
export function matchRank(text: string, query: string): number {
  const t = text.toLowerCase(),
    q = query.trim().toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  let best = 5;
  for (let i = t.indexOf(q); i >= 0 && best > 2; i = t.indexOf(q, i + 1)) {
    const start = !wordChar.test(t[i - 1] ?? " "),
      end = !wordChar.test(t[i + q.length] ?? " ");
    best = Math.min(best, start ? (end ? 2 : 3) : 4);
  }
  if (best < 5) return best;
  return q.split(/\s+/).every((w) => t.includes(w)) ? 5 : -1;
}
