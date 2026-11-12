import { type Issue } from "@/shared/issue-model";
import { createContext, use, type ReactNode } from "react";

import { MenuSurface } from "./menu-surface";

const Target = createContext<Issue | null>(null);

/** The issue a shortcut over a board card, list row or sub-issue row acts on. Pickers inside open as Linear's command menu on
 *  it (`CommandMenu`) rather than beside an anchor, which only the open issue's property buttons are (ISSUE-11). */
export function CommandTarget({ issue, children }: { issue: Issue; children: ReactNode }) {
  return <Target value={issue}>{children}</Target>;
}
/** The issue `CommandTarget` gives the pickers inside it; null for a picker beside its anchor. */
export const useCommandTarget = () => use(Target);

/** Linear's command menu (WK: CommandMenu's Title, Input, List; sizes `VK` in startup-root.CnUSfl4j.js, spelled out in index.css
 *  `.command-menu`) for a picker on one issue: centred and 720px wide, titled by the issue's chip ("RAJ-14 · basic project
 *  setup"), then the picker's `Menu` with its 46px search and 46px rows. */
export function CommandMenu({
  label,
  issue,
  close,
  children,
}: {
  label: string;
  issue: Issue;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <MenuSurface label={label} close={close} command width={COMMAND_MENU_WIDTH}>
      <div className="command-menu">
        <CommandMenuTitle issue={issue} />
        {children}
      </div>
    </MenuSurface>
  );
}

/** VK.WIDTH: every command menu, the ⌘K palette's included, is 720px wide. */
export const COMMAND_MENU_WIDTH = 720;

/** The command menu's title (VK.TITLE_CONTAINER_HEIGHT): the targeted issue's chip, as Linear promotes its group name to the title
 *  (`promoteToTitle` on the issue group AD). */
export function CommandMenuTitle({ issue }: { issue: Issue }) {
  return (
    <div className="command-menu-title">
      <span className="command-menu-chip">
        <span className="command-menu-key">{issue.key}</span>
        <span aria-hidden>·</span>
        <span className="truncate">{issue.summary}</span>
      </span>
    </div>
  );
}
