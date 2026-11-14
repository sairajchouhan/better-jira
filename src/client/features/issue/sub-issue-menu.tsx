import { Avatar } from "@/client/components/avatar";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { StatusIcon } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { MenuSurface } from "@/client/components/menu-surface";
import { navigate } from "@/client/features/navigation/app-navigation";
import { get, useStore } from "@/client/state/store";
import type { Issue } from "@/shared/issue-model";
import { defaultSubIssueDisplay, statusOf, subIssueRows } from "./sub-issue-model";

/** Opens an issue in the panel, keeping the current view. */
export const openIssue = (target: Issue) =>
  navigate({
    board: target.board,
    selected: target.key,
    panel: true,
    view: get().view,
  });

/** Linear's "Open sub-issue…" (`OPEN_SUB_ISSUE`, startup-root `c_r`) as a menu under its trigger: `parent`'s direct sub-issues, in
 *  the Sub-issues section's order, each opening that issue; `current` is checked. The parent line's, a sub-issue row's and a card's
 *  progress pill open it. */
export function ChildrenMenu({ parent, current, anchor, close }: { parent: Issue; current?: string; anchor: HTMLElement; close: () => void }) {
 const all = useStore(s => s.issues), boards = useStore(s => s.boards);
 const status = (i: Issue) => statusOf(boards, i);
 const siblings = subIssueRows(parent.key, all, defaultSubIssueDisplay(), status).rows.filter(row => row.depth === 0).map(row => row.issue);
 return (        <MenuSurface
          label={`Open sub-issues of ${parent.key}`}
          anchor={anchor}
          close={() => close()}
          fit
        >
          <Menu style={{ width: 347 }}>
            <Menu.Input
              hideWhenEmpty
              autoFocus
              aria-label={`Open sub-issues of ${parent.key}…`}
            />
            <Menu.List>
              <Menu.Group heading="Navigation">
                {siblings.map((child) => (
                  <Menu.Item
                    key={child.key}
                    value={`${child.key} ${child.summary}`}
                    icon={<StatusIcon status={status(child)} />}
                    checked={child.key === current}
                    hint={<Avatar user={child.assignee ?? null} size={14} />}
                    onSelect={() => {
                      close();
                      if (child.key !== current) openIssue(child);
                    }}
                  >
                    <EntityIdentifier className="mr-2 text-[var(--menu-fg-3)]">
                      {child.key}
                    </EntityIdentifier>
                    {child.summary}
                  </Menu.Item>
                ))}
              </Menu.Group>
            </Menu.List>
          </Menu>
        </MenuSurface>);
}
