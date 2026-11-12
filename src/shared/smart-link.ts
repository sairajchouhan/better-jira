/**
 * What a Jira smart link (ADF inlineCard, blockCard, embedCard) points at, read from its URL alone, so it shows like
 * Linear's mention chips instead of a bare URL (BJ-16). Nothing here fetches: issue and Confluence titles come from the
 * mirror or the server's cached read (`/api/smart-link`), every other site keeps the readable title made here.
 */
export type SmartLink =
  /** A Jira issue's /browse/ page, on any Atlassian site. */
  | { kind: "issue"; url: string; site: string; key: string }
  /** A Confluence page; `title` is the URL's own slug until the page's title is read. */
  | { kind: "confluence"; url: string; site: string; pageId?: string; title: string }
  | { kind: "external"; url: string; origin: string; title: string };

/** A title Jira's link resolver stored on the node (`attrs.data`, JSON-LD), if any. */
const dataTitle = (data: unknown) => {
  const name = data && typeof data === "object" ? (data as { name?: unknown }).name : undefined;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
};
const words = (slug: string) => {
  try {
    return decodeURIComponent(slug.replace(/\+/g, " ")).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  } catch {
    return slug;
  }
};
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
/** Hosts Atlassian serves Jira and Confluence from. */
const atlassianSite = (host: string) => /\.(atlassian\.net|jira\.com)$/.test(host);

/** Confluence's short link (`/wiki/x/<code>`): the page ID's little-endian bytes in base64, `/` written `-` and `+` `_`,
 *  trailing `A`s (zero bits) and padding dropped. */
export function tinyPageId(code: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(code)) return;
  let b64 = code.replace(/-/g, "/").replace(/_/g, "+");
  b64 += "A".repeat((4 - (b64.length % 4)) % 4);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    return;
  }
  let id = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) id = (id << 8n) | BigInt(bytes[i]!);
  return id > 0n ? String(id) : undefined;
}
/** The short link Confluence makes for a page ID (the inverse of tinyPageId). */
export function tinyCode(pageId: string): string {
  let id = BigInt(pageId),
    bytes = "";
  while (id > 0n) {
    bytes += String.fromCharCode(Number(id & 255n));
    id >>= 8n;
  }
  return btoa(bytes).replace(/=+$/, "").replace(/A+$/, "").replace(/\//g, "-").replace(/\+/g, "_");
}

function confluence(url: URL, href: string, data: unknown): SmartLink | undefined {
  const path = url.pathname.split("/").filter(Boolean);
  if (path[0] !== "wiki") return;
  const named = dataTitle(data);
  // /wiki/spaces/<space>/pages/<id>/<Title+Slug>, also /pages/edit-v2/<id> and blog posts.
  const page = /^\/wiki\/spaces\/([^/]+)\/(?:pages|blog\/\d{4}\/\d{2}\/\d{2})\/(?:edit-v2\/)?(\d+)(?:\/([^/]+))?/.exec(url.pathname);
  const tiny = path[1] === "x" && path[2] ? tinyPageId(path[2]) : undefined;
  const pageId = page?.[2] ?? tiny ?? url.searchParams.get("pageId") ?? undefined;
  const title =
    named ??
    (page?.[3] ? words(page[3]) : path[1] === "spaces" && path[2] && !page ? `${words(path[2])} space` : "Confluence page");
  return { kind: "confluence", url: href, site: url.origin, ...(pageId && /^\d+$/.test(pageId) ? { pageId } : {}), title };
}

/** A readable name for a link to any other site: what the URL itself says, never fetched. */
export function externalTitle(url: URL): string {
  const host = url.hostname.replace(/^www\./, ""),
    path = url.pathname.split("/").filter(Boolean);
  if (host === "github.com" && path.length >= 2) {
    const repo = `${path[0]}/${path[1]}`;
    if (/^(pull|issues)$/.test(path[2] ?? "") && /^\d+$/.test(path[3] ?? "")) return `${repo}#${path[3]}`;
    if (path[2] === "commit" && path[3]) return `${repo}@${path[3].slice(0, 7)}`;
    if (path.length === 2) return repo;
  }
  if (host === "docs.google.com") {
    const app: Record<string, string> = {
      document: "Google Doc",
      spreadsheets: "Google Sheet",
      presentation: "Google Slides",
      forms: "Google Form",
      drawings: "Google Drawing",
    };
    if (path[0] && app[path[0]]) return app[path[0]]!;
  }
  if (host === "drive.google.com") return path[0] === "drive" ? "Google Drive folder" : "Google Drive file";
  if (host.endsWith(".slack.com") || host === "slack.com")
    return path[0] === "archives" ? (path[2] ? "Slack message" : "Slack channel") : "Slack";
  if (host === "figma.com" && /^(file|design|proto|board|slides)$/.test(path[0] ?? ""))
    return path[2] ? words(path[2]) : "Figma file";
  if (host === "loom.com" && path[0] === "share") return "Loom video";
  const rest = url.pathname.replace(/\/+$/, "");
  return host + (rest.length > 1 ? rest : "");
}

/** The smart link's target, or null when the URL is not a web address. */
export function smartLink(url: unknown, data?: unknown): SmartLink | null {
  if (typeof url !== "string") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol)) return null;
  const href = parsed.href,
    host = parsed.hostname;
  if (atlassianSite(host)) {
    const browse = /^\/browse\/([^/?#]+)\/?$/.exec(parsed.pathname)?.[1],
      selected = parsed.searchParams.get("selectedIssue") ?? undefined,
      key = [browse, selected].find((k) => k && ISSUE_KEY.test(k));
    if (key) return { kind: "issue", url: href, site: parsed.origin, key };
    const page = confluence(parsed, href, data);
    if (page) return page;
  }
  return { kind: "external", url: href, origin: parsed.origin, title: dataTitle(data) ?? externalTitle(parsed) };
}

/** What a reader sees for a smart link in plain text (search, previews): the issue key, else its title, else the URL. */
export function smartLinkText(url: unknown, data?: unknown, details?: SmartLinkDetails): string {
  const link = smartLink(url, data);
  if (!link) return String(url ?? "Link");
  const title = details?.title ?? dataTitle(data);
  return link.kind === "issue" ? [link.key, title].filter(Boolean).join(" ") : title || link.title;
}

/** What the server read behind a smart link on the configured site: an issue's summary and status, or a page's title. */
export type SmartLinkDetails = { title: string; status?: { name: string; category: string } };

/** A site's icon in the browser: always through this server, never the site itself (BJ-16: no third-party fetch from the page). */
export const faviconSrc = (origin: string) => `/api/favicon?origin=${encodeURIComponent(origin)}`;
