/** The personal Jira (cloudsairaj), shared by verify-better-jira's verify.sh and the real-Jira suite in e2e-real/.
 *    bun scripts/personal-jira.ts get <path>                    read-only GET on its REST API, prints JSON
 *    bun scripts/personal-jira.ts serve <port> <cache> <dist>   builds this checkout to <dist> and runs it in production on the
 *                                                               personal instance, on <port> with its own <cache>, writing to
 *                                                               cloudsairaj only
 *  Both refuse unless the personal instance's site is cloudsairaj. The credentials are read from the instance's `.env` into
 *  this process only: never printed, never put in process.env. Runs under Node (Playwright) and Bun. */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { jiraAuth, type JiraAuth } from "../src/server/config";

export const SITE = "https://cloudsairaj.atlassian.net";
export const PERSONAL = "/Users/sairaj.chouhan/cs/better-jira/instances/personal";
const RESERVED_PORTS = new Set([3000, 3002, 3003, 6000]);

/** The personal instance's site and credentials, resolved as the server resolves them (`JIRA_URL` in `.env`, else the saved
 *  site). Throws unless that site is cloudsairaj. */
export function personalAuth(): JiraAuth {
  const env = parseEnv(readFileSync(path.join(PERSONAL, ".env"), "utf8"));
  const settings = JSON.parse(readFileSync(path.join(PERSONAL, "settings.json"), "utf8"));
  const auth = jiraAuth(env, settings);
  if (auth.site !== SITE) throw new Error(`refusing: the personal instance is on ${new URL(auth.site).hostname}, not cloudsairaj`);
  return auth;
}

/** One REST call to cloudsairaj, answering its JSON (null for an empty answer). Throws on a non-2xx answer. */
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
  personalAuth();
  const root = path.resolve(import.meta.dirname, "..");
  // Shell env beats the instance's .env, so these pins win: its own port, cache, build and trips to Jira (kept in the build, not
  // the instance's log), and writes to cloudsairaj only.
  // A site or account in the shell would win too, past the check above: only the instance's own are kept.
  const { JIRA_URL: _url, JIRA_EMAIL: _email, JIRA_TOKEN: _token, ...shell } = process.env;
  const child = spawn("bun", ["scripts/instance.ts", "start", PERSONAL], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...shell,
      PORT: String(port),
      JIRA_WRITES: SITE,
      JIRA_CACHE: cache,
      BETTER_JIRA_DIST: dist,
      JIRA_TRIPS: path.resolve(root, dist, "trips.jsonl"),
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
