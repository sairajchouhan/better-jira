export type JiraAuth = { site: string; email: string; token: string };
export type Configuration = JiraAuth & { boards: number[]; cachePath: string; port: number };
export type LocalSettings = { site?: string; boards?: number[]; cachePath?: string; port?: number };
type Environment = Record<string, string | undefined>;

export function siteURL(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("JIRA_URL must be a complete https URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "JIRA_URL must be an https site origin without credentials, path, query, or fragment.",
    );
  return url.origin;
}
export function boardIDs(value: string | number[]): number[] {
  const parts = typeof value === "string" ? value.split(",").map((v) => v.trim()) : value;
  if (
    !parts.length ||
    parts.some((v) => !/^\d+$/.test(String(v)) || !Number.isSafeInteger(Number(v)) || Number(v) < 1)
  )
    throw new Error("JIRA_BOARDS must contain positive board IDs separated by commas.");
  return [...new Set(parts.map(Number))];
}
export function jiraAuth(env: Environment, local: LocalSettings = {}): JiraAuth {
  const site = env.JIRA_URL || local.site,
    email = env.JIRA_EMAIL,
    token = env.JIRA_TOKEN;
  if (!site || !email?.trim() || !token?.trim())
    throw new Error(
      "Jira setup is incomplete. Run bun run setup, or set JIRA_URL, JIRA_EMAIL, JIRA_TOKEN, and JIRA_BOARDS in .env.",
    );
  return { site: siteURL(site), email: email.trim(), token: token.trim() };
}
export function configuration(env: Environment, local: LocalSettings = {}): Configuration {
  // Saved boards, port and cache belong to the saved site; another site in env must not reuse them.
  const auth = jiraAuth(env, local),
    own = !local.site || siteURL(local.site) === auth.site ? local : {};
  const boards = boardIDs(env.JIRA_BOARDS || own.boards || []),
    port = Number(env.PORT || own.port || 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535.");
  const source = new URL(auth.site).hostname.replace(/[^a-z0-9.-]/gi, "_");
  const identity = Bun.hash(`${auth.site}\n${auth.email}`).toString(16);
  return {
    ...auth,
    boards,
    port,
    cachePath: env.JIRA_CACHE || own.cachePath || `cache-${source}-${identity}.db`,
  };
}
