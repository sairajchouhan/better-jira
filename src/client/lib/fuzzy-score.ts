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
 * The menu's `filter` with Linear's score: pass it to every searchable menu (`<Menu filter={menuFilter}>`) so all menus rank alike, as
 * Linear scores every action menu's rows with one `Yn.scoreAction` (startup-entry.Dt5YDWdY.js). A row's `keywords`, when given,
 * are what it is searched by instead of its value, so a value can stay a unique id ("Status To Do 3") while the row matches on its
 * label ("To Do") alone: the first is its name, the rest Linear's `keywords` (`rowKeywords` adds a status's workflow place and a
 * pinned row). As in Linear's `filterAndSortByScores`, a row or person under 0.24 is left out, once the typo fallback has had a go
 * ("asign" → Assignee). `parents`: the labels of the menus a row is hoisted out of ("Status"), so it scores as Linear's hoisted
 * action: found by them too, 0.15 lower, and a status ordered from the hoisted base (`PCn.scoreForOrdering`).
 */
export function menuFilter(
  value: string,
  search: string,
  keywords?: string[],
  { parents }: { parents?: string[] } = {},
): number {
  const person = personOf(keywords);
  if (person) return applicable(personScore(person.names, search, person));
  const crumbs = keywords?.find((k) => k.startsWith(CRUMBS));
  if (crumbs) return breadcrumbScore(keywords!.filter((k) => k !== crumbs), crumbs.slice(CRUMBS.length), search);
  const { aliases, order, pin } = parseRow(keywords);
  if (pin === "first") return 1;
  // Linear's sortPriority −∞ on a skipFilterScoring row: listed whatever is typed, under every row that matches.
  if (pin === "last") return Number.MIN_VALUE;
  const [name = value, ...words] = aliases.length ? aliases : [value];
  const base = parents?.length ? HOISTED_PREFIX : SUBMENU_PREFIX;
  return applicable(
    actionScore(
      { name, keywords: words, parents, override: order === undefined ? undefined : workflowOrder(name, order, base) },
      search,
    ),
  );
}
/** Linear's `filterAndSortByScores`: a row under 0.24 is left out. */
const applicable = (score: number) => (score >= MIN_APPLICABILITY ? score : 0);

const ORDER = "\u0002",
  PIN = "\u0003";
/** What a picker row is found by beyond its name (Linear's action fields). */
export type RowSearch = {
  /** Linear's `keywords`: other words the row is found by, through its secondary string ("clear delete" on Remove due date). */
  keywords?: string;
  /** A status's place in the workflow (`indexInWorkflow`), for its `scoreOverride: PCn.createScoreOverride`. */
  order?: number;
  /** Linear's `skipFilterScoring`: listed whatever is typed, "first" scoring 1 (a typed date), "last" under every match (Create new
   *  label, `sortPriority: -1/0`). */
  pin?: "first" | "last";
};
/** A row's menu `keywords` after its name, for menuFilter: its Linear keywords, workflow place and pin. One encoding for every
 *  picker row (PickerRow) and action-menu value (ActionEntry.keywords), so S, P, L, due and their right-click submenus score alike. */
export const rowKeywords = ({ keywords, order, pin }: RowSearch): string[] => [
  ...(keywords ? [keywords] : []),
  ...(order === undefined ? [] : [`${ORDER}${order}`]),
  ...(pin ? [`${PIN}${pin}`] : []),
];
/** rowKeywords read back: the plain keywords, and the workflow place and pin they carry. */
export function parseRow(keywords: readonly string[] = []) {
  const order = keywords.find((k) => k.startsWith(ORDER)),
    pin = keywords.find((k) => k.startsWith(PIN));
  return {
    aliases: keywords.filter((k) => k !== order && k !== pin),
    order: order === undefined ? undefined : Number(order.slice(ORDER.length)),
    pin: pin?.slice(PIN.length) as RowSearch["pin"],
  };
}

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
/** A hoisted row's menu `keywords`: its label, and its breadcrumb (`path` then the label) marked for menuFilter's breadcrumbScore. */
export const breadcrumbKeywords = (label: string, path: string[]) => [label, CRUMBS + [...path, label].join(" ")];

