/**
 * Linear's favorite hover cards (startup-root `d5n` → `X8n`, `Z8n`; a team's `m5n` → `vpt`): resting on a sidebar favorite opens a
 * preview of what it opens, to the right of the sidebar and centred on the row, after the card delay (550ms, `Rwe`), through the
 * one hover card every card uses. An issue opens Linear's issue card, an epic (Linear's project) the project card, a view the view
 * card, a space (Linear's team) the team card and a document the document card (`cpt`).
 */
import { Fragment, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { CardBody, CardProperties, CardProperty, HoverCard } from "@/client/components/hover-card";
import { DueIcon, Icon, PriorityIcon, ProgressRing, StatusIcon, TypeDot } from "@/client/components/icons";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { SpaceIcon } from "@/client/components/space-icon";
import { useSortableDragging } from "@/client/components/sortable";
import { useAnyDrag } from "@/client/components/drag-state";
import { ordinalDate, shortDate } from "@/client/lib/due-date";
import { statusOf, useStore } from "@/client/state/store";
import { subIssueCount, type SubIssueCount } from "@/client/features/issue/sub-issue-model";
import { IssueCard } from "@/client/features/issue/issue-hover-card";
import { DocumentGlyph, documentEditor } from "@/client/features/issue/document-glyph";
import { SavedViewIcon } from "@/client/features/views/saved-view-icon";
import type { SavedView } from "@/client/features/views/saved-views";
import { ViewFilterChips } from "@/client/features/views/view-controls";
import { boardFor, onBoard } from "@/shared/board-membership";
import { statusById } from "@/shared/board-catalog";
import { isEpic } from "@/shared/epics";
import { compareText } from "@/shared/compare";
import type { Board, Issue } from "@/shared/issue-model";
import type { IssueResource } from "@/shared/issue-resource";
import { AppLink, IssueKeyLink } from "./app-link";

/** What a sidebar favorite stands for, as its row resolved it: a document is the issue it belongs to and its resource. */
export type FavoriteThing = { view?: SavedView; issue?: Issue; board?: Board; document?: { issue: Issue; resource: IssueResource } };
export type FavoriteCardKind = "issue" | "project" | "view" | "team" | "document";

/**
 * Which card a favorite opens (`Z8n`, and `m5n` for a team): an issue its issue card, an epic (our Linear project) the project
 * card, a view the view card, a space (our Linear team) the team card, a document the document card (`cpt`).
 */
export function favoriteCardKind({ view, issue, board, document }: FavoriteThing): FavoriteCardKind | null {
  if (issue) return isEpic(issue) ? "project" : "issue";
  if (view) return "view";
  if (board) return "team";
  if (document) return "document";
  return null;
}

/**
 * What a favorite's card sits beside. Every kind but a team wraps its whole row in the card's trigger (`d5n` → `h$`), so its card
 * starts past the row's right edge; a team favorite is a folder whose card is on its toggle button (`m5n`: `$` around the icon
 * and name, `teamToggleButton` growing up to the ×), so its card starts where the label ends, short of the × and the row's padding.
 */
export const favoriteCardAnchor = (kind: FavoriteCardKind) => (kind === "team" ? "label" : "row");

/**
 * A favorite row's icon (Linear's favorite mapping, `z1` and the team mapping in startup-root): a view's own icon (`rk`), a space's
 * icon (14px, `ik`) and a document's own icon (`ej`). An issue, an epic included, shows its Jira issue type, the TypeDot its rows
 * and crumbs show, centred in a 16px box like the view and document icons. Linear shows an issue's status (`WA`) and a project's
 * icon (`DD`); the user's choice: every issue is an issue with a type.
 */
export function FavoriteIcon({ view, issue, board, document }: FavoriteThing) {
  if (view) return <SavedViewIcon view={view} />;
  if (document) return <DocumentGlyph resource={document.resource} />;
  if (board) return <SpaceIcon name={board.name} size={14} />;
  if (!issue) return null;
  return (
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center" data-favorite-icon="type">
      <TypeDot type={issue.type} />
    </span>
  );
}

type FavoriteCardTriggerProps = { thing: FavoriteThing; label: string; children: ReactNode };

/** The one trigger every favorite's card goes through: the shared hover card to the right of its anchor, with no card while
 *  anything is dragged (`d5n`: `!isDragged && zN() == null`), whether a favorite or an issue on its way across the sidebar.
 *  It wraps `at` only when that is the kind's anchor (`favoriteCardAnchor`); otherwise, and for a favorite with no card, it is
 *  its children alone. */
function FavoriteCardTrigger({ at, thing, label, children }: FavoriteCardTriggerProps & { at: "row" | "label" }) {
  const sorting = useSortableDragging(),
    dragging = useAnyDrag();
  const kind = favoriteCardKind(thing);
  if (!kind || favoriteCardAnchor(kind) !== at) return children;
  return (
    <HoverCard
      placement="right"
      display={at === "row" ? "block" : "fill"}
      label={label}
      isDisabled={sorting || dragging}
      content={<FavoriteCard kind={kind} thing={thing} />}
    >
      {children}
    </HoverCard>
  );
}

/** A favorite row's card, placed on its anchor: `Row` around the row's link, `Label` around its icon and name inside it. Each
 *  favorite renders both and exactly one of them opens its card. */
export const FavoriteHoverCard = {
  Row: (props: FavoriteCardTriggerProps) => <FavoriteCardTrigger at="row" {...props} />,
  Label: (props: FavoriteCardTriggerProps) => <FavoriteCardTrigger at="label" {...props} />,
};

export function FavoriteCard({ kind, thing }: { kind: FavoriteCardKind; thing: FavoriteThing }) {
  if (kind === "issue") return <IssueCard relation={{ key: thing.issue!.key, kind: "related" }} issue={thing.issue} />;
  if (kind === "project") return <ProjectCard epic={thing.issue!} />;
  if (kind === "view") return <ViewCard view={thing.view!} />;
  if (kind === "document") return <DocumentCard document={thing.document!} />;
  return <TeamCard board={thing.board!} />;
}

/** Linear's project progress (`Nk` and `progressText`): the share of the project's issues that are done, whole percent, out of how
 *  many. An epic counts every issue under it at every level, as its Sub-issues section does. */
export function epicProgress(count: SubIssueCount | undefined) {
  const total = count?.total ?? 0,
    done = count?.done ?? 0;
  return { value: total ? done / total : 0, percent: `${total ? Math.round((100 * done) / total) : 0}%`, total };
}

/**
 * Linear's project card (`kA` in `TA`) for an epic: its key (mini, labelMuted), its icon and name (smallPlus, two lines at most),
 * its description (mini, labelMuted, two lines), then under the property line, 16px apart, `kA`'s order: status, team (its space),
 * lead (its assignee), priority, target date (its due date in Linear's "Aug 1st, '25", the calendar red once overdue and plain once
 * the epic is done, `sA` with `dueDate: completedAt ? undefined : targetDate`) and progress. Jira holds no milestones inside an epic
 * (`activeMilestone`), feature flags or estimates, so those don't show.
 */
function ProjectCard({ epic }: { epic: Issue }) {
  const status = statusOf(epic),
    space = useStore((s) => s.boards.find((b) => b.id === boardFor(epic, s.board))),
    count = useStore((s) => subIssueCount(s.issues, s.boards, epic.key, "descendants")),
    progress = epicProgress(count);
  return (
    <CardBody data-project-hover={epic.key}>
      <EntityIdentifier className="text-xs text-fg-3">{epic.key}</EntityIdentifier>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center text-fg-2">
          <Icon name="layers" size={16} />
        </span>
        <IssueKeyLink issueKey={epic.key} className="line-clamp-2 text-[13px] font-medium text-fg-2 hover:underline">
          {epic.summary}
        </IssueKeyLink>
      </div>
      {epic.description?.trim() ? <p className="line-clamp-2 text-xs text-fg-3">{epic.description.trim()}</p> : null}
      <CardProperties>
        {status ? (
          <CardProperty icon={<StatusIcon status={status} />} title="Status">
            {status.name}
          </CardProperty>
        ) : null}
        {space ? (
          <CardProperty icon={<SpaceIcon name={space.name} />} title="Space">
            {space.name}
          </CardProperty>
        ) : null}
        {epic.assignee ? (
          <CardProperty icon={<Avatar user={epic.assignee} size={16} />} title="Lead">
            {epic.assignee.name}
          </CardProperty>
        ) : null}
        {epic.priority ? (
          <CardProperty icon={<PriorityIcon name={epic.priority} />} title="Priority">
            {epic.priority}
          </CardProperty>
        ) : null}
        {epic.due ? (
          <CardProperty icon={<DueIcon due={epic.resolved ? null : epic.due} />} title="Target date">
            {ordinalDate(epic.due)}
          </CardProperty>
        ) : null}
        <span className="flex items-center text-xs" data-epic-progress={progress.percent}>
          <span className="mr-2 flex">
            <ProgressRing value={progress.value} />
          </span>
          <span className="text-fg-2">{progress.percent}</span>
          <span className="mr-0.5 ml-1 text-fg-3">of</span>
          <span className="text-fg-2">{progress.total}</span>
        </span>
      </CardProperties>
    </CardBody>
  );
}

/**
 * Linear's view card (`$8n`): the view's header (`dAn`, 6px padded and at most 320px: its icon and name 8px apart in smallPlus,
 * then its description in small labelMuted, two lines at most, 12px below), then 4px under it the view's own filters as
 * read-only chips (`Y8n`), none when it filters nothing.
 */
function ViewCard({ view }: { view: SavedView }) {
  const board = useStore((s) => s.boards.find((b) => b.id === view.board));
  return (
    <div className="flex min-w-0 flex-col gap-1" data-view-hover={view.id}>
      <div className="flex max-w-[320px] flex-col items-start gap-3 p-1.5">
        <span className="flex items-center gap-2 text-[13px] font-medium text-fg-2">
          <SavedViewIcon view={view} />
          {view.name}
        </span>
        {view.description.trim() ? <p className="line-clamp-2 text-[13px] text-fg-3">{view.description.trim()}</p> : null}
      </div>
      {board ? (
        <div className="mt-1 flex">
          <ViewFilterChips filters={view.filters} board={board} />
        </div>
      ) : null}
    </div>
  );
}

/** Linear's `sct`: how many characters of names a team card's row spells out before "+N" (`fct`). */
export const CARD_NAMES_BUDGET = 42;

/**
 * Linear's `fct`: how many of `names` a card row spells out, comma separated, before "+N". It adds each name's length and two for
 * every ", " and stops at the first name that would take the row past `budget` characters, but always shows the first.
 */
export function fittingNames(names: readonly string[], budget = CARD_NAMES_BUDGET) {
  let length = 0,
    count = 0;
  for (const [index, name] of names.entries()) {
    const next = length + (index > 0 ? 2 : 0) + name.length;
    if (next > budget && count > 0) break;
    length = next;
    count++;
  }
  return count;
}

/**
 * Linear's team card (`vpt`, 296px) for a space: its icon (18px) and name (small, labelTitle), a line, then the Projects row (the
 * space's open epics, as Linear lists a team's active projects, by name). Jira gives a space no members, description or documents,
 * so the face pile, the description and the Documents row don't show.
 */
function TeamCard({ board }: { board: Board }) {
  const epics = useStore((s) => s.issues);
  const open = [...epics.values()]
    .filter((issue) => isEpic(issue) && onBoard(issue, board.id) && statusById(board, issue.status)?.category !== "done")
    .sort((a, b) => compareText(a.summary, b.summary));
  const shown = open.slice(0, fittingNames(open.map((epic) => epic.summary))),
    rest = open.slice(shown.length);
  return (
    <div className="flex w-[296px] flex-col gap-2.5" data-team-hover={board.id}>
      <div className="flex min-w-0 items-center gap-1.5 pt-1 pr-1.5 pl-1">
        <SpaceIcon name={board.name} size={18} />
        <AppLink to={{ board: board.id, selected: null, panel: false }} className="max-w-[220px] truncate text-[13px] text-fg hover:underline">
          {board.name}
        </AppLink>
      </div>
      <div className="mx-1 h-px bg-(--card-divider)" />
      <div className="flex flex-col gap-2.5 px-1.5 pb-2">
        <div className="flex min-w-0 items-start gap-2" data-team-projects="">
          <span className="flex shrink-0 text-fg-3">
            <Icon name="layers" size={16} />
          </span>
          {open.length ? (
            // `cct`: the names in one line (miniPlus, labelBase, no wrap, truncated), comma separated, then "+N" in labelMuted.
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-medium">
              <span className="min-w-0 truncate whitespace-nowrap text-fg" data-team-epics={shown.length}>
                {shown.map((epic, index) => (
                  <Fragment key={epic.key}>
                    {index > 0 ? ", " : null}
                    <IssueKeyLink issueKey={epic.key} className="hover:underline">
                      {epic.summary}
                    </IssueKeyLink>
                  </Fragment>
                ))}
              </span>
              {rest.length ? (
                // Linear's "+N" opens a list of the rest (`lct`); a card can't open over this card here, so its title lists them.
                <span className="shrink-0 whitespace-nowrap text-fg-3" title={rest.map((epic) => epic.summary).join("\n")} data-tip-over-card="" data-tip-plain="">
                  +{rest.length}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="mt-0.5 text-xs font-medium text-fg-3">No epics</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Linear's document card (`cpt` in `TA`): the document's own icon (16px) and its title (smallPlus, labelTitle, linked), then under
 * the property line a column 8px apart (`lpt`): the issue it belongs to (its icon and title, mini labelBase, linked), and "Last
 * edited {date} by {editor}" (miniPlus labelBase, after labelFaint's calendar glyph) with the date as Linear's `ei` writes it.
 * Linear's generated summary has no Jira counterpart, so it doesn't show; nor does "by …" when no editor is known.
 */
function DocumentCard({ document: { issue, resource } }: { document: { issue: Issue; resource: IssueResource } }) {
  const board = useStore((s) => boardFor(issue, s.board)),
    editor = documentEditor(resource),
    status = statusOf(issue);
  return (
    <CardBody data-document-hover={resource.id}>
      <div className="flex min-w-0 items-center gap-1.5">
        <DocumentGlyph resource={resource} />
        <AppLink
          to={{ board, selected: issue.key, panel: true, document: resource.id }}
          className="truncate text-[13px] font-medium text-fg hover:underline"
        >
          {resource.title || "New document"}
        </AppLink>
      </div>
      <CardProperties>
        <div className="flex min-w-0 flex-col gap-2">
          <IssueKeyLink issueKey={issue.key} className="flex min-w-0 items-center gap-1.5 text-xs text-fg hover:underline" data-document-parent="">
            {/* Its issue's project icon for an epic, else its status; the favorite rows' type icon stops at the rows. */}
            {isEpic(issue) ? (
              <span className="flex shrink-0 text-fg-2">
                <Icon name="layers" size={16} />
              </span>
            ) : (
              status && <StatusIcon status={status} />
            )}
            <span className="truncate">{issue.summary}</span>
          </IssueKeyLink>
          {resource.updated ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-fg" data-document-edited="">
              <span className="flex shrink-0 text-fg-4">
                <Icon name="calendar" size={16} />
              </span>
              <span className="truncate">
                Last edited {shortDate(resource.updated)}
                {editor ? ` by ${editor.name}` : null}
              </span>
            </span>
          ) : null}
        </div>
      </CardProperties>
    </CardBody>
  );
}
