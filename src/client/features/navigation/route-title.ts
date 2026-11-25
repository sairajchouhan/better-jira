/**
 * The browser tab's title for each place, as Linear names it. Linear resolves a title per route after every
 * navigation and sets `self.document.title` to it (startup-root `kwi`, resolvers in `RouteInfoResolvers` `Ge`), outside
 * its desktop tabs (`W(t)` false, so the long form below). It re-resolves when a model the route loaded changes (`Dwi`
 * watches an issue's URL, which carries its title's slug), and keeps the Inbox count live (`DocumentTitleUpdater`).
 * Pure: the store, the router and the inbox feed hand it what it reads (route-title-updater.tsx).
 */
import type { Board, Issue } from "@/shared/issue-model";
import { PERSON_TABS, type PersonTab } from "@/shared/people";
import type { SavedView, ViewDraft } from "@/shared/saved-view-model";
import type { Scope } from "@/shared/view-model";
import type { ListPlace, Place } from "./navigation";

/** Linear's breadcrumb separator in titles (`${team.name} › ${page}`). */
const SEP = " › ";
/** A team's issues page title (startup-root `L1`). */
const SCOPE_TITLE: Record<Scope, string> = { active: "Active issues", backlog: "Backlog", all: "All issues" };
/** The same pages as an issue's origin (startup-root `Xpi`, read by `titlePrefix`). */
const SCOPE_ORIGIN: Record<Scope, string> = { active: "Active", backlog: "Backlog", all: "All issues" };
/** My issues tab names (startup-entry `Hbe`, the same words as our tabs). */
const tabLabel = (tab: PersonTab) => PERSON_TABS.find(([t]) => t === tab)![1];
/** A document without a title (startup-entry `defaultDocumentTitle`). */
const UNTITLED_DOCUMENT = "New document";
/** Linear's route error titles (RouteInfoResolvers `Qe`): a 404 is Not found, anything else Error. */
export const NOT_FOUND_TITLE = "Not found";
export const ERROR_TITLE = "Error";

/** What a title reads from the mirror. */
export type TitleData = {
  boards: readonly Pick<Board, "id" | "name">[];
  savedViews: readonly Pick<SavedView, "id" | "name" | "kind" | "board">[];
  issues: ReadonlyMap<string, Pick<Issue, "key" | "summary" | "resources">>;
  /** The view being drafted on `/view/new` (a board tab or a workspace view). */
  editorDraft: Pick<ViewDraft, "kind" | "board"> | null;
  /** A profile's person, by name. */
  personName: (id: string) => string;
  /** Jira has the issue: a new one made here has no key to show yet (Linear's `persistedOnBackend`). */
  persisted: (key: string) => boolean;
  /** Unread inbox rows, for "Inbox (3)". */
  unread: number;
};

/** "Inbox (3)", "Inbox (99+)", or "Inbox" with nothing unread (DocumentTitleUpdater `m`/`h`, RouteInfoResolvers `Ye`). */
export function inboxTitle(unread: number) {
  return `Inbox${unread > 0 ? ` (${unread > 99 ? "99+" : unread})` : ""}`;
}

/** The tab title for a place; Not found when it names nothing the mirror has. */
export function titleOf(place: Place, d: TitleData): string {
  if (place.to !== "issue") return listTitle(place, d) ?? NOT_FOUND_TITLE;
  const issue = d.issues.get(place.key);
  if (!issue) return NOT_FOUND_TITLE;
  // `/:orgKey/document/:documentId`: the document's own title, with no origin.
  if (place.document) {
    const doc = issue.resources?.find((r) => r.id === place.document && r.kind === "document");
    return doc ? doc.title || UNTITLED_DOCUMENT : NOT_FOUND_TITLE;
  }
  // `/:orgKey/issue/:issueId`: "KEY Title", led by the list it was opened from (`Ke` with `titlePrefix`).
  const title = `${d.persisted(issue.key) ? `${issue.key} ` : ""}${issue.summary}`;
  const origin = place.over && originOf(place.over, d);
  return origin && origin !== title ? `${origin}${SEP}${title}` : title;
}

function listTitle(place: ListPlace, d: TitleData): string | undefined {
  const boardName = (id: number) => d.boards.find((b) => b.id === id)?.name;
  switch (place.to) {
    // `/:orgKey/team/:teamKey/all|active|backlog`: `${team.name} › All issues`.
    case "board": {
      const name = boardName(place.board);
      return name === undefined ? undefined : `${name}${SEP}${SCOPE_TITLE[place.scope]}`;
    }
    // A board tab is a team view (`/:orgKey/team/:teamKey/view/:id`, `${team.name} › ${view.name}`); a custom view is a
    // workspace view (`/:orgKey/view/:id`, its name).
    case "view": {
      const view = d.savedViews.find((v) => v.id === place.id);
      if (!view) return undefined;
      return view.kind === "tab" ? `${boardName(view.board) ?? ""}${SEP}${view.name}` : view.name;
    }
    // `/view/:id/edit`: team `${team.name} › Edit ${name}`, workspace `${name} > Edit` (Linear's own ">").
    // `/view/new`: team `${team.name} › New view`, workspace `New view`.
    case "editor": {
      const view = place.id ? d.savedViews.find((v) => v.id === place.id) : undefined;
      if (place.id && !view) return undefined;
      const tab = view ? view.kind === "tab" : d.editorDraft?.kind === "tab";
      const board = view?.board ?? d.editorDraft?.board;
      const page = view ? (tab ? `Edit ${view.name}` : `${view.name} > Edit`) : "New view";
      return tab && board !== undefined ? `${boardName(board) ?? ""}${SEP}${page}` : page;
    }
    // `/:orgKey/my-issues/:viewType` and `/:orgKey/profiles/:userId/:viewType`.
    case "person":
      return `${place.person ? d.personName(place.person) : "My issues"}${SEP}${tabLabel(place.tab)}`;
    case "inbox":
      return inboxTitle(d.unread);
  }
}

/** The label an issue's title is led by when opened from a list (startup-root `Jpi.rootLink`): a board's tab, a view,
 *  a My issues tab, or Inbox. A profile or the view editor sets no origin. */
function originOf(over: ListPlace, d: TitleData): string | undefined {
  switch (over.to) {
    case "board":
      return SCOPE_ORIGIN[over.scope];
    case "view":
      return d.savedViews.find((v) => v.id === over.id)?.name;
    case "person":
      return over.person ? undefined : tabLabel(over.tab);
    case "inbox":
      return "Inbox";
    case "editor":
      return undefined;
  }
}

/** Linear's screen-reader line after a navigation (startup-root `rbi.announceNavigation`): none for the first page, one
 *  per history entry, and a trailing no-break space when the words repeat so the live region reads them again. */
export function announcement(previous: { key?: string; message: string }, key: string, title: string) {
  if (previous.key === key) return previous;
  if (previous.key === undefined) return { key, message: previous.message };
  const message = `Navigated to ${title}`;
  return { key, message: previous.message === message ? `${message} ` : message };
}
