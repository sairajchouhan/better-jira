/**
 * Every address the app has, as TanStack Router routes (code-based, no generator). Each route turns its params and
 * search into a `Place` (navigation.ts) and hands it to `context.show`, which puts it on screen; `locationOf` is the
 * reverse, for links and `navigate`. Old addresses redirect here (`legacyPlace`). Screens are lazy chunks, except the
 * boards, which the shell keeps mounted (App.tsx).
 */
import { inboxChunk, issueDocumentChunk, issueViewChunk } from "./route-chunks";
import { preloadAtStartup, ROUTE_ORDER } from "@/client/lib/loadable";
import {
  createLink,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  isNotFound,
  lazyRouteComponent,
  notFound,
  redirect,
  type ErrorComponentProps,
  type NotFoundRouteProps,
  type ParsedLocation,
  type RouterHistory,
} from "@tanstack/react-router";
import { Suspense } from "react";
import type { ListPlace, Place } from "@/client/features/navigation/navigation";
import type { Trail } from "@/client/features/navigation/issue-trail";
import { isPersonTab, type PersonTab } from "@/shared/people";
import { viewPath, type SavedView } from "@/shared/saved-view-model";
import type { Scope } from "@/shared/view-model";
import { missingIssueNote } from "@/shared/inbox-model";
import { AppLoading, EmptyState, LoadingState } from "@/client/components/empty-state";
import { Button, ButtonLink } from "@/client/components/button";
import { useStore } from "@/client/state/store";
import { boardFor } from "@/shared/board-membership";

declare module "@tanstack/history" {
  interface HistoryState {
    /** On an issue page: the list it opened over, so Escape, Back and reload return to it. */
    over?: ListPlace;
    /** This entry was already moved once to the address its screen shows. */
    settled?: boolean;
    /** The sidebar favorite this entry was opened from (Linear's `favoriteId`), so Back and reload keep its row active. */
    favorite?: string;
    /** On an issue page: how it was reached (issue-trail.ts), so Back and Forward keep its breadcrumb; a reload drops it. */
    trail?: Trail;
  }
}

/** What the routes need from the app: putting a place on screen, and the mirror's issues, views and boards. */
export type RouteContext = {
  /** Shows the place an address names. Never called for a preload. */
  show: (place: Place, location: ParsedLocation) => void;
  /** Loads an issue's details and the issue screens' code ahead of opening it; resolves when both are in. */
  preload: (key: string) => Promise<unknown>;
  issue: (key: string) => { key: string; boards: number[] } | undefined;
  /** Asks the mirror for an issue it doesn't list (one no board holds): resolves whether it now has it (BJ-341). */
  keep: (key: string) => Promise<boolean>;
  /** The key Jira renamed this one to, or the key itself. */
  currentKey: (key: string) => string;
  /** The saved view an address segment names: `<id>`, `<slug>-<id>` or a stale slug. */
  view: (segment: string) => SavedView | undefined;
  hasBoard: (board: number) => boolean;
  /** The board's Issues tab (its saved scope). */
  scope: (board: number) => Scope;
  /** The board `/` opens: the last one shown. */
  lastBoard: () => number;
};

