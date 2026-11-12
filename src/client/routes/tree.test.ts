import { expect, test } from "bun:test";
import { createMemoryHistory, isNotFound } from "@tanstack/react-router";
import { viewForRoute, type SavedView } from "@/shared/saved-view-model";
import { defaultPreferences } from "@/shared/view-model";
import type { Place } from "@/client/features/navigation/navigation";
import { createAppRouter, type RouteContext } from "./tree";

const p = defaultPreferences();
const triage = { id: "v1", name: "Triage", board: 1, filters: p.filters, display: p.display, scope: p.scope } as SavedView;
const issues: Record<string, { key: string; board: number }> = { "A-1": { key: "A-1", board: 1 }, "B-1": { key: "B-1", board: 2 } };

/** Opens an address on a fresh router; returns where it landed, what it showed, and whether it was not found. */
async function open(href: string, state?: Record<string, unknown>) {
  const shown: Place[] = [],
    preloaded: string[] = [];
  const context: RouteContext = {
    show: (place) => void shown.push(place),
    preload: async (key) => void preloaded.push(key),
    issue: (key) => issues[key],
    currentKey: (key) => (key === "OLD-1" ? "A-1" : key),
    view: (segment) => viewForRoute([triage], segment),
    hasBoard: (board) => board === 1 || board === 2,
    scope: (board) => (board === 2 ? "active" : "all"),
    lastBoard: () => 2,
  };
  const history = createMemoryHistory({ initialEntries: [href] });
  if (state) history.replace(href, state as never);
  const router = createAppRouter(history, context);
  await router.load();
  while (router.state.status !== "idle" || router.state.location.href !== history.location.href) await Bun.sleep(1);
  const notFound = router.state.matches.some((m) => m.status === "notFound" || m.globalNotFound || isNotFound(m.error));
  return { at: history.location.pathname + history.location.search, shown: shown.at(-1), notFound, preloaded, router };
}

test("D7: old addresses redirect to the paths that replaced them, replacing the entry", async () => {
  const cases: [string, string][] = [
    ["/", "/team/2/active"],
    ["/?board=1", "/team/1/all"],
    ["/?board=1&issue=A-1&view=side", "/team/1/all?issue=A-1"],
    ["/?board=1&issue=OLD-1", "/team/1/all?issue=A-1"],
    ["/?board=1&issue=A-1&view=page", "/issue/A-1"],
    ["/?board=1&issue=A-1&document=d1", "/issue/A-1/document/d1"],
    ["/?board=1&inbox=1&issue=A-1", "/inbox?issue=A-1"],
    ["/?board=1&mine=1", "/my-issues"],
    ["/user/alex/activity", "/profiles/alex/activity"],
    ["/views?board=1", "/team/1/views"],
    ["/view/v1?board=1", "/view/triage-v1"],
    ["/view/v1/edit?board=1", "/view/triage-v1/edit"],
  ];
  for (const [from, to] of cases) {
    const { at, router } = await open(from);
    expect([from, at]).toEqual([from, to]);
    expect(router.history.length).toBe(1);
  }
});

test("an issue page keeps the list it opened over in history state; a renamed key and a stale view slug redirect", async () => {
  const over = { to: "board", board: 2, scope: "active" } as const;
  expect((await open("/issue/A-1", { over })).shown).toEqual({ to: "issue", key: "A-1", over });
  const renamed = await open("/issue/OLD-1/some-slug", { over });
  expect(renamed.at).toBe("/issue/A-1/some-slug");
  expect(renamed.shown).toEqual({ to: "issue", key: "A-1", over });
  expect((await open("/view/old-name-v1?issue=A-1")).at).toBe("/view/triage-v1?issue=A-1");
  expect((await open("/issue/A-1/document/d1")).shown).toEqual({ to: "issue", key: "A-1", document: "d1" });
});

test("each path shows its place; unknown issues, boards, tabs and views are not found", async () => {
  expect((await open("/team/1/backlog?issue=B-1")).shown).toEqual({ to: "board", board: 1, scope: "backlog", issue: "B-1" });
  expect((await open("/my-issues/created")).shown).toEqual({ to: "person", person: null, tab: "created" });
  expect((await open("/profiles/alex")).shown).toEqual({ to: "person", person: "alex", tab: "assigned" });
  expect((await open("/inbox?notification=n1")).shown).toEqual({ to: "inbox" });
  for (const href of ["/issue/GONE-1", "/team/1/all?issue=GONE-1", "/team/9/all", "/team/1/someday", "/my-issues/assigned", "/my-issues/nope", "/view/nothing"]) {
    const { notFound, shown } = await open(href);
    expect([href, notFound, shown]).toEqual([href, true, undefined]);
  }
});

test("hovering a link preloads its issue without showing it", async () => {
  const { router, preloaded, shown } = await open("/team/1/all");
  await router.preloadRoute({ to: "/issue/$key/{-$slug}", params: { key: "B-1" } });
  expect(preloaded).toContain("B-1");
  expect(shown).toEqual({ to: "board", board: 1, scope: "all" });
});
