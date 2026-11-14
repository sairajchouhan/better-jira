import { type IssueDraft } from "@/shared/issue-model";

/** Jira's summary limit. Linear's title fields stop at their own `maxTitleLength` (startup-root `zQ` with
 *  `maxLength: Nu.maxTitleLength`); here the limit is Jira's, so a too-long title is never sent to be refused. */
export const SUMMARY_MAX = 255;

/**
 * The composer's draft on another board. Linear's Set team drops only its TEAM_DEPENDENT_FIELDS (`stateId`, `cycleId`,
 * `assigneeId`, `delegateId`, `projectId`, `projectMilestoneId`; startup-root `resolveFieldConflicts`) and keeps the
 * rest. Here the board's statuses, its project's assignable people, the project and its versions are the dependent
 * ones; priority, labels, due date, type (when the new board has it), links and sub-issues stay.
 */
export function switchBoard(draft: IssueDraft, from: number, to: number): IssueDraft {
  if (from === to) return draft;
  const { status: _status, assignee: _assignee, project: _project, milestones: _milestones, ...kept } = draft;
  return { ...kept, board: to };
}
