import { type Issue, type IssueDraft } from "@/shared/issue-model";
import { isEpic, type IssueLookup } from "@/shared/epics";

/**
 * The composer's draft on another board. Linear's Set team drops only its TEAM_DEPENDENT_FIELDS (`stateId`, `cycleId`,
 * `assigneeId`, `delegateId`, `projectId`, `projectMilestoneId`; startup-root `resolveFieldConflicts`) and keeps the
 * rest. Here the board's statuses, its project's assignable people, the Jira project and its versions are the dependent
 * ones, and so is the epic, Linear's project (`projectId`, BJ-256); priority, labels, due date, type (when the new board has
 * it), a parent issue, links and sub-issues stay. An epic `lookup` doesn't hold stays: `parentInProject` still checks it.
 */
export function switchBoard(draft: IssueDraft, from: number, to: number, lookup: IssueLookup = () => undefined): IssueDraft {
  if (from === to) return draft;
  const { status: _status, assignee: _assignee, project: _project, milestones: _milestones, ...kept } = draft;
  const parent = kept.parent ? lookup(kept.parent) : undefined;
  if (parent && isEpic(parent)) delete kept.parent;
  return { ...kept, board: to };
}

type Project = NonNullable<Issue["project"]>;
/**
 * The draft with a parent Jira will take. Jira links a parent (an epic, or a sub-task's parent) only within the issue's own
 * Jira project, so a parent from another project would be refused at create (BJ-257): a view's epic filter or group, a resumed
 * draft or a parent picked before the project changed can all bring one. When the draft hasn't chosen a project and the
 * parent's is one of the board's (`projects`), the issue goes there with it; otherwise the parent is dropped, never sent.
 * A parent the mirror doesn't hold, or one without a project, can't be judged and stays.
 */
export function parentInProject(draft: IssueDraft, projects: readonly Project[], lookup: IssueLookup): IssueDraft {
  const parent = draft.parent ? lookup(draft.parent) : undefined,
    own = draft.project ?? projects[0];
  if (!parent?.project || !own || parent.project.key === own.key) return draft;
  if (!draft.project && projects.some((p) => p.key === parent.project!.key)) return { ...draft, project: parent.project };
  const { parent: _foreign, ...rest } = draft;
  return rest;
}
