/**
 * The header breadcrumb, on React Aria's Breadcrumbs (an `ol` of `li`, the last one current), in the one header row every page
 * shares (`PageHeader`), so it sits at the same inset everywhere. A board reads `Space`, a view `Space › View`, an issue page
 * `Space › KEY Title` over a list, or Linear's issue form (startup-root `Hpi`) under the space, `Space › EPIC-KEY › Parent… › KEY
 * Title`, and a document `Space › KEY › Title`. No Issues crumb: it led to the same board as the space (the user's choice over
 * Linear, .raj/done.md 2026-11-14).
 */
import { useMemo, type ComponentProps, type ReactNode, type Ref } from "react";
import { Breadcrumb, Breadcrumbs, Link } from "react-aria-components";
import { type Board, type Issue } from "@/shared/issue-model";
import { peopleOf } from "@/shared/people";
import { Icon, StatusIcon, TypeDot } from "@/client/components/icons";
import { IconButton } from "@/client/components/button";
import { ContextMenu } from "@/client/components/action-menu";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { set, useStore, issueBoardId, issueBoard } from "@/client/state/store";
import { statusById } from "@/shared/board-catalog";
import { issueURL } from "@/client/features/issue/issue-urls";
import { copyEntries, issueBreadcrumbEntries } from "@/client/features/issue/issue-menu";
import { useActiveView, useSavedViews } from "@/client/features/views/saved-views";
import { ViewContextMenu } from "@/client/features/views/view-editor";
import { SavedViewIcon } from "@/client/features/views/views-navigation";
import type { SavedView } from "@/shared/saved-view-model";
import { linkHref, preloadOnHover, ui } from "./app-navigation";
import type { Destination } from "./navigation";
import { hotkeyOf, runShortcut } from "./shortcuts";
import { boardCopyURL } from "./sidebar-menus";
import { issueCrumbs, pageIssue, spaceOf, type AncestorCrumb as AncestorCrumbModel, type IssueCrumbs } from "./issue-trail";
import { initialOf } from "@/shared/person-name";

// Linear's breadcrumb (linear.app/…/view/…, 2026-11-11 computed styles): 24px links padded 0 5px 0 4px with matching
// negative margins, 16px icon + 6px, 13px/500 text at line-height normal, "›" with 8px sides lifted 2px; hover bg
// --crumb-hover and primary text, only colour animates (0.15s).
const CRUMB_LAST =
  "-ml-1 flex h-6 min-w-0 items-center rounded-lg pr-[5px] pl-1 transition-[color] duration-150 ease-[ease] hover:bg-(--crumb-hover) hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
const CRUMB = `-mr-[5px] ${CRUMB_LAST}`; // the current (last) crumb keeps its right padding, like Linear's current item
const CRUMB_ICON = "mr-1.5 grid w-4 shrink-0 place-items-center";
/** An issue crumb's icon: the issue's own type, the TypeDot its rows show (the user's choice: every issue crumb, the epic and parents
 *  too, wears its type, .raj/done.md). Icon-only crumbs drop the gap before the text. */
function CrumbTypeIcon({ type, className = CRUMB_ICON }: { type?: string; className?: string }) {
  return <span aria-hidden="true" className={className}><TypeDot type={type} /></span>;
}
function CrumbSep() {
  return <span aria-hidden="true" className="mx-2 -mt-0.5 shrink-0 text-fg-3">›</span>;
}

const wide = () => matchMedia("(min-width: 768px)").matches;
/**
 * Linear's header sidebar toggle (`r5`, startup-root): "Menu" opens the sidebar over the page below 768px. On a wider
 * window it shows only while the sidebar is collapsed: a click expands it (tooltip "Expand navigation sidebar" with [,
 * Linear's `kM`) and the pointer on it peeks the sidebar over the page (`onMouseEnter: u.open()`).
 */
export function SidebarToggle() {
  const hidden = useStore((s) => s.sidebarHidden);
  return (
    <IconButton
      label="Menu"
      tooltip={hidden ? "Expand navigation sidebar" : undefined}
      shortcut={hidden ? hotkeyOf("sidebar") : undefined}
      variant="muted"
      size="small"
      onClick={() => runShortcut("sidebar")}
      onMouseEnter={hidden ? () => wide() && set({ sidebarPeek: true }) : undefined}
      className={`mr-1 ${hidden ? "" : "md:hidden"}`}
    >
      <Icon name="side" />
    </IconButton>
  );
}

