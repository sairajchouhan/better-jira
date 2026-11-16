import { EntityIdentifier } from "@/client/components/entity-identifier";
import type { ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { CardBody, CardProperties, CardProperty, HoverCard } from "@/client/components/hover-card";
import { Icon, PriorityIcon, StatusIcon } from "@/client/components/icons";
import { IssueKeyLink } from "@/client/features/navigation/app-link";
import { get, statusOf } from "@/client/state/store";
import type { Issue } from "@/shared/issue-model";
import type { Relation } from "@/shared/relations";
import { epicName, epicOf } from "@/shared/epics";

/** Linear Hft/Wft/Kft: interactive issue card, 550ms. One card for relation pills, Activity's relation rows, issue mention chips
 *  and issue favorites; it opens above by default, as on an issue mention chip; relation pills pass `left`, the sidebar `right`.
 *  The body uses mirror data already in memory; external links use Jira's linked-issue projection. */
export function IssueHoverCard({
  relation,
  issue,
  placement = "top",
  display,
  children,
}: {
  relation: Relation;
  issue?: Issue;
  placement?: "top" | "top-start" | "left" | "right";
  display?: "inline-flex" | "inline";
  children: ReactNode;
}) {
  return (
    <HoverCard
      placement={placement}
      display={display}
      label={relation.key}
      content={<IssueCard relation={relation} issue={issue} />}
    >
      {children}
    </HoverCard>
  );
}

/**
 * Linear's issue card body (`Kft` in `TA`): the key (mini, labelMuted) with the assignee's 16px avatar and name across from it,
 * the title (smallPlus, two lines at most), then under the property line (`Vk`) the status, the project (our epic) and the
 * priority, 16px apart.
 */
export function IssueCard({ relation, issue }: { relation: Relation; issue?: Issue }) {
  const status = issue ? statusOf(issue) : relation.issue?.status;
  // The project is the issue's epic (shared/epics.ts), read from the mirror as the card opens.
  const lookup = (key: string) => get().issues.get(key),
    epic = issue && epicOf(issue, lookup);
  return (
    <CardBody data-issue-hover={relation.key}>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5 text-xs">
          <EntityIdentifier className="text-fg-3">{relation.key}</EntityIdentifier>
          {issue?.assignee ? (
            <span className="flex shrink-0 items-center gap-1.5 text-fg-2">
              <Avatar user={issue.assignee} size={16} />
              {issue.assignee.name}
            </span>
          ) : null}
        </div>
        {/* Held or not, the title opens the issue here (BJ-354). */}
        <IssueKeyLink issueKey={relation.key} className="line-clamp-2 text-[13px] leading-[1.4] font-medium text-fg-2 hover:underline">
          {issue?.summary ?? relation.issue?.summary ?? relation.key}
        </IssueKeyLink>
      </div>
      <CardProperties>
        {status ? (
          <CardProperty icon={<StatusIcon status={status} />} title="Status">
            {status.name}
          </CardProperty>
        ) : null}
        {epic ? (
          <CardProperty icon={<Icon name="layers" size={16} />} title="Epic">
            {epicName(epic, lookup)}
          </CardProperty>
        ) : null}
        {issue?.priority ? (
          <CardProperty icon={<PriorityIcon name={issue.priority} />} title="Priority">
            {issue.priority}
          </CardProperty>
        ) : null}
      </CardProperties>
    </CardBody>
  );
}
