import { EntityIdentifier } from "./entity-identifier";
import { type Issue } from "@/shared/issue-model";
import { createContext, use, type ReactNode } from "react";

import { MenuSurface } from "./menu-surface";
import { Menu } from "./menu";

const Target = createContext<Issue | null>(null);

/** The issue a shortcut over a board card, list row or sub-issue row acts on. Pickers inside open as Linear's command menu on
 *  it (`CommandMenu`) rather than beside an anchor, which only the open issue's property buttons are (ISSUE-11). */
export function CommandTarget({ issue, children }: { issue: Issue; children: ReactNode }) {
  return <Target value={issue}>{children}</Target>;
}
/** The issue `CommandTarget` gives the pickers inside it; null for a picker beside its anchor. */
export const useCommandTarget = () => use(Target);

const Page = createContext<(() => void) | null>(null);

/**
 * Linear's nested command page (`openSubActions` pushes the menu's state on its stack, `closeSubActions` pops it, startup-root
 * .CnUSfl4j.js): a command menu opened from inside ⌘K (Change status…) is a page of ⌘K's own frame, not a second surface, and
 * Backspace in its empty search runs `back` (onEmptySearchBackspace, Menu.Back). Escape still closes the whole menu.
 */
export function CommandMenuPage({ back, children }: { back: () => void; children: ReactNode }) {
  return (
    <Page value={back}>
      <Menu.Back onBack={back}>{children}</Menu.Back>
    </Page>
  );
}

/** Linear's command menu (WK: CommandMenu's Title, Input, List; sizes `VK` in startup-root.CnUSfl4j.js, spelled out in index.css
 *  `.command-menu`) for a picker on one issue: centred and 720px wide, titled by the issue's chip ("RAJ-14 · basic project
 *  setup"), then the picker's `Menu` with its 46px search and 46px rows. Inside a `CommandMenuPage` it renders in that frame. */
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
  const body = (
    <div className="command-menu">
      <CommandMenuTitle issue={issue} />
      {children}
    </div>
  );
  if (use(Page)) return body;
  return (
    <MenuSurface label={label} close={close} command width={COMMAND_MENU_WIDTH}>
      {body}
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
        <EntityIdentifier className="command-menu-key">{issue.key}</EntityIdentifier>
        <span aria-hidden>·</span>
        <span className="truncate">{issue.summary}</span>
      </span>
    </div>
  );
}
