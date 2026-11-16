/**
 * Linear's favorite hover cards (startup-root `d5n` → `X8n`, `Z8n`; a team's `m5n` → `vpt`): resting on a sidebar favorite opens a
 * preview of what it opens, to the right of the sidebar and centred on the row, after the card delay (550ms, `Rwe`), through the
 * one hover card every card uses. An issue opens Linear's issue card, an epic (Linear's project) the project card, a view the view
 * card and a space (Linear's team) the team card.
 */
import type { ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { CardBody, CardProperties, CardProperty, HoverCard } from "@/client/components/hover-card";
import { DueIcon, Icon, PriorityIcon, ProgressRing, StatusIcon } from "@/client/components/icons";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { SpaceIcon } from "@/client/components/space-icon";
import { useSortableDragging } from "@/client/components/sortable";
import { shortDate } from "@/client/lib/due-date";
import { statusOf, useStore } from "@/client/state/store";
import { subIssueCount, type SubIssueCount } from "@/client/features/issue/sub-issue-model";
import { IssueCard } from "@/client/features/issue/issue-hover-card";
import { SavedViewIcon } from "@/client/features/views/saved-view-icon";
import type { SavedView } from "@/client/features/views/saved-views";
import { ViewFilterChips } from "@/client/features/views/view-controls";
import { boardFor, onBoard } from "@/shared/board-membership";
import { statusById } from "@/shared/board-catalog";
import { isEpic } from "@/shared/epics";
import { compareText } from "@/shared/compare";
import type { Board, Issue } from "@/shared/issue-model";
import { AppLink, IssueKeyLink } from "./app-link";

/** What a sidebar favorite stands for, as its row resolved it. */
export type FavoriteThing = { view?: SavedView; issue?: Issue; board?: Board; document?: unknown };
export type FavoriteCardKind = "issue" | "project" | "view" | "team";

/**
 * Which card a favorite opens (`Z8n`, and `m5n` for a team): an issue its issue card, an epic (our Linear project) the project
 * card, a view the view card, a space (our Linear team) the team card. A document opens none here: Linear's document card (`cpt`)
 * is not built.
 */
export function favoriteCardKind({ view, issue, board }: FavoriteThing): FavoriteCardKind | null {
  if (issue) return isEpic(issue) ? "project" : "issue";
  if (view) return "view";
  if (board) return "team";
  return null;
}

/** The one wrapper every favorite row's card goes through: the shared hover card to the right of the row, as wide as the row, with
 *  no card while any favorite is dragged (`d5n`: `!isDragged && zN() == null`). A favorite with no card is its row alone. */
export function FavoriteHoverCard({ thing, label, children }: { thing: FavoriteThing; label: string; children: ReactNode }) {
  const dragging = useSortableDragging();
  const kind = favoriteCardKind(thing);
  if (!kind) return children;
  return (
    <HoverCard placement="right" display="block" label={label} isDisabled={dragging} content={<FavoriteCard kind={kind} thing={thing} />}>
      {children}
    </HoverCard>
  );
}

export function FavoriteCard({ kind, thing }: { kind: FavoriteCardKind; thing: FavoriteThing }) {
  if (kind === "issue") return <IssueCard relation={{ key: thing.issue!.key, kind: "related" }} issue={thing.issue} />;
  if (kind === "project") return <ProjectCard epic={thing.issue!} />;
  if (kind === "view") return <ViewCard view={thing.view!} />;
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
 * lead (its assignee), priority, target date (its due date, red once overdue) and progress. Jira holds no milestones inside an epic
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
          <CardProperty icon={<DueIcon due={epic.due} resolved={epic.resolved} />} title="Target date">
            {shortDate(epic.due)}
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

/** How many of a space's projects the team card names before "+N" (Linear's `cct` fits as many as its row holds). */
const TEAM_CARD_PROJECTS = 3;

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
  const shown = open.length > TEAM_CARD_PROJECTS ? open.slice(0, TEAM_CARD_PROJECTS - 1) : open;
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
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-fg">
              {shown.map((epic) => (
                <IssueKeyLink key={epic.key} issueKey={epic.key} className="max-w-[200px] truncate hover:underline">
                  {epic.summary}
                </IssueKeyLink>
              ))}
              {open.length > shown.length ? <span className="text-fg-3">+{open.length - shown.length}</span> : null}
            </span>
          ) : (
            <span className="mt-0.5 text-xs font-medium text-fg-3">No epics</span>
          )}
        </div>
      </div>
    </div>
  );
}
