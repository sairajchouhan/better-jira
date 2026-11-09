import { serverAuth } from "./server-config";

/** Only the personal test site accepts writes; every other site stays read-only. */
export const WRITABLE_SITES = new Set(["https://cloudsairaj.atlassian.net"]);
export const canWrite = (site: string) => WRITABLE_SITES.has(site);
/** POST is Jira's documented bulk changelog READ; it changes no issues. */
const isRead = (method: string, path: string) =>
  method === "GET" || (method === "POST" && path === "/rest/api/3/changelog/bulkfetch");

/** Jira REST call. Waits and retries on 429 (rate limit), throws on any other non-2xx. */
export async function jira<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const { site, email, token } = serverAuth();
  if (!isRead(method, path) && !canWrite(site))
    throw new Error(`Jira writes are disabled for ${site}.`);
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error("Jira paths must be relative to the configured site.");
  const form = init.body instanceof FormData;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(site + path, {
      ...init,
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
