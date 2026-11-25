/**
 * What a page shows when it holds no issue at all (views-navigation-model.ts `resultFeedback` kind `empty`), Linear's
 * `zeroStateFallback`: a board tab draws ViewEmptyState (ViewEmptyState.DLTlzQ6O.js) with the tab's copy
 * (EmptyAllIssues.CBeZOHQx.js, TeamIssuesViewPage.BzFyyARb.js), a personal page tab MyIssuesEmptyPage
 * (MyIssuesEmptyPage.DqEbWkZM.js). Colours map Linear's bgBase → --panel, bgBaseHover → --row-hover,
 * bgBorderSolidThin → --border-solid-thin, labelBase/Muted/Faint → --fg-2/3/4.
 */
import type { ReactNode } from "react";
import { Button } from "@/client/components/button";
import { Text } from "@/client/components/text";
import { beginCreateInView } from "@/client/state/issue-actions";
import type { Scope } from "@/shared/view-model";
import { personName, type PersonTab } from "@/shared/people";
import { useStore } from "@/client/state/store";

const BASE = "var(--panel)",
  HOVER = "var(--row-hover)",
  THIN = "var(--border-solid-thin)",
  LABEL = "var(--fg-2)",
  MUTED = "var(--fg-3)",
  FAINT = "var(--fg-4)";

/** Linear's primary medium "Create new issue" of both empty states; it opens the composer with the page's defaults. */
function CreateIssueButton() {
  return <Button variant="primary" size="medium" className="flex-none" onClick={() => beginCreateInView()}>Create new issue</Button>;
}

/**
 * ViewEmptyState: centred in the page, the icon (80px high, 60px on a phone) above, or beside on a window at most 500px
 * high (`column: !(max-height: 500px)`), a 340px column of the title (regularPlus, labelBase), its paragraphs (small, labelMuted, 1.4 line height, 16px apart) and
 * the actions; 24px gaps. Linear's secondary "Documentation" link points at Linear's docs, so it has no counterpart here.
 */
function ViewEmptyState({ icon, title, paragraphs, children }: { icon: ReactNode; title: string; paragraphs: string[]; children: ReactNode }) {
  return <div role="status" className="absolute inset-0 z-[1] flex items-center justify-center">
    <div className="flex max-w-[340px] flex-col gap-6 [@media(max-height:500px)]:flex-row">
      <div className="flex justify-start [&_svg]:h-[80px] [&_svg]:w-auto max-[640px]:[&_svg]:h-[60px]">{icon}</div>
      <div className="flex min-h-[180px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Text variant="regularPlus" color="base">{title}</Text>
          <div className="flex flex-col gap-4">
            {paragraphs.map((p) => <Text key={p} as="p" variant="small" color="muted" wrap="pretty" style={{ lineHeight: 1.4 }}>{p}</Text>)}
          </div>
        </div>
        <div className="flex gap-2">{children}</div>
      </div>
    </div>
  </div>;
}

/** A board tab's copy, Linear's with "space" for team and no Cycles (the work Jira is Kanban). */
const SCOPE_COPY: Record<Scope, { title: string; paragraphs: string[]; icon: () => ReactNode }> = {
  all: {
    title: "All issues",
    paragraphs: ["All issues is the place where you can see all your space’s work in one view. Once you have created issues for this space, they will show up here."],
    icon: AllIssuesIcon,
  },
  active: {
    title: "Active issues",
    paragraphs: ["Active issues represent work that is currently in flight or should be worked on next. There are currently no active issues in this space. Once an issue moves to the Todo or In Progress state, it will show up here."],
    icon: ActiveIssuesIcon,
  },
  backlog: {
    title: "Backlog issues",
    paragraphs: [
      "The backlog is a place for new issues and ideas that haven't been prioritized yet.",
      "When your space is ready to work on these issues, you can move them out of the backlog by updating their status.",
    ],
    icon: BacklogIcon,
  },
};

/** A board tab with no issue: its ViewEmptyState. */
export function ScopeEmptyState({ scope }: { scope: Scope }) {
  const { title, paragraphs, icon: TabIcon } = SCOPE_COPY[scope];
  return <ViewEmptyState icon={<TabIcon />} title={title} paragraphs={paragraphs}><CreateIssueButton /></ViewEmptyState>;
}