const SCOPES = ["all", "active", "backlog"] as const;
const isScope = (s: unknown): s is Scope => SCOPES.includes(s as Scope);
/** Plain `?a=b` search params, never JSON-quoted, so addresses stay readable and old links parse as they did. */
const parseSearch = (search: string) => Object.fromEntries(new URLSearchParams(search));
const stringifySearch = (search: Record<string, unknown>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
/** A list's search: the issue open beside it. */
const listSearch = (search: Record<string, unknown>): { issue?: string } => ({ issue: text(search.issue) });
const issueDeps = ({ search }: { search: { issue?: string } }) => ({ issue: search.issue });

const rootRoute = createRootRouteWithContext<RouteContext>()({
  // Old `?board=…&issue=…` addresses, `/user/…` and `/views` land on today's paths (D7).
  beforeLoad: ({ location, context }) => {
    const place = legacyPlace(location.pathname, location.search as Record<string, string>, context);
    if (place) throw redirect({ ...locationOf(place, context), replace: true });
  },
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/" });

/** An issue the mirror doesn't list yet (linked from a board issue, a parent in another project) is asked for by key, as
 *  Linear hydrates a model its sync didn't bring (`hydrateModel`), and opens once the mirror keeps it; one Jira doesn't have
 *  is not found (BJ-341). An issue already listed opens in the same pass. */
function whenKept(key: string, asked: string, context: RouteContext): Promise<void> | void {
  if (context.issue(key)) return;
  return context.keep(key).then((found) => {
    if (!found || !context.issue(key)) throw notFound({ data: { issue: asked } });
  });
}
/** Then `next`, at once when nothing was waited for. */
const then = (waiting: Promise<void> | void, next: () => void) => (waiting ? waiting.then(next) : next());
/** The issue's beside-the-list check: a renamed key moves to the current one; an unknown key is kept or not found. */
function openBeside(issue: string | undefined, context: RouteContext, location: ParsedLocation) {
  if (!issue) return;
  const key = context.currentKey(issue);
  if (key !== issue)
    throw redirect({ to: location.pathname, search: { ...(location.search as object), issue: key }, replace: true } as never);
  return whenKept(key, issue, context);
}
// lazyRouteComponent, not React.lazy: once loaded it renders in the same pass. React.lazy suspends on its first render even
// when the module is already here, so the first issue opened after a load waited a task for its panel (R3-board-D4).
export const SidePanel = lazyRouteComponent(issueViewChunk.load, "IssueSidePanel");
const IssueScreen = lazyRouteComponent(issueViewChunk.load, "IssueScreen");
/** Loads the issue screens ahead (the idle walk, or a hover), so the first issue opened renders at once. */
export const preloadIssueScreens = () => Promise.all([SidePanel.preload?.(), IssueScreen.preload?.()]);
const InboxScreen = lazyRouteComponent(inboxChunk.load, "InboxScreen");
const DocumentScreen = lazyRouteComponent(issueDocumentChunk.load, "DocumentScreen");
preloadAtStartup("inbox", ROUTE_ORDER, () => InboxScreen.preload?.());
preloadAtStartup("issue-document", ROUTE_ORDER, () => DocumentScreen.preload?.());
// First in the walk with the editor, where startNavigation fetched them at the first idle before (R3-board-D4).
preloadAtStartup("issue-screens", 10, preloadIssueScreens);
/** A list route's own content: the open issue beside the boards the shell shows. */
function ListScreen() {
  const open = useStore((s) => (s.panel && s.selected && s.view === "side" && !s.document ? s.issues.get(s.selected) : undefined));
  return open ? (
    <Suspense>
      <SidePanel key={open.key} issue={open} />
    </Suspense>
  ) : null;
}
const listRoute = {
  validateSearch: listSearch,
  loaderDeps: issueDeps,
  loader: ({ context, deps, preload }: { context: RouteContext; deps: { issue?: string }; preload: boolean }) => {
    const loading = deps.issue ? context.preload(deps.issue) : undefined;
    // A hover waits for the issue; opening it shows its page at once and fills in as the details arrive.
    return preload ? loading : undefined;
  },
  component: ListScreen,
};

const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board/$board/$scope",
  ...listRoute,
  beforeLoad: ({ params, search, context, location, preload }) => {
    const board = Number(params.board),
      { scope } = params;
    if (!context.hasBoard(board) || !isScope(scope)) throw notFound();
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "board", board, scope, ...listSearch(search) }, location);
    });
  },
});
/** A board without its tab (`/board/<board>`): its Issues tab, as Linear sends a team URL to the team's default view. */
const boardHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/board/$board",
  beforeLoad: ({ params, context, location }) => {
    const board = Number(params.board);
    if (!context.hasBoard(board)) throw notFound();
    throw redirect({
      to: "/board/$board/$scope",
      params: { board: params.board, scope: context.scope(board) },
      search: location.search as never,
      replace: true,
    });
  },
});
/** The board address before boards were named in it (`/team/<board>/<scope>`, copied from Linear's team URL): same place, new path. */
const teamRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/team/$board/$scope",
  beforeLoad: ({ location }) => {
    throw redirect({ href: location.href.replace(/^\/team\//, "/board/"), state: location.state, replace: true });
  },
});
/** A view's address segment, `<slug>-<id>`; an old one redirects to it (BJ-155). */
const segmentOf = (view: Pick<SavedView, "id" | "name">) => decodeURIComponent(viewPath(view).slice("/view/".length));
function savedView(segment: string, context: RouteContext, location: ParsedLocation, suffix = "") {
  const view = context.view(segment);
  if (!view) throw notFound();
  if (segmentOf(view) !== segment)
    throw redirect({ href: `/view/${encodeURIComponent(segmentOf(view))}${suffix}${location.searchStr}`, replace: true });
  return view;
}
const viewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/view/$view",
  ...listRoute,
  validateSearch: (search: Record<string, unknown>) => ({ ...listSearch(search), filter: text(search.filter) }),
  beforeLoad: ({ params, search, context, location, preload }) => {
    const view = savedView(params.view, context, location);
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "view", id: view.id, ...listSearch(search), ...(search.filter ? { filter: search.filter } : {}) }, location);
    });
  },
});
const newViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/view/new",
  ...listRoute,
  beforeLoad: ({ search, context, location, preload }) => {
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "editor", ...listSearch(search) }, location);
    });
  },
});
const editViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/view/$view/edit",
  ...listRoute,
  beforeLoad: ({ params, search, context, location, preload }) => {
    const view = savedView(params.view, context, location, "/edit");
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "editor", id: view.id, ...listSearch(search) }, location);
    });
  },
});
/** `/my-issues[/tab]` and `/profiles/<user>[/tab]`: Assigned is the bare path. */
function personTab(tab: string | undefined): PersonTab {
  if (tab === undefined) return "assigned";
  if (!isPersonTab(tab) || tab === "assigned") throw notFound();
  return tab;
}
const myIssuesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/my-issues/{-$tab}",
  ...listRoute,
  beforeLoad: ({ params, search, context, location, preload }) => {
    const tab = personTab(params.tab);
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "person", person: null, tab, ...listSearch(search) }, location);
    });
  },
});
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/profiles/$user/{-$tab}",
  ...listRoute,
  beforeLoad: ({ params, search, context, location, preload }) => {
    const tab = personTab(params.tab);
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "person", person: params.user, tab, ...listSearch(search) }, location);
    });
  },
});
const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  ...listRoute,
  // `notification`: the selected row when its issue isn't mirrored, kept over a reload (R2-inbox-D6).
  validateSearch: (search: Record<string, unknown>) => ({ ...listSearch(search), notification: text(search.notification) }),
  beforeLoad: ({ search, context, location, preload }) => {
    return then(openBeside(search.issue, context, location), () => {
      if (!preload) context.show({ to: "inbox", ...listSearch(search) }, location);
    });
  },
  component: InboxScreen,
});
/** An issue page: a renamed key redirects to the current one, an unknown key is kept or not found. */
function issuePage(key: string, context: RouteContext, location: ParsedLocation) {
  const current = context.currentKey(key);
  if (current !== key) throw redirect({ href: location.href.replace(`/issue/${encodeURIComponent(key)}`, `/issue/${encodeURIComponent(current)}`), state: location.state, replace: true });
  return whenKept(current, key, context);
}
const issueLoader = (context: RouteContext, key: string, preload: boolean) => {
  const loading = context.preload(key);
  return preload ? loading : undefined;
};
const issueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/issue/$key/{-$slug}",
  beforeLoad: ({ params, context, location, preload }) => {
    return then(issuePage(params.key, context, location), () => {
      if (!preload) context.show({ to: "issue", key: params.key, ...(location.state.over ? { over: location.state.over } : {}) }, location);
    });
  },
  loader: ({ context, params, preload }) => issueLoader(context, params.key, preload),
  component: IssueScreen,
});
const documentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/issue/$key/document/$id",
  beforeLoad: ({ params, context, location, preload }) => {
    return then(issuePage(params.key, context, location), () => {
      if (!preload)
        context.show({ to: "issue", key: params.key, document: params.id, ...(location.state.over ? { over: location.state.over } : {}) }, location);
    });
  },
  loader: ({ context, params, preload }) => issueLoader(context, params.key, preload),
  component: DocumentScreen,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  boardRoute,
  boardHomeRoute,
  teamRoute,
  viewRoute,
  newViewRoute,
  editViewRoute,
  myIssuesRoute,
  profileRoute,
  inboxRoute,
  issueRoute,
  documentRoute,
]);

