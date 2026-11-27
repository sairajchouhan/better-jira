/** Sandbox Jira helper shared by `verify-better-jira`'s `verify.sh` and the real-Jira suite in `e2e-real/`.
 *    bun scripts/personal-jira.ts get <path>                    read-only GET on its REST API, prints JSON
 *    bun scripts/personal-jira.ts serve <port> <cache> <dist>   builds this checkout to <dist> and runs it in production on the
 *                                                               personal sandbox instance, on <port> with its own <cache>
 *  Configure via `instances/personal/` (or `REAL_JIRA_HOME` and optional `REAL_JIRA_SITE` pin).
 *  Credentials are read from the instance's credentials file into this process only: never printed, never exported.
 *  Runs under Node (Playwright) and Bun. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { jiraAuth, siteURL, type JiraAuth } from "../src/server/config";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const PERSONAL = process.env.REAL_JIRA_HOME
  ? path.resolve(process.env.REAL_JIRA_HOME)
  : path.join(REPO_ROOT, "instances", "personal");

function readPersonalSettings(): Record<string, any> {
  const settingsPath = path.join(PERSONAL, "settings.json");
  if (!existsSync(settingsPath)) return {};
  return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, any>;
}

function readPersonalEnv(): Record<string, string | undefined> {
  const credsPath = existsSync(path.join(PERSONAL, "credentials.env"))
    ? path.join(PERSONAL, "credentials.env")
    : path.join(PERSONAL, ".env");
  return existsSync(credsPath) ? parseEnv(readFileSync(credsPath, "utf8")) : {};
}

function resolveSandboxSite(): string {
  if (process.env.REAL_JIRA_SITE?.trim()) return siteURL(process.env.REAL_JIRA_SITE.trim());
  try {
    const settings = readPersonalSettings();
    if (settings.site) return siteURL(settings.site);
    const env = readPersonalEnv();
    if (env.JIRA_URL) return siteURL(env.JIRA_URL);
  } catch {}
  return "";
}

export const SITE = resolveSandboxSite();
const RESERVED_PORTS = new Set([3000, 3002, 3003, 6000]);

/** The personal sandbox instance's site and credentials. Throws if `REAL_JIRA_SITE` is pinned and does not match. */
export function personalAuth(): JiraAuth {
  const env = readPersonalEnv();
  const settings = readPersonalSettings();
  const auth = jiraAuth(env, settings);
  const pinned = process.env.REAL_JIRA_SITE?.trim() ? siteURL(process.env.REAL_JIRA_SITE.trim()) : SITE;
  if (!pinned || auth.site !== pinned) {
    throw new Error(`refusing: personal instance is on ${new URL(auth.site).hostname}, expected ${pinned || "REAL_JIRA_SITE"}`);
  }
  return auth;
}

/** One REST call to the personal sandbox Jira, answering its JSON (null for an empty answer). Throws on a non-2xx answer. */
export async function personalJira<T = any>(apiPath: string, init: RequestInit = {}): Promise<T> {
  const { site, email, token } = personalAuth();
  const response = await fetch(site + apiPath, {
    ...init,
    headers: {
      Authorization: `Basic ${btoa(`${email}:${token}`)}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Jira ${init.method ?? "GET"} ${apiPath} answered ${response.status}: ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function serve(port: number, cache: string, dist: string) {
  if (!Number.isSafeInteger(port) || RESERVED_PORTS.has(port)) throw new Error(`port ${port} is reserved`);
  const { site } = personalAuth();
  // Shell env beats the instance's credentials file, so these pins win: its own port, cache, build, trips log, and write site.
  const { JIRA_URL: _url, JIRA_EMAIL: _email, JIRA_TOKEN: _token, ...shell } = process.env;
  const child = spawn("bun", ["scripts/instance.ts", "start", PERSONAL], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: {
      ...shell,
      PORT: String(port),
      JIRA_WRITES: site,
      JIRA_CACHE: cache,
      BETTER_JIRA_DIST: dist,
      JIRA_TRIPS: path.resolve(REPO_ROOT, dist, "trips.jsonl"),
    },
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "get" && args[0]) console.log(JSON.stringify(await personalJira(args[0]), null, 1));
    else if (command === "serve" && args.length === 3) serve(Number(args[0]), args[1]!, args[2]!);
    else throw new Error("usage: bun scripts/personal-jira.ts get <path> | serve <port> <cache> <dist>");
  } catch (error) {
    console.error(`personal-jira: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
