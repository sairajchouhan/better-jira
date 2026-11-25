/** An issue's pull requests in its sidebar, as Linear's issue view lists them (IssueDetailsPaneSidebar.DzwJjN1z.js: the sidebar `q_`
 *  opens with the "Diffs" section `Cg`, its list `yg` and rows `pg`). Linear keeps them out of the resources under the description
 *  (that list filters `isPullRequest` out), so this is the issue view's only pull request list. */
import { ContextMenu } from "@/client/components/action-menu";
import { HoverCard } from "@/client/components/hover-card";
import { TOOLTIP_TIMING } from "@/client/components/tooltip-rules";
import { Icon, PullRequestStatusIcon, ReviewStatusIcon } from "@/client/components/icons";
import { PropertyTrigger } from "@/client/components/property-trigger";
import { Text } from "@/client/components/text";
import { useCollapsedState } from "@/client/lib/collapsed-state";
import type { Issue } from "@/shared/issue-model";
import { issuePullRequestOrder, pullRequestSections, reviewDecision, type PullRequest } from "@/shared/pull-requests";
import { PullRequestCard, pullRequestActions, usePullRequests } from "./card-badges";
import { IssueDetailsSection, ShowMoreToggle } from "./issue-details-section";

/** Linear's "Diffs" section (`Cg`): nothing until the issue has a pull request. The list is the one the issue's badge, card and menu
 *  read (Jira's development panel and GitHub), read when the issue opens if Jira counts any. */
export function IssueDiffs({ issue }: { issue: Issue }) {
  const { data } = usePullRequests(issue, !!issue.prCount);
  if (!data?.length) return null;
  return (
    <IssueDetailsSection name="Diffs">
      <PullRequestList key={issue.key} prs={issuePullRequestOrder(data)} collapseKey={`issue-diffs-${issue.key}`} />
    </IssueDetailsSection>
  );
}

const Rows = ({ prs }: { prs: PullRequest[] }) => (
  <div className="flex w-full flex-col gap-1">
    {prs.map((pr) => (
      <IssuePullRequestRow key={pr.url} pr={pr} />
    ))}
  </div>
);

/** Rows a toggle shows, 4px under the ones above (Linear's `sx-1iorvi4`). */
const FoldedRows = ({ prs }: { prs: PullRequest[] }) => (
  <div className="pt-1">
    <Rows prs={prs} />
  </div>
);

/** Linear's sidebar list (`yg`): three rows, the rest under "Show N more"; closed ones apart under "N closed" from two
 *  (`pullRequestSections`). Both toggles start folded and are remembered for the session by `collapseKey` (`Jl`). */
export function PullRequestList({ prs, collapseKey }: { prs: PullRequest[]; collapseKey: string }) {
  const { shown, more, closed, closedFold } = pullRequestSections(prs);
  const [moreFolded, toggleMore] = useCollapsedState(collapseKey, true);
  const [closedFolded, toggleClosed] = useCollapsedState(`${collapseKey}-closed`, true);
  if (!shown.length) return null;
  return (
    <div className="w-full" data-pull-requests>
      <Rows prs={shown} />
      {more.length > 0 && (
        <>
          {!moreFolded && <FoldedRows prs={more} />}
          <ShowMoreToggle expanded={!moreFolded} onToggle={toggleMore}>
            {moreFolded ? `Show ${more.length} more` : "Show less"}
          </ShowMoreToggle>
        </>
      )}
      {closed.length > 0 && (
        <>
          {(!closedFold || !closedFolded) && <FoldedRows prs={closed} />}
          {closedFold && (
            <ShowMoreToggle expanded={!closedFolded} onToggle={toggleClosed}>
              {closedFolded ? `${closed.length} closed` : "Hide closed"}
            </ShowMoreToggle>
          )}
        </>
      )}
    </div>
  );
}

/** Linear's sidebar pull request row (`pg`): a DetailButton link with the status icon, the title, the review's mark while it is open
 *  (approved, changes requested; `mg`) and a chevron that shows on hover. It opens the pull request in a new tab (`navigationProps` for
 *  a review outside Linear); right-click is Linear's pull request menu (`Bl` = `lhn`); a 150ms rest shows its card on the left. */
/** IssueDetailsPaneSidebar's row tooltip: `transitionDelay: 150` beside `position: "left"`, `interactive: true`. */
export const PULL_REQUEST_ROW_CARD_DELAY = 150;
const PULL_REQUEST_ROW_CARD_TIMING = { ...TOOLTIP_TIMING.card, delay: PULL_REQUEST_ROW_CARD_DELAY };

export function IssuePullRequestRow({ pr }: { pr: PullRequest }) {
  const review = reviewDecision(pr);
  return (
    <div className="issue-pull-request-row" data-pull-request-row={pr.number || pr.url}>
      <ContextMenu label="Pull request options" entries={() => pullRequestActions(pr)}>
        <HoverCard label="Pull request" placement="left" timing={PULL_REQUEST_ROW_CARD_TIMING} content={<PullRequestCard pr={pr} />}>
          <PropertyTrigger.Link
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            aria-label={review ? `${pr.title}, ${review.label}` : pr.title}
          >
            <PullRequestStatusIcon status={pr.status} size={16} />
            <Text variant="smallPlus" color="base" wrap="truncate" className="issue-pull-request-title">
              {pr.title}
            </Text>
            {review && (
              <span className="issue-pull-request-review" aria-hidden>
                <ReviewStatusIcon status={review.status} size="small" />
              </span>
            )}
            {/* Linear's trailing chevron (`data-detail-button-trailing-icon`): shown while the row is hovered or focused. */}
            <span className="issue-pull-request-go" aria-hidden>
              <Icon name="chevron-right" size={14} />
            </span>
          </PropertyTrigger.Link>
        </HoverCard>
      </ContextMenu>
    </div>
  );
}
