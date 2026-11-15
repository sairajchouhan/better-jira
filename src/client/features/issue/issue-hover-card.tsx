import { EntityIdentifier } from "@/client/components/entity-identifier";
import type { ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { HoverCard } from "@/client/components/hover-card";
import { PriorityIcon, StatusIcon } from "@/client/components/icons";
import { IssueKeyLink } from "@/client/features/navigation/app-link";
import { get, statusOf } from "@/client/state/store";
import type { Issue } from "@/shared/issue-model";
import type { Relation } from "@/shared/relations";
import { epicName, epicOf } from "@/shared/epics";

/** Linear Hft/Wft/Kft: interactive issue card, 550ms. One card for relation pills, Activity's relation rows and issue
 *  mention chips; it opens above by default, as on an issue mention chip; relation pills pass `left`. The body uses mirror data
 *  already in memory; external links use Jira's linked-issue projection. */
export function IssueHoverCard({
  relation,
  issue,
  placement = "top",
  display,
  children,
}: {
  relation: Relation;
  issue?: Issue;
  placement?: "top" | "top-start" | "left";
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

function IssueCard({ relation, issue }: { relation: Relation; issue?: Issue }) {
  const status = issue ? statusOf(issue) : relation.issue?.status;
  // The project is the issue's epic (shared/epics.ts), read from the mirror as the card opens.
  const lookup = (key: string) => get().issues.get(key),
    epic = issue && epicOf(issue, lookup);
  return (
          <div data-issue-hover={relation.key}>
            <div className="mb-1.5 flex items-center justify-between gap-4 text-fg-3">
              <EntityIdentifier>{relation.key}</EntityIdentifier>
              {issue?.assignee ? (
                <span className="flex items-center gap-1.5">
                  <Avatar user={issue.assignee} size={16} />
                  {issue.assignee.name}
                </span>
              ) : null}
            </div>
            {/* Held or not, the title opens the issue here (BJ-354). */}
            <IssueKeyLink issueKey={relation.key} className="line-clamp-2 font-medium hover:underline">
              {issue?.summary ?? relation.issue?.summary ?? relation.key}
            </IssueKeyLink>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {status ? (
                <span className="flex items-center gap-1.5">
                  <StatusIcon status={status} />
                  {status.name}
                </span>
              ) : null}
              {epic ? <span>{epicName(epic, lookup)}</span> : null}
              {issue?.priority ? (
                <span className="flex items-center gap-1.5">
                  <PriorityIcon name={issue.priority} />
                  {issue.priority}
                </span>
              ) : null}
            </div>
          </div>
  );
}
