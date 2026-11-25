import type { Issue } from "@/shared/issue-model";
import type { SmartLinkDetails } from "@/shared/smart-link";
import { shorthandKey } from "./issue-search";

/**
 * The issue a ⌘K query names, as Linear's issue search reads one (startup-root.CnUSfl4j.js `mI`):
 * - a link (`aEt`: no whitespace and a `/`, completed as `sEt` does: `//host` and a bare `host/…` get https, `/path` this
 *   app's origin): a /browse/KEY page or a board's `selectedIssue=KEY` on this Jira site, or this app's own issue page
 *   (`/issue/KEY…`) or a list with `?issue=KEY`;
 * - a key typed alone (`possibleIdentifier`, hyphen optional: "drft-970", "drft970", "drft 970").
 * A Jira issue link on another Atlassian site is `elsewhere` (Linear's `oi.isInWorkspace` false), which no issue answers.
 */
export type PastedIssue = { kind: "link" | "key"; key: string } | { kind: "elsewhere" };

/** A Jira issue key: a project key of two or more characters (Jira's minimum, Linear's `[A-Za-z]{2,}`), a hyphen, a number. */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]+-[1-9]\d*$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const ATLASSIAN = /\.(atlassian\.net|jira\.com)$/;
const BROWSE = /^\/browse\/([^/]+)\/?$/;
const APP_ISSUE = /^\/issue\/([^/]+)/;

const keyOf = (raw: string | null | undefined) => {
  if (!raw) return undefined;
  let key: string;
  try {
    key = decodeURIComponent(raw).toUpperCase();
  } catch {
    return undefined;
  }
  return ISSUE_KEY.test(key) ? key : undefined;
};
const originOf = (href: string) => {
  try {
    return new URL(href).origin;
  } catch {
    return undefined;
  }
};

export function pastedIssue(input: string, place: { site: string; origin: string }): PastedIssue | undefined {
  const q = input.trim();
  if (!q.includes("/")) {
    const key = keyOf(shorthandKey(q));
    return key ? { kind: "key", key } : undefined;
  }
  if (/\s/.test(q)) return undefined;
  const href = q.startsWith("//") ? `https:${q}` : q.startsWith("/") ? `${place.origin}${q}` : SCHEME.test(q) ? q : `https://${q}`;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol)) return undefined;
  const jira = BROWSE.exec(url.pathname)?.[1] ?? url.searchParams.get("selectedIssue");
  let key: string | undefined;
  if (place.site && url.origin === originOf(place.site)) key = keyOf(jira);
  else if (url.origin === place.origin) key = keyOf(APP_ISSUE.exec(url.pathname)?.[1] ?? url.searchParams.get("issue"));
  else return ATLASSIAN.test(url.hostname) && keyOf(jira) ? { kind: "elsewhere" } : undefined;
  return key ? { kind: "link", key } : undefined;
}

/** The issue's Jira page, which the server reads (`/api/smart-link`) when the store doesn't have the issue. */
export const browseURL = (site: string, key: string) => `${site}/browse/${encodeURIComponent(key)}`;

/**
 * The row a pasted link or typed key puts at the top of ⌘K (Linear's `XTt` lifts the issue the query names to the root
 * menu's first group):
 * - `app`: the store has the issue; it opens here.
 * - `jira`: only Jira has it; the server read its title and status, and it opens on Jira's page.
 * - `missing`: a link no issue answers (Linear's "No issues found for this link"). A typed key Jira doesn't know adds no row
 *   (Linear's `GA` failing falls through to plain search).
 * Undefined while there is nothing to show yet.
 */
export type PastedRow = { kind: "app"; issue: Issue } | { kind: "jira"; key: string; details: SmartLinkDetails } | { kind: "missing" };
export function pastedRow(
  pasted: PastedIssue | undefined,
  issue: Issue | undefined,
  details: SmartLinkDetails | null | undefined,
): PastedRow | undefined {
  if (!pasted) return undefined;
  if (pasted.kind === "elsewhere") return { kind: "missing" };
  if (issue) return { kind: "app", issue };
  if (details) return { kind: "jira", key: pasted.key, details };
  return details === null && pasted.kind === "link" ? { kind: "missing" } : undefined;
}

/** Linear's `newTab: fu.metaKey`: a pick made with ⌘ held (Ctrl off a Mac) opens the issue in a new tab. */
export const opensNewTab = (event: { metaKey: boolean; ctrlKey: boolean }, mac: boolean) => (mac ? event.metaKey : event.ctrlKey);
