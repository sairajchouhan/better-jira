/**
 * Linear's search score (`jO.score` in startup-entry.Dt5YDWdY.js, with its `LO` matcher): command-score's recursive
 * subsequence match, plus a 0.999 penalty per character the match starts in, multi-word queries and a penalty for
 * matches that start mid-word. 1 is an exact match; 0 is none. Linear's caches are left out.
 */
const SCORE_CONTINUE = 1,
  SCORE_SPACE_JUMP = 0.9,
  SCORE_WORD_JUMP = 0.8,
  SCORE_CHARACTER_JUMP = 0.17,
  SCORE_TRANSPOSITION = 0.1,
  PENALTY_SKIPPED = 0.999,
  PENALTY_CASE = 0.9999,
  PENALTY_INCOMPLETE = 0.99,
  PENALTY_DISTANCE = 0.999,
  LONG = 500;
const GAP = /[\\/_+.#"@[({&]/,
  GAPS = /[\\/_+.#"@[({&]/g,
  SPACE = /[\s-]/,
  SPACES = /[\s-]/g,
  BOUNDARY = new Set([" ", "-", "_", ".", "/"]);

const caseAware = (s: string) =>
  s
    .replace(/[&+]/g, "and")
    .replace(SPACES, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[¡-¿]/g, "");
const formatted = (s: string) => caseAware(s.toLowerCase());

function match(
  text: string,
  query: string,
  lowText: string,
  lowQuery: string,
  at: number,
  q: number,
  memo: number[],
  width: number,
): number {
  if (q === query.length) return at === text.length ? SCORE_CONTINUE : PENALTY_INCOMPLETE;
  const key = at * width + q;
  if (memo[key] !== undefined) return memo[key]!;
  const char = lowQuery.charAt(q);
  let index = lowText.indexOf(char, at),
    best = 0;
  while (index >= 0 && char.length > 0) {
    let score = match(text, query, lowText, lowQuery, index + 1, q + 1, memo, width);
    if (score > best) {
      if (index === at) score *= SCORE_CONTINUE;
      else if (GAP.test(text.charAt(index - 1))) {
        score *= SCORE_WORD_JUMP;
        const skipped = text.slice(at, index - 1).match(GAPS);
        if (skipped && at > 0) score *= PENALTY_SKIPPED ** skipped.length;
      } else if (SPACE.test(text.charAt(index - 1))) {
        score *= SCORE_SPACE_JUMP;
        const skipped = text.slice(at, index - 1).match(SPACES);
        if (skipped && at > 0) score *= PENALTY_SKIPPED ** skipped.length;
      } else {
        score *= SCORE_CHARACTER_JUMP;
        if (at > 0) score *= PENALTY_SKIPPED ** (index - at);
      }
      score *= PENALTY_DISTANCE ** index;
      if (text.charAt(index) !== query.charAt(q)) score *= PENALTY_CASE;
    }
    if (
      (score < SCORE_TRANSPOSITION && lowText.charAt(index - 1) === lowQuery.charAt(q + 1)) ||
      (lowQuery.charAt(q + 1) === lowQuery.charAt(q) && lowText.charAt(index - 1) !== lowQuery.charAt(q))
    ) {
      const transposed = match(text, query, lowText, lowQuery, index + 1, q + 2, memo, width);
      if (transposed * SCORE_TRANSPOSITION > score) score = transposed * SCORE_TRANSPOSITION;
    }
    if (score > best) best = score;
    index = lowText.indexOf(char, index + 1);
  }
  memo[key] = best;
  return best;
}
const run = (text: string, query: string, lowText: string, lowQuery: string) =>
  match(text, query, lowText, lowQuery, 0, 0, [], lowQuery.length + 1);

const hasCharacters = (text: string, query: string) => [...query].every((c) => text.includes(c));
function wordBoundaryMatch(text: string, query: string) {
  const q = query.toLowerCase(),
    t = text.toLowerCase();
  if (t.startsWith(q)) return true;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1))
    if (i > 0 && BOUNDARY.has(text.charAt(i - 1))) return true;
  return false;
}
function substantialMatch(text: string, query: string) {
  if (query.length <= 3) return false;
  if (text.includes(query)) return true;
  const size = Math.max(3, Math.ceil(query.length * 0.8));
  for (let i = 0; i < query.length - size + 1; i++) if (text.includes(query.substring(i, i + size))) return true;
  return false;
}
const meaningful = (score: number, query: string, text: string) =>
  score && !wordBoundaryMatch(text, query) && !substantialMatch(text, query) ? score * 0.01 : score;