const PERSON = "\u0001",
  // Linear's `E6t` and `D6t`: what the current user gets for "me" or a word of their name, and anyone for their whole name.
  ME_BOOST = 20,
  NAME_BOOST = 10,
  // `mH` boosts: team members by 5 (project members, a parked decision here, by 10).
  TEAM_PRIORITY = 5;
/** A person row's menu `keywords` (Linear's user action `IP` with the assignee picker's `scoreOverride: mH`): their name, and
 *  markers for menuFilter's personScore: the current user, and a member of the board's team. */
export const personKeywords = (name: string, person: { me?: boolean; team?: boolean } = {}) => [
  name,
  PERSON,
  ...(person.me ? [`${PERSON}me`] : []),
  ...(person.team ? [`${PERSON}team`] : []),
];
/** What personKeywords marked: the names, and whether the row is the current user and a team member; undefined for no person. */
function personOf(keywords: readonly string[] = []) {
  if (!keywords.some((k) => k.startsWith(PERSON))) return undefined;
  const marked = (flag: string) => keywords.includes(PERSON + flag);
  return { names: keywords.filter((k) => !k.startsWith(PERSON)), me: marked("me"), team: marked("team") };
}
/** `j6t`: the name's words appear in the query, together and in order. */
function wholeName(words: string[], name: string) {
  const parts = formatted(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  for (let i = 0; i + parts.length <= words.length; i++) if (parts.every((p, j) => words[i + j] === p)) return true;
  return false;
}
/**
 * Linear's people score (`mH`, `O6t`, `A6t`, `k6t` in startup-root.CnUSfl4j.js): the name's score, raised for a team member
 * (`Pn.prioritize` by 5). Once a row matches, the current user gains 20 when the query has the word "me" or a word that
 * matches their name, and anyone gains 10 when the query holds their whole name. The current user also matches "me" exactly
 * (`keywordsExactMatch: ["me"]`), so "me" lifts you to the top of the assignee picker.
 */
export function personScore(
  names: string[],
  search: string,
  person: { me?: boolean; team?: boolean; base?: number },
): number {
  const query = search.trim(),
    words = formatted(query).split(/\s+/).filter(Boolean);
  // `O6t`'s baseScore: the row's own action score, when it is scored as an action (⌘K's hoisted assignee rows, through `mH`).
  let score = Math.max(person.base ?? 0, fuzzyScore(names, query), person.me && query.toLowerCase() === "me" ? 1 : 0);
  if (person.team) score = prioritize(score, TEAM_PRIORITY);
  if (!query || score < MIN_APPLICABILITY) return score;
  if (person.me && (words.includes("me") || words.some((w) => fuzzyScore(names, w) >= MIN_APPLICABILITY)))
    return score + ME_BOOST;
  return names.some((n) => wholeName(words, n)) ? score + NAME_BOOST : score;
}

/** One command as Linear's root search scores it (`$8.scoreAction` in startup-entry.Dt5YDWdY.js). */
export type ScoredAction = {
  /** The row's name; a trailing "…" is ignored (`getActionName` with hideEllipsis). */
  name: string;
  /** Linear's `keywords`: other words the command is found by, matched through the secondary string. */
  keywords?: string | readonly string[];
  /** Linear's `keywordsExactMatch`: a query equal to one of these scores 1 ("me" on your own assignee row). */
  exact?: readonly string[];
  /** The labels of the parents a hoisted row was lifted from ("Change status"); a hoisted row loses 0.15. */
  parents?: readonly string[];
  /** Linear's `scoreOverride`, run on the corrected score. */
  override?: (score: number, search: string) => number;
};
const PUNCTUATION = /[`~!@#$%^&*()_|+\-=?;:'",.<>{}[\]\\/]/g;
/** `getStrippedString`: the text, then the text with its punctuation as spaces when that differs. */
const stripped = (s: string) => {
  const t = s.replace(PUNCTUATION, " ");
  return t === s ? s : `${s} ${t}`;
};
/** `getPunctuationInsensitiveVariants`. */
const variants = (s: string) => {
  const t = s.trim().toLowerCase(),
    squash = (x: string) => x.trim().replace(/\s+/g, " ");
  return [t, squash(t.replace(/[\p{P}\p{S}]/gu, "")), squash(t.replace(/[\p{P}\p{S}]/gu, " "))].filter(Boolean);
};
/** `getSearchScoreStrings`: the name (mainString), and the parents, name, keywords and the name without spaces (secondaryString). */
export function actionStrings({ name, keywords, parents = [] }: ScoredAction) {
  const plain = name.replaceAll("…", ""),
    main = stripped(stripped(plain)),
    words = typeof keywords === "string" ? keywords : (keywords ?? []).join(" "),
    joined = plain.split(" ").filter(Boolean).join("");
  const secondary = [
    ...parents.map((p) => stripped(p).toLowerCase()),
    main,
    words,
    plain.includes(" ") && joined !== plain ? stripped(joined) : "",
  ];
  return { name: plain.toLowerCase(), main: main.toLowerCase(), secondary: secondary.filter(Boolean).join(" ").toLowerCase() };
}
/**
 * Linear's command score (`Yn.scoreAction`): the better of the name (mainString) and the parents, name and keywords
 * (secondaryString) ×0.85, then `applyScoreCorrections`. Below 0.24 its typo fallback has a go (`applyFuzzyScoreFallback`): the
 * name's typo score, as `getFuzzyActionScore` maps it, corrected the same way, kept when that reaches 0.24.
 */
export function actionScore(action: ScoredAction, search: string): number {
  const q = search.trim().toLowerCase(),
    strings = actionStrings(action);
  if (!q) return 1;
  const raw = Math.max(fuzzyScore(strings.main, q), fuzzyScore(strings.secondary, q) * SECONDARY),
    score = corrected(action, strings, q, search, raw);
  if (score >= MIN_APPLICABILITY) return score;
  const typo = typoScore(strings.name, q);
  if (!typo) return score;
  const fallback = corrected(action, strings, q, search, FUZZY_FLOOR + typo * (SECONDARY - FUZZY_FLOOR));
  return fallback >= MIN_APPLICABILITY ? fallback : score;
}
/** `applyScoreCorrections`: 1 for an exact name or exact keyword, −0.15 for a hoisted row, and below 0.24 on a query of 3+
 *  characters 0.34 when the name contains it, else 0.29 when the secondary string does; then the action's `scoreOverride`. */
function corrected(
  action: ScoredAction,
  strings: ReturnType<typeof actionStrings>,
  q: string,
  search: string,
  raw: number,
): number {
  let score = raw;
  const nameVariants = new Set(variants(strings.name));
  if (variants(q).some((v) => nameVariants.has(v)) || action.exact?.some((k) => k.toLowerCase() === q)) score = 1;
  if (action.parents?.length) score -= HOISTED;
  if (score < MIN_APPLICABILITY && q.length > 2) {
    if (strings.main.includes(q)) score = MIN_APPLICABILITY + 0.1;
    else if (strings.secondary.includes(q)) score = MIN_APPLICABILITY + 0.05;
  }
  if (action.override) score = action.override(score, search.trim());
  return Number(score.toFixed(6));
}
/** `n5`: the least a typo hit maps to (0.24 + 0.15 + 0.01), so one survives a hoisted row's −0.15. */
const FUZZY_FLOOR = MIN_APPLICABILITY + HOISTED + 0.01;
const TERM_SPLIT = /[^A-Za-z\d']+/,
  WORD_CHAR = /[\p{L}\p{N}]/u;
/**
 * Linear's typo score (`H8.scoreAll`, uFuzzy with `intraIns: 1/0, intraChars: "."`): the query's terms found in order in the text,
 * any characters skipped, at the leftmost place they fit; 0 when they don't. 0.45 for few skipped characters, 0.25 for runs that
 * start a word, 0.2 for terms found whole, 0.1 for an early start.
 */
export function typoScore(text: string, query: string): number {
  const terms = plain(query)
      .replace(/"|(^|\s)-+/g, "$1")
      .split(TERM_SPLIT)
      .filter(Boolean)
      .map((t) => t.toLowerCase()),
    length = terms.join("").length;
  if (!length) return 0;
  const source = plain(text),
    low = source.toLowerCase();
  const at: number[] = [];
  let from = 0,
    intra = 0,
    inter = 0,
    whole = 0;
  for (const term of terms) {
    let first = -1,
      last = -1;
    for (const char of term) {
      const i = low.indexOf(char, last < 0 ? from : last + 1);
      if (i < 0) return 0;
      if (first < 0) first = i;
      else intra += i - last - 1;
      last = i;
      at.push(i);
    }
    if (at.length > term.length) inter += first - from;
    if (last - first + 1 === term.length) whole++;
    from = last + 1;
  }
  // The matched characters' runs, and how many of them start a word.
  let runs = 0,
    starts = 0;
  at.forEach((i, n) => {
    if (n > 0 && at[n - 1] === i - 1) return;
    runs++;
    if (i === 0 || !WORD_CHAR.test(source.charAt(i - 1))) starts++;
  });
  return (
    (length / (length + intra + inter)) * 0.45 +
    (starts / Math.max(1, runs)) * 0.25 +
    Math.min(1, whole / terms.length) * 0.2 +
    (1 / (1 + at[0]!)) * 0.1
  );
}
/** `PCn.HOISTED_PREFIX_MATCH_BASE_SCORE` (a status listed in the root search) and `SUBMENU_PREFIX_MATCH_BASE_SCORE` (in the S picker). */
export const HOISTED_PREFIX = 0.84,
  SUBMENU_PREFIX = 0.999;
/** Linear's `hc` (`UO`): NFKD with the accents dropped (lodash deburr). */
const plain = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
/** Linear's status `scoreOverride` (`PCn.scoreForOrdering` in startup-root.CnUSfl4j.js): a status whose name starts with a shorter
 *  query scores `base` (0.999 in the status picker, 0.84 hoisted into a root search), less 0.001 per step down the workflow, so "in"
 *  lists the statuses in workflow order whatever their length. */
export const workflowOrder =
  (name: string, index: number, base = HOISTED_PREFIX) =>
  (score: number, search: string): number => {
    const n = plain(name).toLowerCase(),
      q = plain(search).toLowerCase();
    return q && q.length < n.length && n.startsWith(q) ? base - index * 0.001 : score;
  };
/** A value's rowKeywords as the action fields actionScore reads once it is hoisted into a root search (⌘K): its keywords, a
 *  status's workflow order at the hoisted base (0.84), and a person's score (Linear's assignee rows keep `scoreOverride: mH`
 *  when hoisted: the action's own score, hoisted −0.15 included, is `O6t`'s baseScore, then the me and whole-name boosts). */
export function hoistedRow(name: string, keywords?: readonly string[]): Pick<ScoredAction, "keywords" | "override"> {
  const { aliases, order } = parseRow(keywords);
  const person = personOf(aliases);
  if (person)
    return { keywords: person.names, override: (score, search) => personScore(person.names, search, { ...person, base: score }) };
  return { keywords: aliases, override: order === undefined ? undefined : workflowOrder(name, order, HOISTED_PREFIX) };
}
/** Linear's `limitSubActionsInRootMenu` default (`abt(10)`): at most this many of one parent's values in the root search. */
export const HOISTED_PER_PARENT = 10;
/**
 * Linear's root-menu hoisting (`shouldHoistSubActions`, then the cap): once the untrimmed query has `from` characters, a parent's
 * values that score at least 0.24, the first `HOISTED_PER_PARENT` of them in the parent's own order.
 */
export function hoistValues<T extends ScoredAction>(values: readonly T[], search: string, from: number): [number, T][] {
  if (!search.length || search.length < from) return [];
  const hits: [number, T][] = [];
  for (const value of values) {
    const score = actionScore(value, search);
    if (score >= MIN_APPLICABILITY) hits.push([score, value]);
    if (hits.length === HOISTED_PER_PARENT) break;
  }
  return hits;
}
