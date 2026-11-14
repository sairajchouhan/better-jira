import { type Issue } from "@/shared/issue-model";
import { useState, type HTMLAttributes } from "react";
import { Avatar } from "@/client/components/avatar";
import { DueIcon, Icon, LabelDot, PriorityIcon, StatusIcon } from "@/client/components/icons";
import { useStore } from "@/client/state/store";
import { Adf } from "@/client/features/editor/adf";
import { childrenByParent } from "./sub-issue-model";
import { statusOf } from "./sub-issues";
import { Text } from "@/client/components/text";
import { statusDuration } from "@/shared/view-model";

/** Linear's Quick look (→ in a menu): the highlighted issue's peek body. Where it sits is the caller's. */
export function IssuePeek({ issue, className = "", ...props }: { issue: Issue } & HTMLAttributes<HTMLElement>) {
  return (
    <aside aria-label="Quick look" className={`shrink-0 overflow-y-auto ${className}`} {...props}>
      <IssuePeekContent issue={issue} />
    </aside>
  );
}

/** Linear's description in the peek is cut at 420px and fades out into the background when it runs longer (`Mwn`). */
export const PEEK_DESCRIPTION_HEIGHT = 420;
/** Sub-issues listed before "… and N more": all of up to six, else five (`Nwn`). */
export const PEEK_SUB_ISSUES = 6;

/**
 * Linear's issue peek (startup-root `jwn`, rendered by the view peek's `Awn` and the menus' Quick look): 415px wide with 16px/24px
 * padding. The identifier, then 16px apart the title, a muted line of status (with time in status), priority, assignee,
 * project and labels, the description, the due date, and the sub-issues.
 */
export function IssuePeekContent({ issue }: { issue: Issue }) {
  const boards = useStore((s) => s.boards);
  const status = statusOf(boards, issue);
  // The mirrored record holds the rich description; the list's issue only its text.
  const description = useStore((s) => s.full.get(issue.key)?.fields?.description) ?? issue.description;
  const clock = useStore((s) => s.clock);
  return (
    <div className="w-[415px] max-w-full px-6 py-4">
      <Text variant="smallPlus" color="muted" as="div" className="mb-1.5">
        {issue.key}
      </Text>
      <div className="flex flex-col gap-4">
        <Text as="h3" variant="largePlus" className="block">
          {issue.summary}
        </Text>
        <Text as="div" variant="small" color="muted" style={{ lineHeight: "18px" }}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center">
              <span className="mr-2 flex items-center">
                <StatusIcon status={status} />
              </span>
              {status.name}
              {/* oxlint-disable-next-line react/purity -- read at render; `clock` re-renders it each minute, as Linear's `ms(Pf.MINUTE)`. */}
              {issue.statusSince && <>&nbsp;·&nbsp;{statusDuration(issue.statusSince, Math.max(clock, Date.now()))}</>}
            </span>
            <span className="flex items-center">
              <span className="mr-2 flex items-center">
                <PriorityIcon name={issue.priority} />
              </span>
              {issue.priority ?? "No priority"}
            </span>
            {issue.assignee && (
              <span className="flex items-center">
                <span className="mr-2 flex items-center">
                  <Avatar user={issue.assignee} size={16} />
                </span>
                {issue.assignee.name}
              </span>
            )}
            {issue.project && (
              <span className="flex min-w-0 items-center">
                <span className="mr-2 flex items-center">
                  <Icon name="layers" />
                </span>
                <span className="truncate">
                  {issue.project.name}
                  {issue.milestones?.[0] && ` · ${issue.milestones[0].name}`}
                </span>
              </span>
            )}
            {issue.labels.length > 0 && (
              <span className="flex flex-wrap items-center gap-4">
                {issue.labels.map((l) => (
                  <span key={l} className="flex items-center gap-2">
                    <LabelDot name={l} />
                    {l}
                  </span>
                ))}
              </span>
            )}
          </div>
        </Text>
        <PeekDescription issue={issue} description={description} />
        {issue.due && (
          <Text as="div" variant="small" color="muted" className="flex items-center">
            <span className="mr-1.5 flex items-center">
              <DueIcon due={issue.due} resolved={issue.resolved} />
            </span>
            {peekDueText(issue.due, new Date(clock))}
          </Text>
        )}
        <PeekSubIssues issue={issue} />
      </div>
    </div>
  );
}