/** MyIssuesEmptyPage's line per tab; another person's profile names them instead of "you". */
function personLine(tab: PersonTab, who: string | null) {
  const you = who ?? "you";
  switch (tab) {
    case "assigned": return `No issues assigned to ${you}`;
    case "created": return `No issues created by ${you}`;
    case "subscribed": return who ? `No issues ${who} is subscribed to` : "No issues you are subscribed to";
    case "activity": return `No issues with activity from ${you}`;
  }
}

/** A personal page tab with no issue (MyIssuesEmptyPage): the illustration (120px high), the tab's line (smallPlus,
 *  labelMuted) and Create new issue, centred 20px apart. `person` is null on My issues, else the profile's person. */
export function PersonEmptyState({ tab, person }: { tab: PersonTab; person: string | null }) {
  const issues = useStore((s) => s.issues);
  const who = person ? personName(issues.values(), person) : null;
  return <div role="status" className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-5">
    <MyIssuesIllustration />
    <Text variant="smallPlus" color="muted" className="flex-none">{personLine(tab, who)}</Text>
    <CreateIssueButton />
  </div>;
}

function MyIssuesIllustration() {
  return <svg aria-hidden="true" viewBox="20 23 125 93" fill="none" className="h-[120px] w-min flex-none">
    <path d="M38.3 65.9c-.5-.4-1.2-.4-1.8 0l-9.3 5.4c-3.2 1.8-5 4.3-5 7 0 2.6 1.8 5.1 5 7l11.1 6.4a1.8 1.8 0 1 0 1.8-3.2l-10-5.8c-2.4-1.3-3.4-3-3.4-4.4 0-1.5 1-3.2 3.3-4.5l8.3-4.8a1.8 1.8 0 0 0 0-3.1Zm24.4-12a2 2 0 0 0 1.8 0l9.4-5.4c2.3-1.3 5.3-2 8.4-2 3.1 0 6.2.7 8.5 2l11.1 6.4a1.8 1.8 0 0 0 1.9-3.1L93.7 46a23.1 23.1 0 0 0-11.4-2.8c-4 0-8.1 1-11.3 2.8l-8.3 4.8a1.8 1.8 0 0 0 0 3.1Zm63.6 33.6a1.8 1.8 0 0 0 1.8 3.1l9.4-5.4c3.2-1.8 5-4.3 5-7 0-2.6-1.8-5-5-7L130 67a1.8 1.8 0 0 0-1.8 3.1l6.5 3.8c2.3 1.3 3.3 3 3.3 4.5 0 1.4-1 3-3.3 4.4l-8.3 4.8Zm-60 16.1a1.8 1.8 0 0 0-1.8 3.2l6.5 3.7c3.2 1.9 7.3 2.8 11.3 2.8 4.1 0 8.2-1 11.4-2.8l8.3-4.8a1.8 1.8 0 0 0-1.8-3l-9.4 5.3c-2.3 1.3-5.4 2-8.5 2-3 0-6.1-.7-8.4-2l-7.6-4.4Z" fill={BASE} stroke={THIN} strokeWidth="1.5" />
    <ellipse cx="17" cy="11.2" rx="17" ry="11.2" transform="matrix(-1 0 0 1 99 63)" fill={BASE} stroke={THIN} strokeWidth="1.5" strokeDasharray="3 3" />
    <path d="m36.1 48.2-10.5 6.1a8.6 8.6 0 0 0-4.3 8.6 11 11 0 0 0 5.5 8.3l10.6 6.2a2.2 2.2 0 0 0 3.3-2v-2.1c0-1.1-.6-2-1.5-2.5a79.8 79.8 0 0 1-8.2-4.5 12 12 0 0 1-3.5-3l-.3-1c0-.2 0-.4.2-.7.4-.5 1.1-1.1 2.3-1.8l7.7-4.6c.8-.5 1.3-1.4 1.3-2.3v-3.2c0-1.3-1.4-2.2-2.6-1.5Zm98.2 11.6c2.2 1.3 3.2 2.9 3.3 4.3 0 1.5-.8 3-3 4.4a1 1 0 0 1-.4.1l-6.9.5a2.7 2.7 0 0 0-2.5 2.8v1.3c0 2 2.1 3.4 4 2.4l8.3-4.3c3.8-1.7 5.8-4.6 6-7.9a10.7 10.7 0 0 0-4.4-9.1l-9.3-5.6c-1.2-.6-2.7.2-2.7 1.6v3.5c0 1 .6 2 1.4 2.4l6.2 3.6ZM70.6 96.5c3.2 1.9 7.3 2.8 11.4 2.8 4 0 8.1-1 11.3-2.8l8-4.3c.9-.5 1.4-1.4 1.4-2.4v-3.5c0-1.4-1.5-2.2-2.6-1.5l-9.7 6a17 17 0 0 1-16 0l-8.5-5c-1.2-.7-2.7.1-2.7 1.5v3c0 1 .5 2 1.3 2.4l6.1 3.8ZM62 39.7c.7.4 1.7.4 2.5 0l9-5.2c2.3-1.3 5.4-2 8.5-2 3 0 6.1.7 8.4 2l10.9 6.2a2.3 2.3 0 0 0 3.4-2v-2.6c0-1-.5-1.8-1.3-2.3a39.5 39.5 0 0 0-41.3-1c-.9.5-1.4 1.4-1.4 2.4v2.3c0 .9.5 1.7 1.3 2.2Z" fill={HOVER} stroke={FAINT} strokeWidth="1.5" />
    <path d="M38 47.9c-.6-.4-1.3-.4-1.8 0l-9.4 5.4c-3.2 1.8-5 4.3-5 7 0 2.6 1.8 5.1 5 7L38 73.6a1.8 1.8 0 1 0 1.9-3.2l-10.1-5.8c-2.3-1.3-3.3-3-3.3-4.4 0-1.5 1-3.2 3.3-4.5L38 51a1.8 1.8 0 0 0 0-3.1Zm24.3-12c.6.3 1.3.3 1.9 0l9.3-5.4c2.3-1.3 5.4-2 8.5-2 3 0 6.1.7 8.4 2l11.2 6.4a1.8 1.8 0 0 0 1.8-3.1l-10-5.8A23.1 23.1 0 0 0 82 25.2c-4 0-8.2 1-11.4 2.8l-8.3 4.8a1.8 1.8 0 0 0 0 3.1ZM126 69.5a1.8 1.8 0 1 0 1.8 3.1l9.4-5.4c3.1-1.8 4.9-4.3 4.9-7 0-2.6-1.8-5-5-7l-7.5-4.3a1.8 1.8 0 0 0-1.9 3.1l6.6 3.8c2.3 1.3 3.3 3 3.3 4.5 0 1.4-1 3-3.3 4.4l-8.3 4.8ZM66 85.6a1.8 1.8 0 1 0-1.9 3.2l6.5 3.7c3.2 1.9 7.3 2.8 11.4 2.8 4 0 8.2-1 11.3-2.8l8.3-4.8a1.8 1.8 0 0 0-1.8-3L90.4 90c-2.3 1.3-5.3 2-8.4 2-3.1 0-6.2-.7-8.5-2L66 85.6Z" fill={BASE} stroke={MUTED} strokeWidth="1.5" />
    <path d="M82 69c-9.4 0-17-5.1-17-11.5v-4.4h34v4.4C99 64 91.4 69 82 69Z" fill={HOVER} stroke={LABEL} strokeWidth="1.5" />
    <ellipse cx="17" cy="11.2" rx="17" ry="11.2" transform="matrix(-1 0 0 1 99 41)" fill={BASE} stroke={LABEL} strokeWidth="1.5" />
    <ellipse cx="13" cy="7.8" rx="13" ry="7.8" transform="matrix(-1 0 0 1 95 44.4)" fill={BASE} stroke={FAINT} strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

/** IssuesEmptyStateIcon (IssuesEmptyStateIcon.OpdNCe-N.js): four stacks, the bottom-right one checked. */
function AllIssuesIcon() {
  return <svg aria-hidden="true" viewBox="0 0 80 74" fill="none">
    <path d="M18 33.5c-9.39 0-17-5.96-17-13.3V15h34v5.2c0 7.34-7.61 13.3-17 13.3Z" stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 35 1)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 31 5)" fill={BASE} stroke={LABEL} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 3" />
    <path d="M62 73c-9.39 0-17-5.96-17-13.3v-5.2h34v5.2C79 67.03 71.39 73 62 73Z" stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 79 40.5)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 75 44.5)" fill={LABEL} stroke={LABEL} strokeWidth="1.5" />
    <path d="m55.5 53.64 3.05 2.39a1 1 0 0 0 1.22.01l8.73-6.54" stroke={BASE} strokeWidth="2.5" strokeLinecap="round" />
    <path d="M62 33.5c-9.39 0-17-5.96-17-13.3V15h34v5.2c0 7.34-7.61 13.3-17 13.3Z" stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 79 1)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 75 5)" stroke={LABEL} strokeWidth="1.5" />
    <path d="M18 73C8.61 73 1 67.04 1 59.7v-5.2h34v5.2C35 67.03 27.39 73 18 73Z" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 35 40.5)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 31 44.5)" stroke={LABEL} strokeWidth="1.5" />
    <path d="M28 53.5c0 3.31-4.48 6-10 6v-12c5.52 0 10 2.69 10 6Z" fill={MUTED} />
  </svg>;
}

