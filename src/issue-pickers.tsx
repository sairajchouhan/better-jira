import { StatusMenu, AssigneeMenu } from "./property-menu";
import { actions, boardOf, useStore } from "./store";
import { ui } from "./app-navigation";
import { issueAnchor } from "./menu-surface";
export function StatusPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  if (!issue) return null;
  return (
    <StatusMenu
      anchor={issueAnchor("prop-status", issueKey)}
      board={boardOf(issueKey)}
      value={issue.status}
      onChange={(status) => actions.status(issueKey, status)}
      close={() => ui.send({ type: "overlay.close" })}
    />
  );
}
export function AssignPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  if (!issue) return null;
  return (
    <AssigneeMenu
      anchor={issueAnchor("prop-assignee", issueKey)}
      board={boardOf(issueKey)}
      value={issue.assignee ?? null}
      onChange={(user) => actions.assign(issueKey, user)}
      close={() => ui.send({ type: "overlay.close" })}
    />
  );
}