// Linear's header row (linear.md: 44px, 0.5px frame border, 8px sides); the crumbs sit 10px further in. Both live here, once, so
// the board, a view, an issue page and a document put the breadcrumb at the same spot (the user's report: the issue page's sat 6px
// left of the board's).
export const PAGE_HEADER = "flex h-11 shrink-0 items-center border-b-[0.5px] border-frame px-2";
export const CRUMB_BAR = "flex min-w-0 items-center pl-2.5 text-[13px] leading-[normal] font-medium text-fg-2";
/** The header row of every page that leads with the breadcrumb (board, view, issue, document) and of the issue side panel. */
export function PageHeader({ className = "", ref, children }: { className?: string; ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  return (
    <div ref={ref} data-page-header className={`${PAGE_HEADER} ${className}`}>
      {children}
    </div>
  );
}

/** The bar: the sidebar toggle, then the crumbs, each a Breadcrumb (React Aria marks the last one current). */
function CrumbBar({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className={CRUMB_BAR}>
      <SidebarToggle />
      <Breadcrumbs className="flex min-w-0 items-center">{children}</Breadcrumbs>
    </nav>
  );
}
/** One crumb, followed by the separator unless it is the current one. React Aria renders only what is inside its Breadcrumb. */
function Crumb({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <Breadcrumb id={id} className={`flex min-w-0 items-center ${className}`}>
      {({ isCurrent }) => (
        <>
          {children}
          {!isCurrent && <CrumbSep />}
        </>
      )}
    </Breadcrumb>
  );
}
/** A crumb's link into the app: React Aria's Link (current-page state from its Breadcrumb), routed by AppRouterProvider, so a
 *  click goes there as the app's steps do and ⌘-click opens a tab. Resting on it loads where it goes, as the router's own links
 *  do (`defaultPreload: "intent"`), and Space follows it as AppLink does. A current crumb that still links passes
 *  `isDisabled={false}`. */
function CrumbLink({ to, title, children, ...props }: { to: Destination; children: ReactNode; className: string; isDisabled?: boolean; title?: string; "aria-label"?: string; onPress?: () => void }) {
  return (
    <Link
      {...props}
      href={linkHref(to)}
      routerOptions={to}
      onHoverStart={() => preloadOnHover(to)}
      onHoverEnd={() => preloadOnHover(null)}
      onKeyDown={(event) => {
        if (event.key === " " && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
          event.preventDefault();
          (event.target as HTMLElement).click();
        } else event.continuePropagation();
      }}
      // React Aria's Link passes no `title`; the anchor takes it, so the app's tooltip shows (Linear's crumb tooltips).
      render={title ? (dom) => <a {...(dom as ComponentProps<"a">)} title={title} /> : undefined}
    >
      {children}
    </Link>
  );
}

const clearBoardTools = () => {
  ui.send({ type: "query.set", query: "" });
  set({ details: false, findInView: false });
};
const allIssues = (board: Board) => ({ board: board.id, scope: "all", selected: null, panel: false }) as const;

/** Linear's team crumb (`Api` → `vBn`): its initial and name, opening the board's issues; right-click for Copy URL. It leads
 *  every breadcrumb but My issues', and on the board it is the current page that still links (it clears the board's search). */
function SpaceCrumb({ board }: { board: Board }) {
  return (
    <Crumb id="space">
      <ContextMenu label="Space options" entries={() => [boardCopyURL(board, hotkeyOf("copy-url"))]}>
        <CrumbLink to={allIssues(board)} aria-label={board.name} title={board.name} isDisabled={false} onPress={clearBoardTools} className={CRUMB}>
          <span aria-hidden="true" className={CRUMB_ICON}>
            <span className="grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{initialOf(board.name)}</span>
          </span>
          <span className="truncate">{board.name}</span>
        </CrumbLink>
      </ContextMenu>
    </Crumb>
  );
}
/** My issues' crumb, or a person's name on their page: the list itself, with no space before it. Current, it still links (it
 *  clears the search). Under an issue it gives way below 640px. */
function PersonalCrumb({ board, label }: { board: Board; label: string }) {
  return (
    <Crumb id="personal" className="shrink-0 max-sm:[&:not([data-current])]:hidden">
      <CrumbLink to={allIssues(board)} aria-label={label} isDisabled={false} onPress={clearBoardTools} className={CRUMB}>
        {label}
      </CrumbLink>
    </Crumb>
  );
}
/** Linear: the current custom view is plain text (right-click for its menu), not a link. */
function ViewCrumb({ view }: { view: SavedView }) {
  return (
    <Crumb id="view">
      <ViewContextMenu view={view}>
        <span aria-current="page" className="flex h-6 min-w-0 items-center">
          <span className={CRUMB_ICON}><SavedViewIcon view={view} /></span>
          <h2 className="truncate font-medium">{view.name}</h2>
        </span>
      </ViewContextMenu>
    </Crumb>
  );
}
/**
 * An ancestor's crumb in the trail, Linear's issue crumb (`n9` → `Upi`): the key, the title as its tooltip; it opens that issue's
 * page with the trail that led to it, and right-click gives its copy rows. One the mirror doesn't hold (an epic in another
 * project) opens here too, kept first (`navigate`, BJ-354); it has no copy rows until then. The variants below say what it draws.
 */
function AncestorCrumb({ id, crumb, className = "", label, children }: { id: string; crumb: AncestorCrumbModel; className?: string; label?: string; children: ReactNode }) {
  const { issue } = crumb;
  const board = useStore((s) => issueBoardId(issue, s));
  const link = (
    <CrumbLink to={{ board, selected: crumb.key, panel: true, view: "page", trail: crumb.trail }} aria-label={label} title={crumb.title} className={CRUMB}>
      {children}
    </CrumbLink>
  );
  return (
    <Crumb id={id} className={`shrink-0 ${className}`}>
      {issue ? <ContextMenu label="Issue options" entries={() => copyEntries(issue)}>{link}</ContextMenu> : link}
    </Crumb>
  );
}
/** A parent issue: its type icon and identifier, like every issue crumb. Below 640px only the last parent shows, as Linear's `Dpi`
 *  on a tablet. */
function ParentCrumbItem({ parent, last }: { parent: AncestorCrumbModel; last: boolean }) {
  return (
    <AncestorCrumb id={`parent-${parent.key}`} crumb={parent} className={last ? "" : "max-sm:hidden"}>
      {parent.issue && <CrumbTypeIcon type={parent.issue.type} />}
      <EntityIdentifier>{parent.key}</EntityIdentifier>
    </AncestorCrumb>
  );
}
/** The epic, in Linear's project slot: its type icon and key like a parent's, not Linear's project icon and name (the user's
 *  choices over Linear, .raj/done.md). An epic the mirror doesn't hold is its key alone. */
function EpicCrumbItem({ epic }: { epic: AncestorCrumbModel }) {
  return (
    <AncestorCrumb id="epic" crumb={epic}>
      {epic.issue && <CrumbTypeIcon type={epic.issue.type} />}
      <EntityIdentifier>{epic.key}</EntityIdentifier>
    </AncestorCrumb>
  );
}
/** The epic once the trail is long: its type icon alone (`Hpi`'s `iconOnly: r.length > 2`), named by its key. Not held, it has no
 *  type to show, so its key stands in. */
function EpicIconCrumbItem({ epic }: { epic: AncestorCrumbModel }) {
  return (
    <AncestorCrumb id="epic" crumb={epic} label={epic.key}>
      {epic.issue ? <CrumbTypeIcon type={epic.issue.type} className="grid w-4 place-items-center" /> : <EntityIdentifier>{epic.key}</EntityIdentifier>}
    </AncestorCrumb>
  );
}
/** The open issue: its type, key and title, linking to Jira. The key never truncates (Opus review 4: at 390px it vanished): the
 *  title does. Linear's current issue crumb (`Api`): right-click for its copy rows and Rename…. */
function IssueCrumb({ issue }: { issue: Issue }) {
  return (
    <Crumb id="issue">
      <ContextMenu label="Issue options" entries={() => issueBreadcrumbEntries(issue)}>
        <Link isDisabled={false} className={CRUMB_LAST} href={issueURL(issue)} target="_blank" rel="noreferrer">
          <CrumbTypeIcon type={issue.type} />
          <span data-crumb-issue className="flex min-w-0">
            <EntityIdentifier className="mr-[5.6px] shrink-0">{issue.key}</EntityIdentifier>
            <span className="truncate">{issue.summary}</span>
          </span>
        </Link>
      </ContextMenu>
    </Crumb>
  );
}

/** A document's issue: its status and key, back to the issue's page; the title is its tooltip. */
function DocumentIssueCrumb({ issue }: { issue: Issue }) {
  const board = useStore((s) => issueBoard(issue, s));
  const status = statusById(board, issue.status) ?? { name: issue.status, category: "new" as const };
  return (
    <Crumb id="document-issue" className="shrink-0">
      <CrumbLink to={{ document: null }} aria-label="Back to issue" title={issue.summary} className={CRUMB}>
        <span aria-hidden="true" className={CRUMB_ICON}><StatusIcon status={status} /></span>
        <EntityIdentifier>{issue.key}</EntityIdentifier>
      </CrumbLink>
    </Crumb>
  );
}
/** The open document: the file icon and its title, plain text like a view's crumb. */
function DocumentCrumb({ title }: { title: string }) {
  return (
    <Crumb id="document">
      <span aria-current="page" className="flex h-6 min-w-0 items-center">
        <span aria-hidden="true" className={CRUMB_ICON}><Icon name="file" size={14} /></span>
        <span className="truncate text-fg">{title}</span>
      </span>
    </Crumb>
  );
}

/** What the list crumbs are for a board, My issues, a person or a view. */
type ListCrumb =
  /** A board: the space alone. */
  | { kind: "board" }
  /** A custom view open (or being edited): the space, then the view. */
  | { kind: "view"; view: SavedView }
  /** My issues or a person's issues: that list's name, no space. */
  | { kind: "personal"; label: string };
function useListCrumb(): ListCrumb {
  const mine = useStore((s) => s.mine);
  const person = useStore((s) => s.person);
  const issues = useStore((s) => s.issues);
  // Open user's page names its person, as Linear's profile does; mine is My issues.
  const personal = useMemo(
    () => (person ? (peopleOf(issues.values()).find((u) => u.id === person)?.name ?? person) : "My issues"),
    [person, issues],
  );
  const activeView = useActiveView();
  const draft = useStore((s) => s.editorDraft);
  const saved = useSavedViews().find((v) => v.id === draft?.id);
  const current = draft && saved ? { ...saved, ...draft, id: saved.id } : activeView;
  if (current?.kind === "custom") return { kind: "view", view: current };
  return mine && !activeView ? { kind: "personal", label: personal } : { kind: "board" };
}

/** A board, My issues, a person's issues or a view: `Space`, `Space › View`, or `My issues`. */
export function BoardBreadcrumbs({ board }: { board: Board }) {
  const list = useListCrumb();
  return (
    <CrumbBar>
      {list.kind === "personal" ? <PersonalCrumb board={board} label={list.label} /> : <SpaceCrumb board={board} />}
      {list.kind === "view" && <ViewCrumb view={list.view} />}
    </CrumbBar>
  );
}

/** The open issue page's crumbs, from the trail it was reached by; null when the issue isn't open as a page (the side panel). */
export function useIssueCrumbs(issue: Issue | undefined): IssueCrumbs | null {
  const page = useStore((s) => (issue && pageIssue(s) === issue.key ? s.trail : undefined));
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const current = useStore((s) => s.board);
  return useMemo(
    () => (issue && page !== undefined ? issueCrumbs(issue, page, issues, boards, current) : null),
    [issue, page, issues, boards, current],
  );
}

/** An issue page's breadcrumb, under its space: over a list, `Space › KEY Title` (My issues: `My issues › KEY Title`); else
 *  `Space › EPIC-KEY › Parent… › KEY Title`. */
export function IssueBreadcrumbs({ issue }: { issue: Issue }) {
  const crumbs = useIssueCrumbs(issue);
  const fallback = useStore((s) => (crumbs ? undefined : spaceOf(issue, s.boards, s.board)));
  const space = crumbs ? crumbs.space : fallback;
  return (
    <CrumbBar>
      {!crumbs || crumbs.form === "list" ? <ListLeadCrumb space={space} /> : space && <SpaceCrumb board={space} />}
      {crumbs?.form === "hierarchy" && crumbs.epic && (crumbs.compactEpic ? <EpicIconCrumbItem epic={crumbs.epic} /> : <EpicCrumbItem epic={crumbs.epic} />)}
      {crumbs?.form === "hierarchy" && crumbs.parents.map((parent, i) => <ParentCrumbItem key={parent.key} parent={parent} last={i === crumbs.parents.length - 1} />)}
      <IssueCrumb issue={issue} />
    </CrumbBar>
  );
}
/** Over a list, what leads the issue: the space, or My issues' crumb (a view's name shows only on the view itself). */
function ListLeadCrumb({ space }: { space: Board | undefined }) {
  const list = useListCrumb();
  if (!space) return null;
  return list.kind === "personal" ? <PersonalCrumb board={space} label={list.label} /> : <SpaceCrumb board={space} />;
}

/** A document's breadcrumb: `Space › KEY › Title`, the key back to its issue. */
export function DocumentBreadcrumbs({ issue, title }: { issue: Issue; title: string }) {
  const space = useStore((s) => spaceOf(issue, s.boards, s.board));
  return (
    <CrumbBar>
      {space && <SpaceCrumb board={space} />}
      <DocumentIssueCrumb issue={issue} />
      <DocumentCrumb title={title} />
    </CrumbBar>
  );
}