function singleWord(text: string, query: string, caseQuery: string, low = formatted(text)): number {
  if (!query || !hasCharacters(low, query)) return 0;
  let score = run(caseAware(text), caseQuery, low, query);
  if (!query.includes(" ") && low.includes(" ")) score = Math.max(score, singleWord(low.split(" ").join(""), query, caseQuery));
  return meaningful(score * 0.9997 ** (low.length - query.length), query, low);
}
function orderBonus(words: string[], text: string) {
  const at: number[] = [];
  let from = 0;
  for (const word of words) {
    const i = text.indexOf(word, from);
    at.push(i >= 0 ? i : Infinity);
    from = i >= 0 ? i + word.length : 0;
  }
  if (at.includes(Infinity)) return 1;
  return at.every((v, i) => !i || v > at[i - 1]!) ? 1.12 : 1;
}
function multiWord(text: string, low: string, words: string[]) {
  const lows = words.map(formatted);
  if (!lows.some((w) => w.charAt(0) && low.includes(w.charAt(0)))) return 0;
  const cased = caseAware(text);
  const scores = lows.map((w, i) =>
    w && hasCharacters(low, w) ? meaningful(run(cased, caseAware(words[i]!), low, w), w, low) : 0,
  );
  const hits = scores.filter((s) => s > 0);
  if (!hits.length) return 0;
  const weak = scores.some((s) => s > 0 && s < 0.05) ? 0.3 : 1;
  if (hits.length < words.length * 0.5 && 0.2 ** (words.length - hits.length) < 0.01) return 0;
  const geometric = hits.reduce((a, s) => a * s, 1) ** (1 / hits.length),
    mean = hits.reduce((a, s) => a + s, 0) / hits.length;
  const combined =
    (geometric * 0.3 + mean * 0.7) * 0.2 ** (words.length - hits.length) * orderBonus(lows, low) * weak;
  let score = combined;
  if (combined > 0.2) {
    const query = words.join(" ");
    score = Math.max(run(cased, caseAware(query), low, formatted(query)), combined);
  }
  return score > 1 ? 0.9999 : score;
}
function longKeyword(text: string, query: string, words: string[]) {
  const part = (t: string, q: string) => {
    const i = t.indexOf(q);
    if (i === -1) return 0;
    const base = i === 0 ? 0.99 : BOUNDARY.has(t.charAt(i - 1)) ? 0.9 : 0.8;
    return meaningful(base * PENALTY_DISTANCE ** i, q, t);
  };
  if (!query || !words.length) return 0;
  let score = part(text, query);
  if (words.length === 1 && !query.includes(" ") && text.includes(" ")) score = Math.max(score, part(text.split(" ").join(""), query));
  if (score > 0) return score;
  const hits = words.map((w) => part(text, w)).filter((s) => s > 0);
  if (!hits.length) return 0;
  return (hits.reduce((a, s) => a + s, 0) / hits.length) * 0.2 ** (words.length - hits.length) * orderBonus(words, text);
}

export function fuzzyScore(text: string | string[], query = ""): number {
  if (Array.isArray(text)) return text.length ? Math.max(...text.map((t) => fuzzyScore(t, query))) : 0;
  if (query === text) return 1;
  if (query.length > text.length + 10) return 0;
  if (query.toLowerCase() === text.toLowerCase()) return 0.9999;
  const words = query.split(" ").map((w) => w.trim()).filter(Boolean);
  if (!words.length) return 1;
  const low = formatted(text),
    cap = (s: number) => Math.min(s, 0.9998);
  if (low.length > LONG) return cap(longKeyword(low, formatted(query), words.map(formatted).filter(Boolean)));
  if (words.length === 1) return cap(singleWord(text, formatted(words[0]!), caseAware(words[0]!), low));
  return cap(multiWord(text, low, words));
}
export const prioritize = (score: number, by = 1) => score * 1.01 ** by;
export const deprioritize = (score: number, by = 1) => score * 0.99 ** by;
/**
 * cmdk's `filter` with Linear's score: pass it to every searchable menu (`<Menu filter={menuFilter}>`) so all menus rank alike.
 * A row's `keywords`, when given, are the text it is searched by instead of its value, so a value can stay a unique id
 * ("Status To Do 3") while the row matches on its label ("To Do") alone.
 */
export const menuFilter = (value: string, search: string, keywords?: string[]) => {
  const crumbs = keywords?.find((k) => k.startsWith(CRUMBS));
  if (crumbs) return breadcrumbScore(keywords!.filter((k) => k !== crumbs), crumbs.slice(CRUMBS.length), search);
  return fuzzyScore(keywords?.length ? keywords : value, search);
};

/** Linear's DEFAULT_MIN_APPLICABILITY_SCORE: below it a hit is weak. */
export const MIN_APPLICABILITY = 0.24;
const SECONDARY = 0.85,
  // `parentAction in n && (s -= t5)`: a hoisted child ranks under an equally good row of the menu itself.
  HOISTED = 0.15,
  CRUMBS = "\u0000";
/**
 * Linear's score for a row hoisted from a parent into the root search, "Status › Todo" (startup-entry `scoreAction` and
 * `applyScoreCorrections`): the better of its own labels (mainString) and its breadcrumb with its label (secondaryString) ×0.85,
 * less 0.15; a weak hit on a query of 3+ characters scores 0.34 when its label contains the query, else 0.29 when the breadcrumb
 * does. So "status" finds every status by its breadcrumb.
 */
export function breadcrumbScore(labels: string[], breadcrumb: string, search: string): number {
  const q = search.trim().toLowerCase();
  const score = Math.max(fuzzyScore(labels, search), fuzzyScore(breadcrumb, search) * SECONDARY) - HOISTED;
  if (score < MIN_APPLICABILITY && q.length > 2) {
    if (labels.some((l) => l.toLowerCase().includes(q))) return MIN_APPLICABILITY + 0.1;
    if (breadcrumb.toLowerCase().includes(q)) return MIN_APPLICABILITY + 0.05;
  }
  return Math.max(score, 0);
}
/** A hoisted row's cmdk `keywords`: its label, and its breadcrumb (`path` then the label) marked for menuFilter's breadcrumbScore. */
export const breadcrumbKeywords = (label: string, path: string[]) => [label, CRUMBS + [...path, label].join(" ")];
