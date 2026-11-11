import { StatusIcon } from "./icons";
import { actions, boardOf, ui, useStore, useAssignableUsers, type User, statusOf } from "./store";
import { Avatar } from "./avatar";
import { issueAnchor } from "./menu-surface";
import { PickerRow, PropertyMenu } from "./property-menu";
/** Linear's status and assignee menus (RAJ-52): under the property in the issue view, else under the selected card. */
export function StatusPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  const board = boardOf(issueKey);
  if (!issue || !board) return null;
  const statuses = board.columns.flatMap((c) => c.statuses.map((s) => ({ ...s, column: c.name })));
  return (
    <PropertyMenu
      label="Change status"
      placeholder="Change status…"
      hotkey="S"
      anchor={issueAnchor("prop-status", issueKey)}
      close={() => ui.send({ type: "overlay.close" })}
      current={statusOf(issue)?.name}
    >
      {statuses.map((s, i) => (
        <PickerRow
          key={s.id}
          value={s.name}
          keywords={[s.column]}
          icon={<StatusIcon status={s} />}
          current={s.id === issue.status}
          number={i < 9 ? i + 1 : undefined}
          onSelect={() => actions.status(issueKey, s.id)}
        >
          {s.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}

export function AssignPicker({ issueKey }: { issueKey: string }) {
  const current = useStore((s) => s.issues.get(issueKey)?.assignee);
  const users = useAssignableUsers();
  const value = (u: User) => `${u.name} ${u.id}`;
  return (
    <PropertyMenu
      label="Assign issue"
      placeholder="Assign to…"
      hotkey="A"
      anchor={issueAnchor("prop-assignee", issueKey)}
      close={() => ui.send({ type: "overlay.close" })}
      current={current ? value(current) : "No assignee"}
    >
      <PickerRow
        value="No assignee"
        icon={<Avatar user={null} size={16} />}
        current={!current}
        number={0}
        onSelect={() => actions.assign(issueKey, null)}
      >
        No assignee
      </PickerRow>
      {users.map((u, i) => (
        <PickerRow
          key={u.id}
          value={value(u)}
          icon={<Avatar user={u} size={16} />}
          current={current?.id === u.id}
          number={i < 9 ? i + 1 : undefined}
          onSelect={() => actions.assign(issueKey, u)}
        >
          {u.name}
        </PickerRow>
      ))}
    </PropertyMenu>
  );
}
