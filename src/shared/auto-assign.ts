import { type User } from "./issue-model";

/**
 * Linear's two "Automations and workflows" preferences (Preferences, `X3.automationsAndWorkflows` in startup-entry.Dt5YDWdY.js),
 * both off until turned on (`default:!1`):
 * - "Auto-assign to self" (`autoAssignToSelf`): "When creating new issues, always assign them to yourself by default".
 * - "On move to started status, assign to yourself" (`assignToSelfWhenStarted`, stored as the user setting
 *   `selfAssignOnGitBranchCopy`): "When you move an unassigned issue to started, it will be automatically assigned to you".
 */
export type AutoAssignPreferences = { autoAssignToSelf: boolean; assignToSelfWhenStarted: boolean };
export const AUTO_ASSIGN_DEFAULTS: AutoAssignPreferences = {
  autoAssignToSelf: false,
  assignToSelfWhenStarted: false,
};
export const AUTO_ASSIGN_LABELS = {
  autoAssignToSelf: {
    name: "Auto-assign to self",
    description: "When creating new issues, always assign them to yourself by default",
  },
  assignToSelfWhenStarted: {
    name: "On move to started status, assign to yourself",
    description: "When you move an unassigned issue to started, it will be automatically assigned to you",
  },
} as const satisfies Record<keyof AutoAssignPreferences, { name: string; description: string }>;

/** A stored value, field by field; anything but `true` reads as the default (off). */
export function parseAutoAssign(raw: unknown): AutoAssignPreferences {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    autoAssignToSelf: value.autoAssignToSelf === true,
    assignToSelfWhenStarted: value.assignToSelfWhenStarted === true,
  };
}

/**
 * A new issue's assignee, as Linear's `Issue.create` (`w2.create`): `!ye.assignee&&c!==null&&e.settings.autoAssignToSelf` →
 * you. `undefined` means no one chose (nothing inherited, no filter, no picker), so the preference fills it; `null` is an explicit
 * "No assignee" (`c!==null`), and a person already chosen stays, so both win over the preference.
 */
export function createAssignee(
  chosen: User | null | undefined,
  me: User,
  prefs: AutoAssignPreferences,
): User | null | undefined {
  return chosen === undefined && prefs.autoAssignToSelf ? me : chosen;
}

/**
 * The assignee a status change adds, as Linear's `Issue.assignToState`: `e.isStarted&&!this.assignee&&
 * r.settings.selfAssignOnGitBranchCopy&&!t.skipSelfAssign&&(this.assignee=r)`. Only a started status (`isStarted`: the state type
 * `started`, Jira's "In Progress" category `indeterminate`), only an unassigned issue, and not when the caller passes
 * `skipSelfAssign` (an explicit assignee in the same move wins). `undefined` when the move assigns no one.
 */
export function startAssignee(
  issue: { assignee?: User | null },
  category: string,
  me: User,
  prefs: AutoAssignPreferences,
  skipSelfAssign = false,
): User | undefined {
  return category === "indeterminate" && !issue.assignee && prefs.assignToSelfWhenStarted && !skipSelfAssign
    ? me
    : undefined;
}
