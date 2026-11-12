import { type Issue } from "@/shared/issue-model";
import type { HTMLAttributes } from "react";
import { StatusIcon } from "@/client/components/icons";
import { useStore } from "@/client/state/store";
import { statusOf } from "./sub-issues";
import { Text } from "@/client/components/text";

/** Linear's Quick look (→ in a menu): the highlighted issue at its 415px peek width (VK.PEEK_WIDTH). Where it sits is the caller's. */
export function IssuePeek({ issue, className = "", ...props }: { issue: Issue } & HTMLAttributes<HTMLElement>) {
  const boards = useStore((s) => s.boards);
  const status = statusOf(boards, issue);
  return (
    <aside aria-label="Quick look" className={`w-[415px] shrink-0 overflow-y-auto p-4 ${className}`} {...props}>
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <Text variant="mini" color="muted">
          {issue.key}
        </Text>
      </div>
      <Text as="h3" variant="regularPlus" className="mt-2">
        {issue.summary}
      </Text>
      <Text as="p" variant="small" color="muted" className="mt-1">
        {[status.name, issue.assignee?.name ?? "Unassigned", issue.priority ?? "No priority"].join(" · ")}
      </Text>
      {issue.description ? (
        <Text as="p" variant="small" className="mt-3 whitespace-pre-wrap">
          {issue.description}
        </Text>
      ) : null}
    </aside>
  );
}
