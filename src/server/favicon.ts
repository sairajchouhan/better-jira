import type { AvatarCache } from "@/shared/avatar-proxy";

const MAX_BYTES = 256 * 1024;
const FRESH_MS = 7 * 24 * 3600_000;
/** A site without an icon is asked again after a day. */
const MISS_MS = 24 * 3600_000;

/**
 * A smart link's site icon (`<origin>/favicon.ico`), fetched here and kept in the avatar table, so a description full of
 * links costs the browser only same-origin reads. No credentials go anywhere; SVG is refused (it can carry script).
 */
export function faviconProxy({ cache, fetcher = fetch, now = Date.now }: { cache: AvatarCache; fetcher?: typeof fetch; now?: () => number }) {
  const image = (type: string, body: Uint8Array) =>
    new Response(body as Uint8Array<ArrayBuffer>, {
      headers: { "Content-Type": type, "Cache-Control": "private, max-age=604800" },
    });
  const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, max-age=86400" } });
  async function load(origin: string) {
    let url = new URL("/favicon.ico", origin);
    for (let hop = 0; hop < 5; hop++) {
      if (!/^https?:$/.test(url.protocol)) return null;
      const res = await fetcher(url, { redirect: "manual", headers: { Accept: "image/*" }, signal: AbortSignal.timeout(5000) });
      const next = res.headers.get("Location");
      if (res.status >= 300 && res.status < 400 && next) {
        url = new URL(next, url);
        continue;
      }
      const type = res.headers.get("Content-Type")?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!res.ok || !type.startsWith("image/") || type.includes("svg")) return null;
      const body = new Uint8Array(await res.arrayBuffer());
      return body.byteLength && body.byteLength <= MAX_BYTES ? { type, body } : null;
    }
    return null;
  }
  return async (req: Request) => {
    let origin: string;
    try {
      const url = new URL(new URL(req.url).searchParams.get("origin") ?? "");
      if (!/^https?:$/.test(url.protocol)) throw new Error();
      origin = url.origin;
    } catch {
      return new Response("Bad site", { status: 400 });
    }
    const key = `favicon:${origin}`,
      hit = cache.get(key);
    if (hit && now() - hit.at < (hit.body.byteLength ? FRESH_MS : MISS_MS))
      return hit.body.byteLength ? image(hit.type, hit.body) : missing();
    const fresh = await load(origin).catch(() => undefined);
    if (fresh) {
      cache.set(key, fresh.type, fresh.body);
      return image(fresh.type, fresh.body);
    }
    if (hit?.body.byteLength) return image(hit.type, hit.body);
    // A site with no icon is remembered as an empty row; a network failure is asked about again.
    if (fresh === null) cache.set(key, "", new Uint8Array());
    return missing();
  };
}
