import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AvailableBoard, AvailableBoardsResult } from "@/shared/available-board";
import { boardFromInput, boardIDs, siteURL, type LocalSettings } from "./config";
import { JiraError, JiraTimeout } from "./jira";
import { listJiraBoards } from "./jira-boards";
import { jiraProblem, NotJiraAnswer, TOKEN_PAGE } from "./jira-problem";
import { credentialsPath, instanceHome, reloadLocalSettings, settingsPath } from "./server-config";

const READ_TIMEOUT_MS = 20_000;

export type SetupFetch = (url: string, init: RequestInit) => Promise<Response>;

export type SetupConnectResult = {
  site: string;
  user: { id: string; name: string; avatar?: string };
  boards: AvailableBoard[];
  partial: boolean;
};

/** Accepts `team.atlassian.net`, `https://team.atlassian.net`, or a pasted Jira board URL and returns its validated origin. */
export function normalizeSiteInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter your Jira Cloud site (e.g. https://your-team.atlassian.net).");
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Enter a valid Jira Cloud site URL (e.g. https://your-team.atlassian.net).");
  }
  if (parsed.protocol !== "https:") throw new Error("Jira site URL must use https://.");
  if (parsed.username || parsed.password) throw new Error("Jira site URL must not include credentials.");
  return siteURL(parsed.origin);
}

function setupReader(site: string, email: string, token: string, fetchImpl: SetupFetch) {
  const auth = `Basic ${btoa(`${email}:${token}`)}`;
  return async <T = unknown>(path: string, board?: number): Promise<T> => {
    try {
      let response: Response;
      try {
        response = await fetchImpl(`${site}${path}`, {
          headers: { Authorization: auth, Accept: "application/json" },
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError")
          throw new JiraTimeout("GET", path, READ_TIMEOUT_MS);
        throw error;
      }
      const text = await response.text();
      if (!response.ok) throw new JiraError("GET", path, response.status, text);
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new NotJiraAnswer(path);
      }
    } catch (error) {
      throw new Error(jiraProblem(error, site, board), { cause: error });
    }
  };
}

async function rejectedCredentials(site: string, fetchImpl: SetupFetch): Promise<Error> {
  const host = new URL(site).host;
  const isJira = await fetchImpl(`${site}/rest/api/3/serverInfo`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  }).then(
    async (r) => r.ok && typeof ((await r.json()) as { baseUrl?: unknown })?.baseUrl === "string",
    () => false,
  );
  return new Error(
    isJira
      ? `${host} rejected your email and API token (401). Use the email you sign in to Jira with, and an API token from ${TOKEN_PAGE}, not your password.`
      : `Jira rejected your email and API token (401), and ${host} doesn't answer as a Jira Cloud site. Check the site address first (https://your-team.atlassian.net).`,
  );
}

/** Validates Jira Cloud credentials against `/rest/api/3/myself` and lists boards visible to this account. */
export async function connectJiraAccount(
  input: { site: string; email: string; token: string },
  fetchImpl: SetupFetch = fetch,
): Promise<SetupConnectResult> {
  const site = normalizeSiteInput(input.site);
  const email = input.email.trim();
  const token = input.token.trim();
  if (!email || !email.includes("@")) throw new Error("Enter the email you sign in to Jira with.");
  if (!token) throw new Error(`Paste your Jira API token (create one at ${TOKEN_PAGE}).`);

  const read = setupReader(site, email, token, fetchImpl);
  const profile = await read<{
    accountId?: string;
    displayName?: string;
    avatarUrls?: Record<string, string>;
  }>("/rest/api/3/myself").catch(async (error: Error) => {
    if ((error.cause as JiraError | undefined)?.status === 401) throw await rejectedCredentials(site, fetchImpl);
    throw error;
  });
  if (!profile.accountId) {
    throw new Error(`${new URL(site).host} answered without an account. Check that the email and token are for this site.`);
  }

  const { boards, partial } = await listJiraBoards((path) => read(path), { maxPages: 6 });
  return {
    site,
    user: {
      id: profile.accountId,
      name: profile.displayName ?? email,
      avatar: profile.avatarUrls?.["48x48"] ?? profile.avatarUrls?.["32x32"],
    },
    boards,
    partial,
  };
}

/** Server-side Jira board search during setup for large orgs where initial listing was capped (`partial`). */
export async function searchSetupBoards(
  input: { site: string; email: string; token: string; name: string },
  fetchImpl: SetupFetch = fetch,
): Promise<AvailableBoardsResult> {
  const site = normalizeSiteInput(input.site);
  const email = input.email.trim();
  const token = input.token.trim();
  if (!email || !token) throw new Error("Connect your Jira account first.");
  const read = setupReader(site, email, token, fetchImpl);
  return listJiraBoards((path) => read(path), { name: input.name, maxPages: 4 });
}

/** Parses and verifies every chosen board ID or pasted Jira board link against Jira before saving setup. */
export async function verifySetupBoards(
  input: { site: string; email: string; token: string; boards: (number | string)[] },
  fetchImpl: SetupFetch = fetch,
): Promise<number[]> {
  const site = normalizeSiteInput(input.site);
  const email = input.email.trim();
  const token = input.token.trim();
  if (!email || !token) throw new Error("Connect your Jira account first.");
  const parsed = input.boards.map((entry) =>
    typeof entry === "number" ? entry : boardFromInput(entry, site),
  );
  if (!parsed.length) throw new Error("Pick at least one Jira space to continue.");
  const ids = boardIDs(parsed);
  const read = setupReader(site, email, token, fetchImpl);
  for (const id of ids) {
    await read(`/rest/agile/1.0/board/${id}`, id);
    await read(`/rest/agile/1.0/board/${id}/configuration`, id);
  }
  return ids;
}

/**
 * Writes Jira credentials to `<home>/credentials.env` (or existing legacy `.env`, both `0600`) and non-secret settings to
 * `<home>/settings.json`, preserving unrelated lines, then reloads in-memory env & `localSettings`.
 */
export async function saveInstanceSetup(
  credentials: { email: string; token: string },
  settings: LocalSettings,
  home?: string,
) {
  const targetHome = home ?? instanceHome();
  await mkdir(targetHome, { recursive: true });
  const envPath = credentialsPath(targetHome);
  const previous = await Bun.file(envPath)
    .text()
    .catch(() => "");
  const retained = previous
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:export\s+)?JIRA_(?:EMAIL|TOKEN|URL|BOARDS)\s*=/.test(line))
    .join("\n")
    .trimEnd();
  await Bun.write(
    envPath,
    `${retained}${retained ? "\n" : ""}JIRA_EMAIL=${JSON.stringify(credentials.email)}\nJIRA_TOKEN=${JSON.stringify(credentials.token)}\n`,
  );
  await chmod(envPath, 0o600);

  const settingsFile = home ? join(targetHome, "settings.json") : settingsPath();
  await Bun.write(settingsFile, JSON.stringify(settings, null, 2) + "\n");

  if (!home || targetHome === process.env.BETTER_JIRA_HOME) {
    process.env.JIRA_EMAIL = credentials.email;
    process.env.JIRA_TOKEN = credentials.token;
    delete process.env.JIRA_URL;
    delete process.env.JIRA_BOARDS;
    reloadLocalSettings(settings);
  }
}
