/**
 * The header breadcrumb, on React Aria's Breadcrumbs (an `ol` of `li`, the last one current): a board or view's
 * `Space › Issues|View`, and an issue page's crumbs from how it was reached (issue-trail.ts `issueCrumbs`): over a list, the
 * list's crumbs then the issue; otherwise Linear's issue form (startup-root `Hpi`), `Epic › Parent… › KEY Title`.
 */
import { useMemo, type ReactNode } from "react";
import { Breadcrumb, Breadcrumbs, Link } from "react-aria-components";
import { type Board, type Issue } from "@/shared/issue-model";
import { peopleOf } from "@/shared/people";
import { Icon, TypeDot } from "@/client/components/icons";
import { IconButton } from "@/client/components/button";
import { ContextMenu } from "@/client/components/action-menu";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { boardOf, set, useStore } from "@/client/state/store";
import { issueURL } from "@/client/features/issue/issue-urls";
import { copyEntries, issueBreadcrumbEntries } from "@/client/features/issue/issue-menu";
import { useActiveView, useSavedViews } from "@/client/features/views/saved-views";
import { ViewContextMenu } from "@/client/features/views/view-editor";
import { SavedViewIcon } from "@/client/features/views/views-navigation";
import type { SavedView } from "@/shared/saved-view-model";
import { AppLink } from "./app-link";
import { linkHref, ui } from "./app-navigation";
import type { Destination } from "./navigation";
import { hotkeyOf, runShortcut } from "./shortcuts";
import { boardCopyURL } from "./sidebar-menus";
import { issueCrumbs, pageIssue, type EpicCrumb, type IssueCrumbs, type ParentCrumb } from "./issue-trail";

// Linear's breadcrumb (linear.app/…/view/…, 2026-11-11 computed styles): 24px links padded 0 5px 0 4px with matching
// negative margins, 16px icon + 6px, 13px/500 text at line-height normal, "›" with 8px sides lifted 2px; hover bg
// --crumb-hover and primary text, only colour animates (0.15s).
const CRUMB_LAST =
  "-ml-1 flex h-6 min-w-0 items-center rounded-lg pr-[5px] pl-1 transition-[color] duration-150 ease-[ease] hover:bg-(--crumb-hover) hover:text-fg focus-visible:outline-2 focus-visible:outline-accent";
const CRUMB = `-mr-[5px] ${CRUMB_LAST}`; // the current (last) crumb keeps its right padding, like Linear's current item
const CRUMB_ICON = "mr-1.5 grid w-4 shrink-0 place-items-center";
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

