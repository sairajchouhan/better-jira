import { useId, useState, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from "@floating-ui/react";
import { Avatar } from "@/client/components/avatar";
import { PriorityIcon, StatusIcon } from "@/client/components/icons";
import { AppLink } from "@/client/features/navigation/app-link";
import { jiraIssueURL } from "./issue-urls";
import { get, statusOf } from "@/client/state/store";
import type { Issue } from "@/shared/issue-model";
import type { Relation } from "@/shared/relations";

/** Linear Hft/Wft/Kft: interactive issue card, 550ms, left beside relation pills.
 * The body uses mirror data already in memory; external links use Jira's linked-issue projection. */
export function IssueHoverCard({
  relation,
  issue,
  children,
}: {
  relation: Relation;
  issue?: Issue;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const {
    refs: { setReference, setFloating },
    floatingStyles,
    context,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "left",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ fallbackPlacements: ["left-start", "left-end"] }),
      shift({ padding: 10 }),
    ],
  });
  const hover = useHover(context, {
    mouseOnly: true,
    delay: { open: 550, close: 400 },
    handleClose: safePolygon(),
  });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
  ]);
  const status = issue ? statusOf(issue) : relation.issue?.status;
  return (
    <>
      <span
        ref={setReference}
        className="inline-flex min-w-0 max-w-full"
        {...getReferenceProps()}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>
      {open ? (
        <FloatingPortal>
          <div
            ref={setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            id={id}
            role="tooltip"
            data-issue-hover={relation.key}
            className="z-50 w-max min-w-[220px] max-w-[380px] rounded-lg border border-border bg-panel p-1.5 text-xs text-fg shadow-xl"
          >
            <div className="mb-1.5 flex items-center justify-between gap-4 text-fg-3">
              <span>{relation.key}</span>
              {issue?.assignee ? (
                <span className="flex items-center gap-1.5">
                  <Avatar user={issue.assignee} size={16} />
                  {issue.assignee.name}
                </span>
              ) : null}
            </div>
            {issue ? (
              <AppLink
                to={{
                  board: issue.board,
                  selected: issue.key,
                  panel: true,
                  view: get().view,
                }}
                className="line-clamp-2 font-medium hover:underline"
              >
                {issue.summary}
              </AppLink>
            ) : (
              <a
                href={jiraIssueURL(relation.key)}
                target="_blank"
                rel="noreferrer"
                className="line-clamp-2 font-medium hover:underline"
              >
                {relation.issue?.summary ?? relation.key}
              </a>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
              {status ? (
                <span className="flex items-center gap-1.5">
                  <StatusIcon status={status} />
                  {status.name}
                </span>
              ) : null}
              {issue?.project ? <span>{issue.project.name}</span> : null}
              {issue?.priority ? (
                <span className="flex items-center gap-1.5">
                  <PriorityIcon name={issue.priority} />
                  {issue.priority}
                </span>
              ) : null}
            </div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  );
}
