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
 * The draft's Jira project and parent made to agree (BJ-257): a view's epic filter or group, a resumed draft or a parent picked
 * before the project changed can bring a parent from another Jira project. When the draft hasn't chosen a project and the
 * parent's is one of the board's (`projects`), the issue goes there with it. Otherwise a parent issue goes, as Jira keeps a
 * sub-task in its parent's project; an epic stays, as company-managed Jira may link one across projects, and a refusal comes
 * back as a refused create with the composer reopened. A parent the mirror doesn't hold, or one without a project, stays.
 */
export function parentInProject(draft: IssueDraft, projects: readonly Project[], lookup: IssueLookup): IssueDraft {
  const parent = draft.parent ? lookup(draft.parent) : undefined,
    own = draft.project ?? projects[0];
  if (!parent?.project || !own || parent.project.key === own.key) return draft;
  if (!draft.project && projects.some((p) => p.key === parent.project!.key)) return { ...draft, project: parent.project };
  if (isEpic(parent)) return draft;
  const { parent: _foreign, ...rest } = draft;
  return rest;
}
