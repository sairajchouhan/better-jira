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
    <MenuSurface label={label} close={close} command width={720}>
      <div className="command-menu">
        <div className="command-menu-title">
          <span className="command-menu-chip">
            <span className="command-menu-key">{issue.key}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{issue.summary}</span>
          </span>
        </div>
        {children}
      </div>
    </MenuSurface>
  );
}