export function createAppRouter(history: RouterHistory, context: RouteContext) {
  return createRouter({
    routeTree,
    history,
    context,
    // A client-only app: without a DOM (tests) the router would otherwise act as a server and never navigate.
    isServer: false,
    origin: typeof location === "undefined" ? "http://localhost" : location.origin,
    parseSearch,
    stringifySearch,
    // Hovering a link loads its issue and screen; Query owns freshness, so the router never caches a preload.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Back and Forward land where each entry was scrolled; a new navigation opens the issue at its top.
    scrollRestoration: typeof document !== "undefined",
    scrollToTopSelectors: ['[data-scroll-restoration-id="issue-body"]', '[data-scroll-restoration-id="document-body"]'],
    // Linear wraps its route fallbacks in the boot fallback positioner, so a route still loading at boot keeps the shell.
    defaultPendingComponent: () => (
      <AppLoading>
        <LoadingState />
      </AppLoading>
    ),
  });
}
export type AppRouter = ReturnType<typeof createAppRouter>;
declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}

/** Where a place lives: the route, its params and search, and (for an issue page) the list under it. */
export function locationOf(place: Place, context: Pick<RouteContext, "view">) {
  const issue = "issue" in place && place.issue ? { issue: place.issue } : {};
  const segment = (id: string) => {
    const view = context.view(id);
    return view ? segmentOf(view) : id;
  };
  switch (place.to) {
    case "board":
      return { to: "/board/$board/$scope", params: { board: String(place.board), scope: place.scope }, search: issue } as const;
    case "view":
      return {
        to: "/view/$view",
        params: { view: segment(place.id) },
        search: { ...issue, ...(place.filter ? { filter: place.filter } : {}) },
      } as const;
    case "editor":
      return place.id
        ? ({ to: "/view/$view/edit", params: { view: segment(place.id) }, search: issue } as const)
        : ({ to: "/view/new", search: issue } as const);
    case "person": {
      const tab = place.tab === "assigned" ? undefined : place.tab;
      return place.person
        ? ({ to: "/profiles/$user/{-$tab}", params: { user: place.person, tab }, search: issue } as const)
        : ({ to: "/my-issues/{-$tab}", params: { tab }, search: issue } as const);
    }
    case "inbox":
      return { to: "/inbox", search: issue } as const;
    case "issue": {
      const state = { ...(place.over ? { over: place.over } : {}), ...(place.trail ? { trail: place.trail } : {}) };
      return place.document
        ? ({ to: "/issue/$key/document/$id", params: { key: place.key, id: place.document }, state } as const)
        : ({ to: "/issue/$key/{-$slug}", params: { key: place.key, slug: undefined }, state } as const);
    }
  }
}