function hasContent(description: unknown): boolean {
  if (typeof description === "string") return description.trim() !== "";
  const nodes = (description as { content?: { type: string; content?: unknown[] }[] } | undefined)?.content ?? [];
  return nodes.some((n) => n.type !== "paragraph" || !!n.content?.length);
}

function PeekDescription({ issue, description }: { issue: Issue; description: unknown }) {
  const [overflowing, setOverflowing] = useState(false);
  // Linear's `KSn` measures whether the description runs past its cap, and only then draws the fade.
  const measure = (node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(() => setOverflowing(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  };
  if (!hasContent(description))
    return (
      <div className="my-0.5 text-[15px] text-fg-4" data-peek-description>
        No description
      </div>
    );
  return (
    <div ref={measure} data-peek-description className="relative overflow-hidden" style={{ maxHeight: PEEK_DESCRIPTION_HEIGHT }}>
      <Adf node={description} issueKey={issue.key} attachments={issue.attachments} />
      {overflowing && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-(--card)" />
      )}
    </div>
  );
}

/** "N Sub-issues" and up to six rows of status, title and assignee, ordered by workflow column (`Nwn`). */
function PeekSubIssues({ issue }: { issue: Issue }) {
  const boards = useStore((s) => s.boards);
  const children = useStore((s) => childrenByParent(s.issues).get(issue.key));
  if (!children?.length) return null;
  const ordered = children
    .map((child) => ({ child, status: statusOf(boards, child) }))
    .sort((a, b) => a.status.order - b.status.order);
  const shown = ordered.length > PEEK_SUB_ISSUES ? ordered.slice(0, PEEK_SUB_ISSUES - 1) : ordered;
  const more = ordered.length - shown.length;
  return (
    <div className="flex flex-col" data-peek-sub-issues>
      <div className="flex h-7 items-center">
        <Text variant="smallPlus" color="muted">
          {ordered.length === 1 ? "Sub-issue" : "Sub-issues"}
        </Text>
      </div>
      {shown.map(({ child, status }) => (
        <div key={child.key} className="flex h-7 items-center">
          <span className="mr-2 flex size-4 shrink-0 items-center justify-center">
            <StatusIcon status={status} />
          </span>
          <Text variant="small" wrap="truncate" className="min-w-0 flex-1">
            {child.summary}
          </Text>
          {child.assignee && (
            <span className="ml-2 flex shrink-0">
              <Avatar user={child.assignee} size={16} />
            </span>
          )}
        </div>
      ))}
      {more > 0 && (
        <div className="flex h-7 items-center">
          <Text variant="small" color="muted">
            … and {more} more
          </Text>
        </div>
      )}
    </div>
  );
}

/** Linear's peek due line (`Mwn`): "Due today", "Due tomorrow", "in 5 days", "1 day overdue", "5 days overdue". */
export function peekDueText(due: string, now: Date): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T00:00:00` : due);
  if (Number.isNaN(date.getTime())) return due;
  const days = Math.round((day(date) - day(now)) / 86_400_000);
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days === -1) return "1 day overdue";
  return days > 0 ? `in ${distance(days)}` : `${distance(-days)} overdue`;
}

/** date-fns `formatDistance` in whole days, as Linear's `v` words it. */
function distance(days: number): string {
  if (days < 30) return `${days} days`;
  if (days < 45) return "about 1 month";
  if (days < 60) return "about 2 months";
  if (days < 365) return `${Math.round(days / 30)} months`;
  const years = Math.floor(days / 365),
    rest = days % 365;
  return rest < 91 ? `about ${years} year${years > 1 ? "s" : ""}` : rest < 274 ? `over ${years} year${years > 1 ? "s" : ""}` : `almost ${years + 1} years`;
}
