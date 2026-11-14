import { Avatar } from "@/client/components/avatar";
import { EntityIdentifier } from "@/client/components/entity-identifier";
import { StatusIcon } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { MenuSurface } from "@/client/components/menu-surface";
import { navigate } from "@/client/features/navigation/app-navigation";
import { get, useStore } from "@/client/state/store";
import type { Issue } from "@/shared/issue-model";
import type { TrailStep } from "@/client/features/navigation/issue-trail";
import { childrenVariant, directSubIssues, PARENT_LINE, statusOf } from "./sub-issue-model";

/** Opens an issue in the panel, keeping the current view; `trail` says how its page was reached (navigation.ts). */
export const openIssue = (target: Issue, trail?: TrailStep) =>
  navigate({
    board: target.board,
    selected: target.key,
    panel: true,
    view: get().view,
    ...(trail !== undefined ? { trail } : {}),
  });
/** Opens one of `parent`'s sub-issues as its Sub-issues section does: the page shows `parent` in its breadcrumb and steps through
 *  its sub-issues (Linear's sub-issue rows push onto its breadcrumb stack). */
export const openSubIssue = (child: Issue, parent: string) => openIssue(child, { parent });

/** Linear's "Open sub-issue…" (`OPEN_SUB_ISSUE`, startup-root `c_r`) as a menu under its trigger: `parent`'s direct sub-issues, in
 *  the Sub-issues section's order, each opening that issue; `current` is checked. The parent line's, a sub-issue row's and a card's
 *  progress pill open it. An epic's menu is worded as its epic issues, never sub-issues (PARENT_LINE, BJ-289). */
export function ChildrenMenu({ parent, current, anchor, close }: { parent: Issue; current?: string; anchor: HTMLElement; close: () => void }) {
 const all = useStore(s => s.issues), boards = useStore(s => s.boards);
 const status = (i: Issue) => statusOf(boards, i);
 const siblings = directSubIssues(all, boards, parent.key);
 const label = PARENT_LINE[childrenVariant(parent)].open(parent.key);
 return (        <MenuSurface
          label={label}
          anchor={anchor}
          close={() => close()}
          fit
        >
          <Menu style={{ width: 347 }}>
            <Menu.Input
              hideWhenEmpty
              autoFocus
              aria-label={`${label}…`}
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
                      if (child.key !== current) openSubIssue(child, parent.key);
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