/**
 * The place an old address named (`/?board=1&issue=KEY-1&view=page`, `/user/<id>`, `/views?board=1`, `/team/1/views`, `?mine=1`,
 * `?inbox=1`), or undefined for a current address. Read the way `restore` read them before the router.
 */
export function legacyPlace(
  pathname: string,
  q: Record<string, string>,
  context: Pick<RouteContext, "issue" | "currentKey" | "view" | "scope" | "lastBoard" | "hasBoard">,
): Place | undefined {
  // The views page is gone (`/views`, `/team/<board>/views`): its address opens the board.
  const views = /^\/(?:team\/(\d+)\/)?views$/.exec(pathname);
  const old = pathname === "/" || !!views || /^\/user\/[^/]+(\/[a-z]+)?$/.test(pathname) ||
    ["board", "view", "mine", "inbox", "document"].some((key) => key in q);
  if (!old) return undefined;
  const key = q.issue ? context.currentKey(q.issue) : undefined,
    issue = key ? context.issue(key) : undefined,
    page = q.view === "page" || !!q.document,
    named = Number(q.board ?? views?.[1]),
    board = boardFor(issue, context.hasBoard(named) ? named : context.lastBoard());
  const editor = /^\/view\/(?:new|([^/]+)\/edit)$/.exec(pathname),
    view = /^\/view\/([^/]+)$/.exec(pathname)?.[1],
    person = /^\/(?:my-issues|user\/([^/]+))(?:\/([a-z]+))?$/.exec(pathname);
  const id = (segment: string) => context.view(segment)?.id ?? segment;
  let list: ListPlace;
  if (editor) list = { to: "editor", ...(editor[1] ? { id: id(editor[1]) } : {}) };
  else if (view) list = { to: "view", id: id(view), ...(q.filter ? { filter: q.filter } : {}) };
  else if ("inbox" in q) list = { to: "inbox" };
  else if (person || "mine" in q)
    list = { to: "person", person: person?.[1] ? decodeURIComponent(person[1]) : null, tab: isPersonTab(person?.[2]) ? person[2] : "assigned" };
  else list = { to: "board", board, scope: context.scope(board) };
  if (!key) return list;
  if (page) return { to: "issue", key, ...(q.document ? { document: q.document } : {}), over: list };
  return { ...list, issue: key };
}

