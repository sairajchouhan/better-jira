import { expect, test } from "bun:test";
import { createMemoryHistory, isNotFound } from "@tanstack/react-router";
import { viewForRoute, type SavedView } from "@/shared/saved-view-model";
import { defaultPreferences } from "@/shared/view-model";
import type { Place } from "@/client/features/navigation/navigation";
import { createAppRouter, locationOf, notFoundTitle, routeNotFound, routeURL, type RouteContext } from "./tree";

const p = defaultPreferences();
const triage = { id: "v1", name: "Triage", board: 1, filters: p.filters, display: p.display, scope: p.scope } as SavedView;
const issues: Record<string, { key: string; boards: number[] }> = { "A-1": { key: "A-1", boards: [1] }, "B-1": { key: "B-1", boards: [2] } };

/** Issues Jira has that the mirror lists only once something asks for them by key (on no board). */
const inJira: Record<string, { key: string; boards: number[] }> = { "OFF-7": { key: "OFF-7", boards: [] } };

/** Opens an address on a fresh router; returns where it landed, what it showed, and whether it was not found. */
async function open(href: string, state?: Record<string, unknown>) {
  const shown: Place[] = [],
    preloaded: string[] = [];
  const context: RouteContext = {
    show: (place) => void shown.push(place),
    preload: async (key) => void preloaded.push(key),
    issue: (key) => issues[key],
    keep: async (key) => {
      if (!(key in inJira)) return false;
      issues[key] = inJira[key]!;
      return true;
    },
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
  const notFound = router.state.matches.some((m) => m.status === "notFound" || isNotFound(m.error));
  // What the sidebar reads to light no row on a Not found screen (R3-chrome-D7).
  expect(routeNotFound(router.state.matches)).toBe(notFound || href.startsWith("/nope"));
  return { at: history.location.pathname + history.location.search, shown: shown.at(-1), notFound, preloaded, router };
}

test("D7: old addresses redirect to the paths that replaced them, replacing the entry", async () => {
  const cases: [string, string][] = [
    ["/", "/board/2/active"],
    ["/?board=1", "/board/1/all"],
    ["/?board=1&issue=A-1&view=side", "/board/1/all?issue=A-1"],
    ["/?board=1&issue=OLD-1", "/board/1/all?issue=A-1"],
    ["/?board=1&issue=A-1&view=page", "/issue/A-1"],
    ["/?board=1&issue=A-1&document=d1", "/issue/A-1/document/d1"],
    ["/?board=1&inbox=1&issue=A-1", "/issue/A-1"],
    ["/?board=1&mine=1", "/my-issues"],
    ["/user/alex/activity", "/profiles/alex/activity"],
    ["/views?board=1", "/board/1/all"],
    ["/team/1/views", "/board/1/all"],
    ["/team/1/active?issue=A-1", "/board/1/active?issue=A-1"],
    ["/view/v1?board=1", "/view/triage-v1"],
    ["/view/v1/edit?board=1", "/view/triage-v1/edit"],
    // R3-views-filters-D-4: a board without its tab opens its Issues tab.
    ["/board/1", "/board/1/all"],
    ["/board/2?issue=B-1", "/board/2/active?issue=B-1"],
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

test("item 5: the inbox's pane lives at its issue's own address, marked in history state; without the mark it is the issue's page", async () => {
  // Opening a notification: the issue's path, with Linear's `issueOrigin: {type: "inbox"}` in its entry, which a reload keeps.
  expect(locationOf({ to: "inbox", issue: "A-1" }, { view: () => undefined })).toMatchObject({
    to: "/issue/$key/{-$slug}",
    params: { key: "A-1" },
    state: { issueOrigin: "inbox" },
  });
  expect(locationOf({ to: "inbox" }, { view: () => undefined })).toMatchObject({ to: "/inbox" });
  expect((await open("/issue/A-1", { issueOrigin: "inbox" })).shown).toEqual({ to: "inbox", issue: "A-1" });
  // A renamed key keeps the mark as it moves to the current one.
  const renamed = await open("/issue/OLD-1", { issueOrigin: "inbox" });
  expect([renamed.at, renamed.shown]).toEqual(["/issue/A-1", { to: "inbox", issue: "A-1" }]);
  // The same address pasted or typed carries no state: the issue's page, over no list.
  expect((await open("/issue/A-1")).shown).toEqual({ to: "issue", key: "A-1" });
  // The pane's old address still opens the pane (navigation then moves it to the issue's address).
  expect((await open("/inbox?issue=A-1")).shown).toEqual({ to: "inbox", issue: "A-1" });
  // The old `?inbox=1` address lands on the pane too.
  expect((await open("/?board=1&inbox=1&issue=A-1")).shown).toEqual({ to: "inbox", issue: "A-1" });
});

test("each path shows its place; unknown issues, boards, tabs and views are not found", async () => {
  expect((await open("/board/1/backlog?issue=B-1")).shown).toEqual({ to: "board", board: 1, scope: "backlog", issue: "B-1" });
  expect((await open("/my-issues/created")).shown).toEqual({ to: "person", person: null, tab: "created" });
  expect((await open("/profiles/alex")).shown).toEqual({ to: "person", person: "alex", tab: "assigned" });
  expect((await open("/inbox?notification=n1")).shown).toEqual({ to: "inbox" });
  for (const href of ["/issue/GONE-1", "/board/1/all?issue=GONE-1", "/board/9/all", "/board/9", "/board/1/someday", "/my-issues/assigned", "/my-issues/nope", "/view/nothing"]) {
    const { notFound, shown } = await open(href);
    expect([href, notFound, shown]).toEqual([href, true, undefined]);
  }
});

test("R3-chrome-D7: an address that names nothing is Not found for the sidebar, which then lights no row", async () => {
  const { router, shown } = await open("/nope/xyz");
  expect(shown).toBeUndefined();
  expect(routeNotFound(router.state.matches)).toBe(true);
  expect(routeNotFound((await open("/issue/GONE-1")).router.state.matches)).toBe(true);
  expect(routeNotFound((await open("/board/1/all")).router.state.matches)).toBe(false);
});

test("hovering a link preloads its issue without showing it", async () => {
  const { router, preloaded, shown } = await open("/board/1/all");
  await router.preloadRoute({ to: "/issue/$key/{-$slug}", params: { key: "B-1" } });
  expect(preloaded).toContain("B-1");
  expect(shown).toEqual({ to: "board", board: 1, scope: "all" });
});


test("BJ-187: copied route and timestamp URLs use the router base path, target and search", async () => {
  const { router } = await open("/board/1/all");
  router.update({ ...router.options, basepath: "/jira" });
  const context = { view: (id: string) => id === triage.id ? triage : undefined };
  const cases: [Place, string][] = [
    [{ to: "board", board: 2, scope: "active", issue: "B-1" }, "/board/2/active?issue=B-1"],
    // The inbox's pane copies its issue's own address (Linear's `Notification.inboxPath()`).
    [{ to: "inbox", issue: "A-1" }, "/issue/A-1"],
    [{ to: "person", person: "alex", tab: "created" }, "/profiles/alex/created"],
    [{ to: "view", id: triage.id }, "/view/triage-v1"],
    [{ to: "issue", key: "A-1", document: "doc 1" }, "/issue/A-1/document/doc%201"],
  ];
  for (const [place, path] of cases) {
    expect(routeURL(router, locationOf(place, context), "https://example.test", "comment-12"))
      .toBe(`https://example.test/jira${path}#comment-12`);
  }
});

test("R3-board-D4: once the issue screens are preloaded, the side panel renders in the same pass instead of suspending", async () => {
  const { preloadIssueScreens, SidePanel } = await import("./tree");
  const { IssueSidePanel } = await import("./issue-view");
  await preloadIssueScreens();
  // Called as a function, it hands back the loaded panel at once; a component still loading would suspend (throw) here.
  const element = (SidePanel as unknown as (props: object) => { type: unknown })({ issue: issues["A-1"] });
  expect(element.type).toBe(IssueSidePanel);
});

test("BJ-341: an issue no board holds opens from its address once the mirror keeps it; one Jira lacks is not found", async () => {
  delete issues["OFF-7"];
  expect(await open("/issue/OFF-7")).toMatchObject({ notFound: false, shown: { to: "issue", key: "OFF-7" } });
  delete issues["OFF-7"];
  expect(await open("/board/1/all?issue=OFF-7")).toMatchObject({ notFound: false, shown: { to: "board", issue: "OFF-7" } });
  delete issues["OFF-7"];
  expect(await open("/issue/NONE-1")).toMatchObject({ notFound: true, shown: undefined });
});

// BJ-403: the not-found page names what's missing in Linear's words (\`x$(entity)\` → \`${entity} not found\`), never the key.
test("BJ-403: a missing issue, view or board is titled as Linear titles its model; an address naming nothing is Not found", async () => {
  const cases: [string, string][] = [
    ["/issue/NONE-1", "Issue not found"],
    ["/board/1/all?issue=GONE-1", "Issue not found"],
    ["/view/nothing", "View not found"],
    ["/board/9/all", "Space not found"],
    ["/board/9", "Space not found"],
    ["/board/1/someday", "Not found"],
    ["/my-issues/nope", "View not found"],
    ["/profiles/alex/nope", "View not found"],
    ["/nope/xyz", "Not found"],
  ];
  for (const [href, title] of cases) {
    const { router } = await open(href);
    const missing = router.state.matches.find((m) => isNotFound(m.error))?.error as { data?: unknown } | undefined;
    expect([href, notFoundTitle(missing?.data)]).toEqual([href, title]);
  }
});