/** The bar: the sidebar toggle, then the crumbs, each a Breadcrumb (React Aria marks the last one current). */
function CrumbBar({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center text-[13px] leading-[normal] font-medium text-fg-2">
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
/** A crumb's link into the app: React Aria's Link (current-page state from its Breadcrumb) drawn as the app's own link, so a click
 *  goes there as the app's steps do and ⌘-click opens a tab. A current crumb that still links passes `isDisabled={false}`. */
function CrumbLink({ to, title, children, ...props }: { to: Destination; children: ReactNode; className: string; isDisabled?: boolean; title?: string; "aria-label"?: string; onPress?: () => void }) {
  return (
    <Link
      {...props}
      href={linkHref(to)}
      // React Aria's Link passes no `title`; the anchor takes it, so the app's tooltip shows (Linear's crumb tooltips).
      render={(dom) => {
        if (!("href" in dom)) return <span {...dom} title={title} />;
        const { href: _href, ...anchor } = dom;
        return <AppLink to={to} {...anchor} title={title} />;
      }}
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

/** Linear's team crumb (`Api` → `vBn`): its initial and name; right-click for Copy URL. */
function SpaceCrumb({ board }: { board: Board }) {
  return (
    <Crumb id="space">
      <ContextMenu label="Space options" entries={() => [boardCopyURL(board, hotkeyOf("copy-url"))]}>
        <CrumbLink to={allIssues(board)} aria-label={board.name} title={board.name} onPress={clearBoardTools} className={CRUMB}>
          <span aria-hidden="true" className={CRUMB_ICON}>
            <span className="grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{board.name[0]}</span>
          </span>
          <span className="truncate">{board.name}</span>
        </CrumbLink>
      </ContextMenu>
    </Crumb>
  );
}
/** The list crumb: Issues, My issues or a person's name. Current, it still links (it clears the board's search). Under an issue it
 *  gives way below 640px. */
function IssuesCrumb({ board, label }: { board: Board; label: string }) {
  return (
    <Crumb id="issues" className="shrink-0 max-sm:[&:not([data-current])]:hidden">
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
/** Linear's project crumb in `Hpi` (icon `DD`, name `X7`, the icon alone once the trail is long): our epic, opening its page afresh;
 *  right-click for its copy rows. Text alone when the epic isn't in the mirror. */
function EpicCrumbItem({ epic, compact }: { epic: EpicCrumb; compact: boolean }) {
  const icon = <span aria-hidden="true" className={compact ? "grid w-4 place-items-center" : CRUMB_ICON}><Icon name="layers" /></span>;
  const content = (
    <>
      {icon}
      {!compact && <span className="truncate">{epic.name}</span>}
    </>
  );
  return (
    <Crumb id="epic" className={compact ? "shrink-0" : ""}>
      {epic.issue ? (
        <ContextMenu label="Issue options" entries={() => copyEntries(epic.issue!)}>
          <CrumbLink to={{ board: epic.issue.board, selected: epic.key, panel: true, view: "page", trail: null }} aria-label={epic.name} title={epic.name} className={CRUMB}>
            {content}
          </CrumbLink>
        </ContextMenu>
      ) : (
        <span aria-label={epic.name} title={epic.name} className="flex h-6 min-w-0 items-center">{content}</span>
      )}
    </Crumb>
  );
}
/** Linear's issue crumb in the trail (`n9` → `Upi`): the identifier alone, the title as its tooltip; it opens that issue's page with
 *  the trail that led to it. Right-click for its copy rows. Below 640px only the last parent shows, as Linear's `Dpi` on a tablet. */
function ParentCrumbItem({ parent, last }: { parent: ParentCrumb; last: boolean }) {
  const { issue } = parent;
  return (
    <Crumb id={`parent-${issue.key}`} className={`shrink-0 ${last ? "" : "max-sm:hidden"}`}>
      <ContextMenu label="Issue options" entries={() => copyEntries(issue)}>
        <CrumbLink to={{ board: issue.board, selected: issue.key, panel: true, view: "page", trail: parent.trail }} title={issue.summary} className={CRUMB}>
          <EntityIdentifier>{issue.key}</EntityIdentifier>
        </CrumbLink>
      </ContextMenu>
    </Crumb>
  );
}
/** The open issue: its type, key and title, linking to Jira. The key never truncates (Opus review 4: at 390px it vanished): the
 *  title does. Linear's current issue crumb (`Api`): right-click for its copy rows and Rename…. */
function IssueCrumb({ issue }: { issue: Issue }) {
  return (
    <Crumb id="issue">
      <ContextMenu label="Issue options" entries={() => issueBreadcrumbEntries(issue)}>
        <Link isDisabled={false} className={CRUMB_LAST} href={issueURL(issue)} target="_blank" rel="noreferrer">
          <span className={CRUMB_ICON}><TypeDot type={issue.type} /></span>
          <span data-crumb-issue className="flex min-w-0">
            <EntityIdentifier className="mr-[5.6px] shrink-0">{issue.key}</EntityIdentifier>
            <span className="truncate">{issue.summary}</span>
          </span>
        </Link>
      </ContextMenu>
    </Crumb>
  );
}

/** What the list crumbs show for a board, My issues, a person or a view: the space (not on My issues itself), the list's name, and
 *  the custom view open (or being edited) in its place. */
function useListCrumbs() {
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
  return {
    space: !mine || !!activeView,
    label: !activeView && mine ? personal : "Issues",
    view: current?.kind === "custom" ? current : null,
  };
}

/** A board, My issues, a person's issues or a view: `Space › Issues|View`. */
export function BoardBreadcrumbs({ board }: { board: Board }) {
  const list = useListCrumbs();
  return (
    <CrumbBar>
      {list.space && <SpaceCrumb board={board} />}
      {list.view ? <ViewCrumb view={list.view} /> : <IssuesCrumb board={board} label={list.label} />}
    </CrumbBar>
  );
}

/** The open issue page's crumbs, from the trail it was reached by; null when the issue isn't open as a page (the side panel). */
export function useIssueCrumbs(issue: Issue | undefined): IssueCrumbs | null {
  const page = useStore((s) => (issue && pageIssue(s) === issue.key ? s.trail : undefined));
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  return useMemo(
    () => (issue && page !== undefined ? issueCrumbs(issue, page, issues, boards) : null),
    [issue, page, issues, boards],
  );
}

/** An issue page's breadcrumb: over a list, `Space › Issues|View › KEY Title`; else `Epic › Parent… › KEY Title`. */
export function IssueBreadcrumbs({ issue }: { issue: Issue }) {
  const crumbs = useIssueCrumbs(issue) ?? { form: "list" };
  return crumbs.form === "list" ? <ListIssueBreadcrumbs issue={issue} /> : (
    <CrumbBar>
      {crumbs.epic && <EpicCrumbItem epic={crumbs.epic} compact={crumbs.compactEpic} />}
      {crumbs.parents.map((parent, i) => <ParentCrumbItem key={parent.issue.key} parent={parent} last={i === crumbs.parents.length - 1} />)}
      <IssueCrumb issue={issue} />
    </CrumbBar>
  );
}
/** An issue page over a list: the list's crumbs, always Issues (a view's name shows only on the view itself), then the issue. */
function ListIssueBreadcrumbs({ issue }: { issue: Issue }) {
  const list = useListCrumbs(),
    board = boardOf(issue.key)!;
  return (
    <CrumbBar>
      {list.space && <SpaceCrumb board={board} />}
      <IssuesCrumb board={board} label={list.label} />
      <IssueCrumb issue={issue} />
    </CrumbBar>
  );
}
