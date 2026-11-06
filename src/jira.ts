import { serverAuth } from "./server-config";

/** Jira REST call. Waits and retries on 429 (rate limit), throws on any other non-2xx. */
export async function jira<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const method=(init.method??"GET").toUpperCase();
  if(method!=="GET" && !(method==="POST" && path==="/rest/api/3/changelog/bulkfetch")) {
    throw new Error("Jira writes are disabled. Only reads and the bulk changelog read are allowed.");
  }
  const {site,email,token}=serverAuth();
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Jira paths must be relative to the configured site.");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(site + path, {
      ...init,
      headers: { Authorization: "Basic "+btoa(`${email}:${token}`), Accept: "application/json", "Content-Type": "application/json", ...init.headers },
    });
    if (res.status === 429 && attempt < 5) {
      await Bun.sleep(Number(res.headers.get("Retry-After") ?? 2 ** attempt) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`Jira ${init.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    return res.status === 204 ? (undefined as T) : res.json();
  }
}
