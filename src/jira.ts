const { JIRA_EMAIL, JIRA_TOKEN } = process.env;
if (!JIRA_EMAIL || !JIRA_TOKEN) throw new Error("Set JIRA_EMAIL and JIRA_TOKEN in .env");

export const SITE = "https://contentstack.atlassian.net";
const AUTH = "Basic " + btoa(`${JIRA_EMAIL}:${JIRA_TOKEN}`);

/** Jira REST call. Waits and retries on 429 (rate limit), throws on any other non-2xx. */
export async function jira<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(SITE + path, {
      ...init,
      headers: { Authorization: AUTH, Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    });
    if (res.status === 429 && attempt < 5) {
      await Bun.sleep(Number(res.headers.get("Retry-After") ?? 2 ** attempt) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Jira ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : res.json();
  }
}
