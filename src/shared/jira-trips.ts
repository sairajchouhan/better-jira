/**
 * Trips to Jira: each time the app sends its user to the Jira site it is connected to, by a link, a menu action or a message
 * telling them to do something there. The server appends them to the instance's `trips.jsonl`, and `bun run trips <instance>`
 * ranks them, so the owner sees what still sends people back to Jira. A trip names the control or message, where in the app
 * the user was, and the Jira URL's path with every id, key and name replaced: never issue text or titles.
 */

export type Trip = {
  /** Made when the trip happened, so a batch sent twice is counted once. */
  id: string;
  /** ISO time of the click or message. */
  time: string;
  /** The control or message that sent the user to Jira (`issue-key`, `description-link`, `message:move-in-jira`…); a
   *  Confluence page on the same site adds `:confluence`. */
  kind: string;
  /** The Jira URL's path pattern (`/browse/:key`), or null for a message that names no page. */
  path: string | null;
  /** The route the app was on (`/board/$board/$scope`). */
  screen: string;
  board: number | null;
  issue: string | null;
};

/** Messages that tell the user to do something in Jira, each shown with its `phrase`, and the Jira page it sends them to. */
export const JIRA_MESSAGES = {
  "move-in-jira": { phrase: "Use Move in Jira for this change.", path: "/browse/:key" },
  "board-address": {
    phrase: "Open the board in Jira and copy its address.",
    path: "/jira/software/projects/:project/boards/:id",
  },
} as const;
export type JiraMessage = keyof typeof JIRA_MESSAGES;

/** The messages `text` carries. */
export const jiraMessagesIn = (text: string) =>
  (Object.keys(JIRA_MESSAGES) as JiraMessage[]).filter((message) => text.includes(JIRA_MESSAGES[message].phrase));

/** Path segments that name a place in Jira's or Confluence's web app; every other segment is replaced. */
const WORDS = new Set(
  `browse jira software core servicedesk c projects boards backlog list timeline calendar summary issues filters dashboards
  settings personal notifications people teams plans reports secure attachment thumbnail queues custom your-work for-you
  apps admin wiki spaces pages display overview blog edit viewpage.action RapidBoard.jspa RapidView.jspa Dashboard.jspa
  IssueNavigator.jspa ManageFilters.jspa ViewProfile.jspa`.split(/\s+/),
);
/** What replaces a segment that follows one of these. */
const AFTER: Record<string, string> = { projects: ":project", spaces: ":space", display: ":space" };

/** One path segment as the pattern shows it: a word Jira's own pages use, else what kind of value it holds. A page's or
 *  file's name (after `pages/:id` or `attachment/:id`) is always replaced, even when it is one of those words. */
function segment(part: string, previous: string | undefined, beforePrevious: string | undefined): string {
  if (previous && AFTER[previous]) return AFTER[previous];
  if ((beforePrevious === "pages" || beforePrevious === "attachment") && /^\d+$/.test(previous ?? "")) return ":value";
  if (/^\d+$/.test(part)) return ":id";
  if (/^[A-Z][A-Z0-9_]*-\d+$/.test(part)) return ":key";
  return WORDS.has(part) ? part : ":value";
}

/**
 * Where `url` goes on the Jira `site`, as a pattern (`/browse/:key`, `/wiki/spaces/:space/pages/:id/:value`), with its query's
 * names but not their values (`/secure/RapidView.jspa?rapidView`); null when it goes anywhere else.
 */
export function jiraPath(url: string, site: string): { path: string; confluence: boolean } | null {
  if (!URL.canParse(url) || !URL.canParse(site)) return null;
  const parsed = new URL(url);
  if (parsed.origin !== new URL(site).origin) return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  const shown = parts.map((part, i) => segment(part, parts[i - 1], parts[i - 2]));
  const names = [...new Set(parsed.searchParams.keys())].filter((name) => /^[\w.-]+$/.test(name)).sort();
  return {
    path: `/${shown.join("/")}${names.length ? `?${names.join("&")}` : ""}`,
    confluence: parts[0] === "wiki",
  };
}

const text = (value: unknown, max: number) => typeof value === "string" && value.length > 0 && value.length <= max;

/** A trip read from a request or a line of the file, or null when it isn't one. Unknown fields are dropped, so nothing but
 *  these is ever kept. */
export function parseTrip(value: unknown): Trip | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!text(v.id, 64) || !text(v.time, 40) || Number.isNaN(Date.parse(v.time as string))) return null;
  if (!text(v.kind, 64) || !/^[\w:-]+$/.test(v.kind as string)) return null;
  if (v.path !== null && !(text(v.path, 300) && (v.path as string).startsWith("/"))) return null;
  if (!text(v.screen, 120)) return null;
  if (v.board !== null && !Number.isSafeInteger(v.board)) return null;
  if (v.issue !== null && !(text(v.issue, 40) && /^[\w-]+$/.test(v.issue as string))) return null;
  return {
    id: v.id as string,
    time: v.time as string,
    kind: v.kind as string,
    path: v.path as string | null,
    screen: v.screen as string,
    board: v.board as number | null,
    issue: v.issue as string | null,
  };
}

export type TripGroup = { kind: string; path: string | null; count: number; last: string };

/** The trips in `lines` (the file's text), each counted once, grouped by kind and path: most frequent first, then most
 *  recent. Lines that aren't trips are skipped. */
export function groupTrips(lines: string): TripGroup[] {
  const seen = new Set<string>(),
    groups = new Map<string, TripGroup>();
  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    let trip: Trip | null;
    try {
      trip = parseTrip(JSON.parse(line));
    } catch {
      trip = null;
    }
    if (!trip || seen.has(trip.id)) continue;
    seen.add(trip.id);
    const key = `${trip.kind}\n${trip.path ?? ""}`,
      group = groups.get(key);
    if (!group) groups.set(key, { kind: trip.kind, path: trip.path, count: 1, last: trip.time });
    else {
      group.count++;
      if (Date.parse(trip.time) > Date.parse(group.last)) group.last = trip.time;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || Date.parse(b.last) - Date.parse(a.last));
}
