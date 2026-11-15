import { localSettings, serverAuth } from "./server-config";
import type { LocalSettings } from "./config";

/** Whether edits go to Jira. The switch is setup's: `writes: true` saved with the site it configured
 *  (.better-jira.local.json), read only by the production server (`bun start`), so `bun run dev` or a bare build never
 *  writes. Env `JIRA_WRITES=off` turns it off; `JIRA_WRITES=<site>` turns it on for that exact site. No site is writable
 *  by name in the code. */
export const canWrite = (
  site: string,
  settings: Pick<LocalSettings, "site" | "writes"> = localSettings,
  env: Record<string, string | undefined> = process.env,
) =>
  env.JIRA_WRITES !== "off" &&
  env.NODE_ENV === "production" &&
  ((settings.writes === true && settings.site === site) || env.JIRA_WRITES === site);
/** POST is Jira's documented bulk changelog READ; it changes no issues. */
const isRead = (method: string, path: string) =>
  method === "GET" || (method === "POST" && path === "/rest/api/3/changelog/bulkfetch");

/** How long one Jira request (answer and body) may take before it is given up, in ms; an upload gets longer. */
export const jiraTimeouts = { request: 30_000, upload: 120_000 };

/** Jira didn't answer in time. Not a refusal: a write that timed out may still have reached Jira. */
export class JiraTimeout extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly ms: number,
  ) {
    super(`Jira ${method} ${path} didn't answer within ${ms / 1000}s.`);
  }
}

/** Jira REST call. Waits and retries on 429 (rate limit), throws on any other non-2xx, and gives up a request that stalls
 *  past its timeout with a `JiraTimeout` (each attempt gets its own; a caller's `signal` still aborts it). */
export async function jira<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const { site, email, token } = serverAuth();
  if (!isRead(method, path) && !canWrite(site))
    throw new Error(`Jira writes are disabled for ${site}.`);
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Jira paths must be relative to the configured site.");
  const form = init.body instanceof FormData;
  const ms = form ? jiraTimeouts.upload : jiraTimeouts.request;
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(ms);
    try {
      const res = await fetch(site + path, {
        ...init,
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
        headers: {
          Authorization: "Basic " + btoa(`${email}:${token}`),
          Accept: "application/json",
          ...(form ? { "X-Atlassian-Token": "no-check" } : { "Content-Type": "application/json" }),
          ...init.headers,
        },
      });
      if (res.status === 429 && attempt < 5) {
        await Bun.sleep(Number(res.headers.get("Retry-After") ?? 2 ** attempt) * 1000);
        continue;
      }
      if (!res.ok) throw new JiraError(method, path, res.status, await res.text());
      const text = res.status === 204 ? "" : await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (e) {
      if (timeout.aborted && !init.signal?.aborted) throw new JiraTimeout(method, path, ms);
      throw e;
    }
  }
}

/** Jira answers some refusals with a bare code; say what it means (R2-comments-D4). */
const CODES: Record<string, string> = {
  CONTENT_LIMIT_EXCEEDED:
    "The text is longer than Jira allows (32,767 characters). Shorten it and send again.",
};
const humanReason = (message: string) => {
  const code = message.replace(/^[\w.-]+: /, "");
  return CODES[code] ?? message;
};

export class JiraError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`Jira ${method} ${path} → ${status}: ${body}`);
  }
  /** Jira's own explanation, for a toast. */
  get reason(): string {
    try {
      const b = JSON.parse(this.body);
      const messages = [
        ...(b.errorMessages ?? []),
        ...Object.entries(b.errors ?? {}).map(([k, v]) => `${k}: ${v}`),
      ];
      if (messages.length) return [...new Set(messages.map(humanReason))].join("; ");
    } catch {}
    return `Jira returned ${this.status}`;
  }
}