/** Whether the router shows Not found: an address that names nothing (the root's `_notFound`), or a board, view or issue
 *  it names that isn't there (a route that threw `notFound`). */
export const routeNotFound = (matches: readonly { status: string; error: unknown; _notFound?: boolean }[]) =>
  matches.some((m) => m.status === "notFound" || m["_notFound"] === true || isNotFound(m.error));

/** Linear's `fk` button look on a router link. */
const RouteButton = createLink(ButtonLink);
/** An address that names nothing, or an issue Jira doesn't have or hides from this account (the mirror asked it first,
 *  `whenKept`). Covers the boards the shell keeps mounted. */
function NotFound({ data }: NotFoundRouteProps) {
  const issue = (data as { issue?: string } | undefined)?.issue;
  return (
    <EmptyState
      title={issue ? `Issue ${issue} not found` : "Page not found"}
      actions={<RouteButton to="/" variant="secondary" size="medium">Go to your board</RouteButton>}
      className="absolute inset-0 z-10 bg-panel"
    >
      <p>{issue ? missingIssueNote("missing") : "This address doesn't name a board, view or issue."}</p>
    </EmptyState>
  );
}
function RouteError({ error, reset }: ErrorComponentProps) {
  return (
    <EmptyState role="alert" title="Something went wrong" actions={<Button variant="secondary" size="medium" onClick={reset}>Try again</Button>} className="absolute inset-0 z-10 bg-panel">
      <p>{error instanceof Error ? error.message : String(error)}</p>
    </EmptyState>
  );
}

/** Public URL for a typed route, including the router's base path. */
export function routeURL(router: AppRouter, target: Omit<ReturnType<typeof locationOf>, "search"> & { search?: Record<string, unknown> }, origin: string, hash?: string) {
  return new URL(router.buildLocation({ ...target, hash } as never).href, origin).href;
}
