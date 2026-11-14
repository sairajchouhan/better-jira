/**
 * How an issue page was reached, and the breadcrumb and counter that follow from it: Linear's breadcrumb store (the class `de` in
 * useReportLoadingDone, one stack of items per tab) and its issue form (startup-root `bpi` → `Hpi`). Pure: navigation.ts keeps the
 * trail on the screen and in the history entry; the breadcrumb (breadcrumbs.tsx), the counter and ↑/↓ read `issueCrumbs`.
 */
import type { Board, Issue } from "@/shared/issue-model";
import { epicName, epicOf, isEpic, listedUnder, type IssueLookup } from "@/shared/epics";
import { directSubIssues } from "@/client/features/issue/sub-issue-model";

/**
 * The way an issue page was reached, kept in its history entry like Linear's `itemsLookup_`:
 * - `"list"`: over a list (a board, a view, My issues, the inbox): `Space › Issues|View › KEY`, and the list's counter.
 * - `{ path }`: from Sub-issues sections, outermost first (`addModel` pushing each issue): `Epic › Task › KEY`, and the counter
 *   through the last one's sub-issues.
 * - none (null): a direct link, a reload, ⌘K, a toast or a link in content (Linear's `resetBreadcrumb`, `resetItems`): `Epic › KEY`
 *   and no counter.
 */
export type Trail = "list" | { readonly path: readonly string[] };
/** What a step does to the trail: open from `parent`'s Sub-issues section, set it outright, or (null) start afresh. */
export type TrailStep = Trail | { readonly parent: string } | null;

/** The issue a screen shows as a page, if any. */
type PageScreen = { selected: string | null; panel: boolean; view: string; document: string | null; trail: Trail | null };
export const pageIssue = (s: Omit<PageScreen, "trail">) =>
  s.panel && s.selected && (s.view === "page" || !!s.document) ? s.selected : null;

/**
 * The trail of the next screen. Off an issue page there is none. A step that names one wins: from a Sub-issues section it extends
 * the trail of the page it was opened on (`addModel` appends; `handleIssueAddedToBreadcrumb` keeps the parent), else it starts at
 * that parent. Unnamed: the same page keeps its trail (a document, a hash), a page opened from a list is over that list, and a page
 * opened from another page starts afresh, as Linear's model links reset the stack (`eM`'s `resetBreadcrumb = true`).
 */
export function nextTrail(prev: PageScreen, next: Omit<PageScreen, "trail">, step?: TrailStep): Trail | null {
  const page = pageIssue(next);
  if (!page) return null;
  const was = pageIssue(prev);
  if (step === undefined) return was === page ? prev.trail : was ? null : "list";
  if (step === null || step === "list" || "path" in step) return step;
  const kept = was === step.parent && prev.trail && prev.trail !== "list" ? prev.trail.path : [];
  return { path: [...kept, step.parent] };
}

/**
 * An ancestor's crumb, a parent issue's or the epic's (Linear's `Upi`: its identifier, its title as the tooltip): the key and title,
 * the issue when the mirror holds it (then the crumb opens it; a parent's always is), and the trail its page opens with. The epic
 * shows its key too, not its name as Linear's project does (the user's choice, .raj/done.md), and opens afresh.
 */
export type AncestorCrumb = { key: string; title: string; issue?: Issue; trail: Trail | null };
export type IssueCrumbs =
  /** Over the list it opened from: the list's own crumbs, and its counter. */
  | { form: "list" }
  /** Linear's `Hpi`: the epic, the parents it was opened through, then the issue. `siblings` are what the counter and ↑/↓ step
   *  through: the last parent's sub-issues, or none when the page was reached directly. `compactEpic` shows the epic as its icon
   *  alone, as `Hpi` does once the stack holds more than two issues (`iconOnly: r.length > 2`). */
  | { form: "hierarchy"; epic?: AncestorCrumb; parents: readonly AncestorCrumb[]; siblings?: readonly Issue[]; compactEpic: boolean };

const epicCrumb = (key: string | undefined, lookup: IssueLookup): AncestorCrumb | undefined =>
  key ? { key, title: epicName(key, lookup), issue: lookup(key), trail: null } : undefined;

/** Whether `path` still leads to `key` through Sub-issues sections: each issue listed under the one before it (`listedUnder`). */
function leadsTo(path: readonly string[], key: string, lookup: IssueLookup): boolean {
  const chain = [...path, key];
  if (new Set(chain).size !== chain.length || !path.every((k) => lookup(k))) return false;
  return chain.slice(1).every((k, i) => {
    const issue = lookup(k);
    return !!issue && listedUnder(issue, lookup) === chain[i];
  });
}

/** Linear's `Dpi` for the parents: all of them up to two, else the first and the last. */
const shownParents = (parents: AncestorCrumb[]) => (parents.length <= 2 ? parents : [parents[0]!, parents.at(-1)!]);

/**
 * The open issue page's breadcrumb from its trail. Over a list: the list's crumbs. From Sub-issues sections: the epic of the first
 * issue in the trail (`Hpi`: `u` is the first issue in the stack, `f` its project), or that issue itself when it is the epic, then
 * the other issues as parent crumbs, and the counter through the last one's sub-issues. A trail that no longer leads here (a
 * parent changed), or none (a link, a reload, ⌘K), falls back to the issue's own epic and no counter, as Linear's empty stack does.
 */
export function issueCrumbs(
  issue: Issue,
  trail: Trail | null,
  issues: ReadonlyMap<string, Issue>,
  boards: readonly Board[],
): IssueCrumbs {
  if (trail === "list") return { form: "list" };
  const lookup: IssueLookup = (key) => issues.get(key);
  if (trail && trail.path.length && leadsTo(trail.path, issue.key, lookup)) {
    const [first, ...rest] = trail.path as [string, ...string[]];
    const top = isEpic(lookup(first)!);
    const keys = top ? rest : trail.path;
    // A parent's crumb opens its page with the trail that led to it, as Linear's crumb links restore their own entry's stack.
    const parents = keys.map((key): AncestorCrumb => {
      const before = trail.path.slice(0, trail.path.indexOf(key)), parent = lookup(key)!;
      return { key, title: parent.summary, issue: parent, trail: before.length ? { path: before } : null };
    });
    return {
      form: "hierarchy",
      epic: epicCrumb(top ? first : epicOf(lookup(first)!, lookup), lookup),
      parents: shownParents(parents),
      siblings: directSubIssues(issues, boards, trail.path.at(-1)!),
      compactEpic: keys.length + 1 > 2,
    };
  }
  const own = epicOf(issue, lookup);
  return { form: "hierarchy", epic: epicCrumb(own === issue.key ? undefined : own, lookup), parents: [], compactEpic: false };
}

/**
 * What the open issue's counter counts and ↑/↓ step through (Linear's `jf`: the siblings of the list state it was opened from).
 * Beside a list (`crumbs` null: the side panel) or over one, that list; from a Sub-issues section, that parent's sub-issues; reached
 * directly, nothing, so no counter shows.
 */
export const stepIssues = (crumbs: IssueCrumbs | null, list: readonly Issue[]): readonly Issue[] =>
  !crumbs || crumbs.form === "list" ? list : (crumbs.siblings ?? []);
