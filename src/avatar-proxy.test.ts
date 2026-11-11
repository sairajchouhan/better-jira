import { expect, test } from "bun:test";
import { avatarProxy, avatarSrc, memoryAvatarCache } from "./avatar-proxy";

const SITE = "https://acme.atlassian.net";
const png = new Uint8Array([137, 80, 78, 71]);
const ask = (url: string) =>
  new Request(`http://localhost/api/avatar?url=${encodeURIComponent(url)}`);

function fake(routes: Record<string, () => Response>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetcher = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    return routes[url]?.() ?? new Response(null, { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}
const image = (type = "image/png", body: BodyInit = png) =>
  new Response(body, { headers: { "Content-Type": type } });
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to } });
const auth = { email: "me@acme.test", token: "t" };

test("avatarSrc routes absolute URLs through the proxy only", () => {
  expect(avatarSrc("https://i0.wp.com/a.png")).toBe(
    "/api/avatar?url=https%3A%2F%2Fi0.wp.com%2Fa.png",
  );
  expect(avatarSrc("data:image/png;base64,x")).toBe("data:image/png;base64,x");
  expect(avatarSrc(undefined)).toBeUndefined();
});

test("rejects bad URLs and hosts outside the site and avatar CDNs", async () => {
  const { fetcher, calls } = fake({});
  const proxy = avatarProxy({ site: SITE, cache: memoryAvatarCache(), fetcher });
  expect((await proxy(ask("not a url"))).status).toBe(400);
  expect((await proxy(ask("https://evil.test/a.png"))).status).toBe(403);
  expect((await proxy(ask("http://i0.wp.com/a.png"))).status).toBe(403); // CDN hops must be https
  expect(calls).toHaveLength(0);
});

test("follows a Gravatar redirect to wp.com, sending credentials only to the Jira site", async () => {
  const start = `${SITE}/rest/api/3/universal_avatar/view/type/user/avatar/1`;
  const { fetcher, calls } = fake({
    [start]: () =>
      redirect("https://secure.gravatar.com/avatar/x?d=https%3A%2F%2Fi0.wp.com%2Fy.png"),
    "https://secure.gravatar.com/avatar/x?d=https%3A%2F%2Fi0.wp.com%2Fy.png": () =>
      redirect("https://i0.wp.com/y.png"),
    "https://i0.wp.com/y.png": () => image(),
  });
  const res = await avatarProxy({ site: SITE, auth, cache: memoryAvatarCache(), fetcher })(
    ask(start),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  expect(calls.map((c) => Boolean(c.auth))).toEqual([true, false, false]);
});

test("stops at a redirect to a disallowed host", async () => {
  const { fetcher, calls } = fake({
    "https://i1.wp.com/a.png": () => redirect("https://evil.test/a.png"),
  });
  const res = await avatarProxy({ site: SITE, cache: memoryAvatarCache(), fetcher })(
    ask("https://i1.wp.com/a.png"),
  );
  expect(res.status).toBe(404);
  expect(calls).toHaveLength(1);
});

test("refuses non-images, SVG and oversized bodies", async () => {
  const { fetcher } = fake({
    "https://i0.wp.com/html": () => image("text/html"),
    "https://i0.wp.com/svg": () => image("image/svg+xml"),
    "https://i0.wp.com/big": () => image("image/png", new Uint8Array(600 * 1024)),
  });
  const proxy = avatarProxy({ site: SITE, cache: memoryAvatarCache(), fetcher });
  for (const path of ["html", "svg", "big"])
    expect((await proxy(ask(`https://i0.wp.com/${path}`))).status).toBe(404);
});

test("serves from cache, and a stale copy when the refresh fails", async () => {
  let up = true;
  const { fetcher, calls } = fake({
    "https://i0.wp.com/a.png": () => (up ? image() : new Response(null, { status: 500 })),
  });
  const cache = memoryAvatarCache();
  const proxy = avatarProxy({ site: SITE, cache, fetcher });
  expect((await proxy(ask("https://i0.wp.com/a.png"))).status).toBe(200);
  expect((await proxy(ask("https://i0.wp.com/a.png"))).status).toBe(200);
  expect(calls).toHaveLength(1);
  const hit = cache.get("https://i0.wp.com/a.png")!;
  cache.get = () => ({ ...hit, at: 0 }); // expired
  up = false;
  expect((await proxy(ask("https://i0.wp.com/a.png"))).status).toBe(200);
  expect(calls).toHaveLength(2);
});

test("a network failure is not cached by the browser; a real miss is, briefly", async () => {
  const fetcher = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const res = await avatarProxy({ site: SITE, cache: memoryAvatarCache(), fetcher })(
    ask("https://i0.wp.com/a.png"),
  );
  expect([res.status, res.headers.get("Cache-Control")]).toEqual([502, "no-store"]);
  const miss = await avatarProxy({
    site: SITE,
    cache: memoryAvatarCache(),
    fetcher: fake({}).fetcher,
  })(ask("https://i0.wp.com/a.png"));
  expect([miss.status, miss.headers.get("Cache-Control")]).toEqual([404, "private, max-age=300"]);
});