/** TeamIssuesViewPage's Active issues icon: four stacks, each partly done. */
function ActiveIssuesIcon() {
  return <svg aria-hidden="true" viewBox="0 0 80 74" fill="none">
    <path d="M62 33.5c-9.39 0-17-5.96-17-13.3V15h34v5.2c0 7.34-7.61 13.3-17 13.3Z" fill={BASE} stroke={MUTED} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 79 1)" fill={BASE} stroke={MUTED} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 75 5)" stroke={LABEL} strokeWidth="1.5" />
    <path d="M18 72.5c-9.39 0-17-5.96-17-13.3V54h34v5.2c0 7.34-7.61 13.3-17 13.3Z" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 35 40)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 31 44)" stroke={LABEL} strokeWidth="1.5" />
    <path d="M18 53 L18 47 c5.52 0 10 2.69 10 6 c0 3.31 -4.48 6 -10 6 c-5.52 0 -10 -2.69 -10 -6 Z" fill={MUTED} />
    <path d="M62 72.5c-9.39 0-17-5.96-17-13.3V54h34v5.2c0 7.34-7.61 13.3-17 13.3Z" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 79 40)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 75 44)" stroke={LABEL} strokeWidth="1.5" />
    <path d="M72 53c0 3.31-4.48 6-10 6V47c5.52 0 10 2.69 10 6Z" fill={MUTED} />
    <path d="M18 33.5c-9.39 0-17-5.96-17-13.3V15h34v5.2c0 7.34-7.61 13.3-17 13.3Z" stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform="matrix(-1 0 0 1 35 1)" fill={BASE} stroke={FAINT} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform="matrix(-1 0 0 1 31 5)" stroke={LABEL} strokeWidth="1.5" />
    <path fillRule="evenodd" clipRule="evenodd" d="M72 14c0-3.31-4.48-6-10-6v6h10Z" fill={MUTED} />
  </svg>;
}

/** TeamIssuesViewPage's Backlog issues icon: four stacks, none started. */
function BacklogIcon() {
  const stack = (x: number, y: number, ring: string) => <g key={`${x}-${y}`}>
    <path d={`M${x} ${y + 33.5}c-9.39 0-17-5.96-17-13.3V${y + 15}h34v5.2c0 7.34-7.61 13.3-17 13.3Z`} stroke={ring} strokeWidth="1.5" />
    <ellipse cx="17" cy="13.05" rx="17" ry="13.05" transform={`matrix(-1 0 0 1 ${x + 17} ${y + 1})`} fill={BASE} stroke={ring} strokeWidth="1.5" />
    <ellipse cx="13" cy="9" rx="13" ry="9" transform={`matrix(-1 0 0 1 ${x + 13} ${y + 5})`} fill={BASE} stroke={ring} strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1 3" />
  </g>;
  return <svg aria-hidden="true" viewBox="0 0 80 74" fill="none">
    {stack(18, 0, FAINT)}
    {stack(62, 0, MUTED)}
    {stack(18, 39, FAINT)}
    {stack(62, 39, FAINT)}
  </svg>;
}
