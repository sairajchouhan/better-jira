/** Jira avatar URLs often point at Gravatar's wp.com image proxy, which Chrome blocks cross-origin (ERR_BLOCKED_BY_ORB),
 * and site-hosted avatars need a Jira login. So the browser loads every avatar through this same-origin proxy. */
export const avatarSrc = (url?: string) =>
  url && /^https?:\/\//.test(url) ? `/api/avatar?url=${encodeURIComponent(url)}` : url;

export type AvatarCache = {
  get(url: string): { type: string; body: Uint8Array; at: number } | undefined;
  set(url: string, type: string, body: Uint8Array): void;
};
const MAX_BYTES = 512 * 1024;
const FRESH_MS = 24 * 3600_000;
const AVATAR_HOSTS = [
  /(^|\.)atl-paas\.net$/,
  /(^|\.)atlassian\.com$/,
  /(^|\.)gravatar\.com$/,
  /(^|\.)wp\.com$/,
];

/** Only the configured Jira site gets credentials; other hops must be https avatar hosts. Redirects are followed by hand so each hop is checked. */
export function avatarProxy({
  site,
  auth,
  cache,
  fetcher = fetch,
}: {
  site: string;
  auth?: { email: string; token: string };
  cache: AvatarCache;
  fetcher?: typeof fetch;
}) {
  const origin = new URL(site).origin;
  const allowed = (url: URL) =>
    url.origin === origin ||
    (url.protocol === "https:" && AVATAR_HOSTS.some((host) => host.test(url.hostname)));
  const image = (type: string, body: Uint8Array) =>
    new Response(body as Uint8Array<ArrayBuffer>, {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
    });
  const missing = () =>
    new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=300" } });

  async function load(start: string) {
    let url = new URL(start);
    for (let hop = 0; hop < 5; hop++) {
      if (!allowed(url)) return;
      const res = await fetcher(url, {
        redirect: "manual",
        headers: {
          Accept: "image/*",
          ...(auth && url.origin === origin
            ? { Authorization: "Basic " + btoa(`${auth.email}:${auth.token}`) }
            : {}),
        },
        signal: AbortSignal.timeout(10_000),
      });
      const next = res.headers.get("Location");
      if (res.status >= 300 && res.status < 400 && next) {
        url = new URL(next, url);
        continue;
      }
      const type = res.headers.get("Content-Type")?.split(";")[0]?.trim() ?? "";
      if (!res.ok || !type.startsWith("image/") || type.includes("svg")) return; // SVG can carry script
      if (Number(res.headers.get("Content-Length") ?? 0) > MAX_BYTES) return;
      const body = new Uint8Array(await res.arrayBuffer());
      return body.byteLength > MAX_BYTES ? undefined : { type, body };
    }
  }

  return async (req: Request) => {
    const raw = new URL(req.url).searchParams.get("url") ?? "";
    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return new Response("Bad avatar URL", { status: 400 });
    }
    if (!allowed(target)) return new Response("Avatar host not allowed", { status: 403 });
    const hit = cache.get(raw);
    if (hit && Date.now() - hit.at < FRESH_MS) return image(hit.type, hit.body);
    const fresh = await load(raw).catch(() => "failed" as const);
    if (fresh && fresh !== "failed") {
      cache.set(raw, fresh.type, fresh.body);
      return image(fresh.type, fresh.body);
    }
    if (hit) return image(hit.type, hit.body); // a stale copy beats initials while offline
    // A network failure may pass, so the browser must ask again; a real miss is cached briefly.
    return fresh === "failed"
      ? new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } })
      : missing();
  };
}

/** In-memory cache for tests and the browser fixture; the server keeps avatars in its SQLite mirror. */
export function memoryAvatarCache(): AvatarCache {
  const store = new Map<string, { type: string; body: Uint8Array; at: number }>();
  return {
    get: (url) => store.get(url),
    set: (url, type, body) => store.set(url, { type, body, at: Date.now() }),
  };
}
