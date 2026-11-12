import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { memoryAvatarCache } from "@/shared/avatar-proxy";
import { faviconProxy } from "./favicon";
import { ISSUE_FRESH_MS, smartLinkCache } from "./smart-link";

const SITE = "https://acme.atlassian.net";
const jiraFake = () => {
  const reads: string[] = [];
  const read = async (path: string): Promise<any> => {
    reads.push(path);
    if (path.startsWith("/rest/api/3/issue/OPS-1?"))
      return { fields: { summary: "Rotate keys", status: { name: "In Review", statusCategory: { key: "indeterminate" } } } };
    if (path === "/wiki/api/v2/pages/42") return { id: "42", title: "Runbook" };
    throw Object.assign(new Error("Jira GET → 404"), { status: 404 });
  };
  return { reads, read };
};

test("BJ-16: an issue or Confluence page on the site is read once and kept in SQLite; other sites never", async () => {
  const db = new Database(":memory:"),
    { reads, read } = jiraFake();
  let now = 1_000;
  const resolve = smartLinkCache(db, SITE, read, () => now);
  const [a, b] = await Promise.all([resolve(`${SITE}/browse/OPS-1`), resolve(`${SITE}/browse/OPS-1`)]);
  expect(a).toEqual({ title: "Rotate keys", status: { name: "In Review", category: "indeterminate" } });
  expect(b).toEqual(a!);
  expect(await resolve(`${SITE}/wiki/spaces/ENG/pages/42/Old+title`)).toEqual({ title: "Runbook" });
  expect(await resolve("https://other.atlassian.net/browse/OPS-1")).toBeNull();
  expect(await resolve("https://github.com/acme/widgets/pull/1")).toBeNull();
  expect(reads).toEqual(["/rest/api/3/issue/OPS-1?fields=summary,status", "/wiki/api/v2/pages/42"]);
  // A new cache over the same database (a server restart) reads nothing while the rows are fresh.
  const again = smartLinkCache(db, SITE, read, () => now);
  expect(await again(`${SITE}/browse/OPS-1`)).toEqual(a!);
  expect(reads).toHaveLength(2);
  // A gone issue is remembered as nothing; an issue's row goes stale after its window.
  expect(await resolve(`${SITE}/browse/GONE-1`)).toBeNull();
  await resolve(`${SITE}/browse/GONE-1`);
  expect(reads.filter((p) => p.includes("GONE-1"))).toHaveLength(1);
  now += ISSUE_FRESH_MS + 1;
  await resolve(`${SITE}/browse/OPS-1`);
  expect(reads.filter((p) => p.includes("OPS-1"))).toHaveLength(2);
});

test("BJ-16: offline, the last title read still shows", async () => {
  const db = new Database(":memory:");
  let now = 0,
    offline = false;
  const resolve = smartLinkCache(
    db,
    SITE,
    async (): Promise<any> => {
      if (offline) throw new TypeError("fetch failed");
      return { fields: { summary: "Cached" } };
    },
    () => now,
  );
  expect(await resolve(`${SITE}/browse/OPS-2`)).toEqual({ title: "Cached" });
  offline = true;
  now += ISSUE_FRESH_MS + 1;
  expect(await resolve(`${SITE}/browse/OPS-2`)).toEqual({ title: "Cached" });
});

test("BJ-16: a site's icon is fetched by the server once, never with SVG or credentials", async () => {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const png = new Uint8Array([137, 80, 78, 71]);
  const fetcher = (async (input: URL, init: RequestInit) => {
    asked.push({ url: String(input), headers: init.headers as Record<string, string> });
    if (input.hostname === "moved.test") return new Response(null, { status: 301, headers: { Location: "https://cdn.test/icon.ico" } });
    if (input.hostname === "cdn.test" || input.hostname === "github.com")
      return new Response(png, { headers: { "Content-Type": "image/x-icon" } });
    if (input.hostname === "svg.test") return new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } });
    return new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;
  const proxy = faviconProxy({ cache: memoryAvatarCache(), fetcher });
  const get = (origin: string) => proxy(new Request(`http://local/api/favicon?origin=${encodeURIComponent(origin)}`));
  const first = await get("https://github.com/acme/widgets");
  expect(first.status).toBe(200);
  expect(new Uint8Array(await first.arrayBuffer())).toEqual(png);
  expect((await get("https://github.com")).status).toBe(200);
  expect(asked.map((a) => a.url)).toEqual(["https://github.com/favicon.ico"]);
  expect(asked[0]!.headers).not.toHaveProperty("Authorization");
  expect((await get("https://moved.test")).status).toBe(200);
  expect((await get("https://svg.test")).status).toBe(404);
  expect((await get("https://none.test")).status).toBe(404);
  await get("https://none.test");
  expect(asked.filter((a) => a.url.includes("none.test"))).toHaveLength(1);
  expect((await get("javascript:alert(1)")).status).toBe(400);
});
