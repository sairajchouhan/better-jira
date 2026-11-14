/** The board card's and list row's link, pull request, comment and creator badges (Linear's `mt`, `mhn`; .raj/linear.md "Board card"). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QueryObserver } from "@tanstack/query-core";
import { Avatar } from "@/client/components/avatar";
import { Badge } from "@/client/components/badge";
import { Text } from "@/client/components/text";
import { HoverCard, MoreList } from "@/client/components/hover-card";
import { Icon, PullRequestStatusIcon, ReviewStatusIcon } from "@/client/components/icons";
import { LinkIcon } from "@/client/components/link-icon";
import { ActionMenu, ContextMenu, type ActionEntry } from "@/client/components/action-menu";
import { hotkeyOf } from "@/client/features/navigation/shortcuts";
import { showNotification } from "@/client/state/app-notifications";
import { set, useStore } from "@/client/state/store";
import { navigate } from "@/client/features/navigation/app-navigation";
import { post, run, useCommand } from "@/client/features/navigation/commands";
import { commentCount } from "@/client/features/media/media-edits";
import { fullTime } from "./issue-dates";
import { queryClient } from "@/client/state/server-data";
import type { Issue, User } from "@/shared/issue-model";
import {
  leadingStatus,
  pullRequestBadgeText,
  pullRequestDescription,
  pullRequestStatusText,
  reviewDecision,
  type PullRequest,
} from "@/shared/pull-requests";
import { externalTitle, faviconSrc, linkBadgeText } from "@/shared/smart-link";
import { SubIssueProgressButton } from "@/client/components/sub-issue-progress-button";
import { shortcutTitle } from "@/client/components/keycap";
import { IssueHoverCard } from "./issue-hover-card";
import { ChildrenMenu, openSubIssue } from "./sub-issue-menu";
import { childrenByParent, subIssueCount } from "./sub-issue-model";

const openExternal = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

// ——— Links (Linear `mt`, "Open link…" `ht`, card `gt`) ———

type Link = { url: string; title: string; subtitle: string; origin?: string };
/** A link as its badge, card and menu name it: Jira's title when the web link has one (Linear's link card `gt` shows the
 *  attachment's title), else a name read from the URL. */
export const linkOf = (url: string, title?: string): Link => {
  if (!URL.canParse(url)) return { url, title: title ?? url, subtitle: url };
  const parsed = new URL(url);
  return { url, title: title ?? externalTitle(parsed), subtitle: url, origin: parsed.origin };
};
const LinkImage = ({ link }: { link: Link }) => (
  <LinkIcon src={link.origin && faviconSrc(link.origin)} size={14} className="rounded-[3px]" />
);

/** Linear's link card (`gt`): up to five links, each its icon, its title (opens it) and a muted subtitle of two lines at most. */
function LinksCard({ links }: { links: Link[] }) {
  return (
    <MoreList items={links} max={5}>
      {(shown) =>
        shown.map((link, index) => (
          <div key={link.url} className="flex flex-col gap-2.5">
            <div className="flex max-w-[320px] items-start gap-3">
              <span className="mt-px">
                <LinkImage link={link} />
              </span>
              <div className="flex min-w-0 flex-col items-start gap-2">
                <a href={link.url} target="_blank" rel="noreferrer" className="max-w-[300px] truncate text-[13px] font-medium text-fg">
                  {link.title}
                </a>
                <span className="line-clamp-2 text-[13px] break-all text-fg-3">{link.subtitle}</span>
              </div>
            </div>
            {index < shown.length - 1 && <div className="h-px bg-[var(--menu-line)]" />}
          </div>
        ))
      }
    </MoreList>
  );
}

/** Linear's link badges (`mt`): under three links, one badge each (its icon and short name) that opens it; from three, one count
 *  badge, with the links' icon when they share a source, that opens "Open link…" listing them. Hover shows the links' card. */
export function LinkBadges({ issue }: { issue: Issue }) {
  const links = (issue.links ?? []).map((url) => linkOf(url, issue.linkTitles?.[url]));
  if (!links.length) return null;
  if (links.length < 3)
    return links.map((link) => (
      <HoverCard key={link.url} label="Link" content={<LinksCard links={[link]} />}>
        <Badge.Link href={link.url} aria-label={`Open link ${link.title} on ${issue.key}`}>
          <Badge.Icon>
            <LinkImage link={link} />
          </Badge.Icon>
          <Badge.Text>{linkBadgeText(link.url)}</Badge.Text>
        </Badge.Link>
      </HoverCard>
    ));
  const shared = links.every((l) => l.origin && l.origin === links[0]!.origin);
  const entries: ActionEntry[] = links.map((link) => ({
    name: link.title,
    hint: link.subtitle.length > 80 ? `${link.subtitle.slice(0, 77)}...` : link.subtitle,
    image: <LinkImage link={link} />,
    run: () => openExternal(link.url),
  }));
  return (
    <HoverCard label="Links" content={<LinksCard links={links} />}>
      <Badge.Menu aria-label={`Links on ${issue.key}`} menu={ActionMenu} menuProps={{ label: "Open link…", entries }}>
        <Badge.Icon>{shared ? <LinkImage link={links[0]!} /> : <Icon name="link" />}</Badge.Icon>
        <Badge.Text>{links.length}</Badge.Text>
      </Badge.Menu>
    </HoverCard>
  );
}

// ——— Pull requests (Linear `mhn`, action "Go to linked pull request…" `xpn`, card `Vhn`) ———

type PullRequestIssue = Pick<Issue, "key" | "prCount" | "prStatus">;
type PullRequestKey = readonly ["pull-requests", string, number, string];
/** The issue's count and state are part of the key: when the mirror reports a pull request opened, reviewed or merged (from Jira or
 *  GitHub), the badge, card and menu read the list again instead of showing the old one for five minutes. */
const pullRequestQuery = (issue: PullRequestIssue, enabled = true) => ({
  queryKey: ["pull-requests", issue.key, issue.prCount ?? 0, issue.prStatus ?? ""] as PullRequestKey,
  queryFn: async (): Promise<PullRequest[]> => {
    const response = await fetch(`/api/issues/${encodeURIComponent(issue.key)}/pull-requests`);
    if (!response.ok) throw new Error("Could not read the pull requests.");
    return response.json();
  },
  enabled,
  staleTime: 5 * 60_000,
  retry: false,
});
/** The issue's pull requests from Jira's development panel and GitHub: one read per issue every five minutes, or when its count or
 *  state changes, shared by its badge, card and menu. */
export const fetchPullRequests = (issue: PullRequestIssue) => queryClient.fetchQuery(pullRequestQuery(issue));
/** `read`: whether mounting reads them (a single PR's badge needs its number, the issue's sidebar its list); otherwise this only
 *  shows what a hover or click read. */
export function usePullRequests(issue: PullRequestIssue, read = true) {
  const { key, prCount, prStatus } = issue;
  const [observer] = useState(
    () => new QueryObserver<PullRequest[], Error, PullRequest[], PullRequest[], PullRequestKey>(queryClient, pullRequestQuery(issue, read)),
  );
  useEffect(() => observer.setOptions(pullRequestQuery({ key, prCount, prStatus }, read)), [observer, key, prCount, prStatus, read]);
  const result = () => observer.getCurrentResult();
  return useSyncExternalStore((changed) => observer.subscribe(changed), result, result);
}

const PullRequestIcon = ({ pr }: { pr: PullRequest }) => <PullRequestStatusIcon status={pr.status} />;

/** Linear's trailing author (`Khn`): the pull request's creator as a small avatar, at the end of its card's title and its row. */
const PullRequestAuthor = ({ pr }: { pr: PullRequest }) =>
  pr.author ? (
    <span className="flex shrink-0 items-center">
      <Avatar user={{ id: pr.author, name: pr.author }} size={16} title={null} />
    </span>
  ) : null;

/** The time a pull request's "Merged 3d ago" counts to: read at render, and the app's minute clock renders it again, as Linear's
 *  status (`qhn`) re-reads it on its own clock (`ms(3e4)`). */
function usePullRequestNow() {
  const clock = useStore((s) => s.clock);
  // oxlint-disable-next-line react/purity -- read at render; `clock` re-renders it each minute.
  return Math.max(clock, Date.now());
}

/** Linear's PR row (`Whn`), one per pull request in the card of several: the status icon (its status as the native tooltip), the
 *  title over a muted line of the identifier and status (`pullRequestDescription`), the author at the end. It opens the pull
 *  request. */
function PullRequestRow({ pr }: { pr: PullRequest }) {
  const now = usePullRequestNow();
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" className="flex w-full min-w-0 items-center gap-2" data-pull-request={pr.number}>
      <span className="flex items-center" title={pullRequestStatusText(pr, now)}>
        <PullRequestIcon pr={pr} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Text variant="smallPlus" color="base" wrap="truncate">
          {pr.title}
        </Text>
        <Text variant="mini" color="muted" wrap="truncate">
          {pullRequestDescription(pr, now)}
        </Text>
      </span>
      <PullRequestAuthor pr={pr} />
    </a>
  );
}

/** Linear's pull request card (`PK` → `Hhn`): the status icon beside the title (three lines at most, it opens the pull request) over
 *  the repository and number, the author at the end; under them the status without reviews ("Merged 3d ago" once merged or
 *  closed) and, when a reviewer answered, the review's mark. */
export function PullRequestCard({ pr }: { pr: PullRequest }) {
  const review = reviewDecision(pr);
  const now = usePullRequestNow();
  return (
    <div className="flex max-w-[320px] min-w-0 flex-col gap-2 py-1" data-pull-request-card={pr.number}>
      <a href={pr.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-start gap-2 rounded-[4px]">
        <PullRequestStatusIcon status={pr.status} size={16} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text variant="smallPlus" color="base" lines={3}>
            {pr.title}
          </Text>
          {(pr.repo || pr.number) && (
            <Text variant="mini" color="muted">
              {pr.repo}
              {pr.number}
            </Text>
          )}
        </span>
        <PullRequestAuthor pr={pr} />
      </a>
      <div className="flex items-end gap-2">
        <Text variant="small" color="muted" wrap="nowrap" className="flex-1">
          {pullRequestStatusText(pr, now, { reviews: false })}
        </Text>
        {review && <ReviewStatusIcon status={review.status} label={review.label} size="small" />}
      </div>
    </div>
  );
}

/** Linear's badge card (`Vhn`): one pull request is its card (`PK`), as the issue sidebar's row shows it; several are rows (`Whn`),
 *  three and "Show N more". */
export function PullRequestsCardContent({ prs }: { prs: PullRequest[] }) {
  if (prs.length === 1) return <PullRequestCard pr={prs[0]!} />;
  return <MoreList items={prs} max={3}>{(shown) => shown.map((pr) => <PullRequestRow key={pr.url} pr={pr} />)}</MoreList>;
}

/** The badge's hover: the issue's pull requests as Linear's `Vhn` shows them, once read. */
function PullRequestsCard({ issue }: { issue: Issue }) {
  const { data, isError } = usePullRequests(issue);
  if (isError) return <span className="text-fg-3">Could not read the pull requests.</span>;
  if (!data) return <span className="text-fg-3">Loading pull requests…</span>;
  if (!data.length) return <span className="text-fg-3">No linked pull requests.</span>;
  return <PullRequestsCardContent prs={data} />;
}

const pullRequestEntries = (prs: PullRequest[]): ActionEntry[] =>
  prs.map((pr) => ({
    name: pr.title,
    hint: `${pr.repo ?? ""}${pr.number}`,
    image: <PullRequestIcon pr={pr} />,
    run: () => openExternal(pr.url),
  }));
/** Linear's "Go to linked pull request…" (`xpn`, immediatelyExecuteSingularSubAction): one pull request opens; several list. */
const goToPullRequestsLabel = (count: number) => `Go to linked pull ${count === 1 ? "request" : "requests"}…`;

/** Copies `text` with Linear's info toast: `title` over the copied text. */
async function copyText(text: string, title: string, icon?: "copy") {
  try {
    await navigator.clipboard.writeText(text);
    showNotification({ text: title, detail: text, icon });
  } catch {
    set({ perf: "Could not access the clipboard" });
  }
}

/** Linear's pull request menu (`lhn` with hideDisplayPreference) as far as Jira's read-only development data goes: "Open in GitHub"
 *  (`rhn`), then the Copy submenu (`chn`: the review tool's URL, then the source and target branch names, `bK` and `lmn`). Linear's
 *  other rows act on its own review entity or write to the provider (Open in Linear, Edit, Change link type, draft, merge, close,
 *  auto-merge, Unlink), which Jira can't. */
export function pullRequestActions(pr: PullRequest): ActionEntry[] {
  const image = <LinkImage link={linkOf(pr.url)} />;
  // ⇧⌘. is `bK`'s own shortcut: Linear binds it to the same keys as the issue's "Copy git branch name" (`SX`, which yields when a
  // pull request is the target). Nothing here makes a pull request a key target, and an open action menu runs no global key
  // (open-action-menus.ts), so the hint is display-only, as Linear's is inside this menu.
  const branches: ActionEntry[] = [
    ...(pr.branch
      ? [{ name: "Copy branch name", icon: "branch", shortcut: hotkeyOf("copy-branch"), run: () => void copyText(pr.branch!, "Branch name copied to clipboard", "copy") } as const]
      : []),
    ...(pr.target ? [{ name: "Copy target branch name", icon: "branch", run: () => void copyText(pr.target!, "Branch name copied to clipboard", "copy") } as const] : []),
  ];
  return [
    { name: `Open in ${pr.tool ?? "source"}`, image, run: () => openExternal(pr.url) },
    {
      name: "Copy",
      icon: "copy",
      divider: true,
      search: "hidden",
      children: [
        { name: pr.tool ? `Copy ${pr.tool} URL` : "Copy URL", image, run: () => void copyText(pr.url, "URL copied to clipboard") },
        ...branches.map((entry, index) => (index === 0 ? { ...entry, divider: true } : entry)),
      ],
    },
  ];
}

/** Linear's pull request badge (`mhn`): one PR shows its status icon and number ("#7"); several show the icon of the first status in
 *  Linear's order and "N PRs". The count and Jira's summary state come with the issue (its Development field), so several PRs cost
 *  no read; one PR's number needs Jira's development detail, read when the badge mounts. A click runs "Go to linked pull request…",
 *  which opens the one pull request or lists them below the badge (board `bottom-left`, list `bottom-right`); ⇧→ on the card does
 *  the same. Hover shows the card. One pull request's badge opens Linear's pull request menu on right-click, at the pointer, in place
 *  of the card's issue menu (`wO` with `lhn`); several leave the right-click to the card. */
export function PullRequestBadge({ issue, layout }: { issue: Issue; layout: "board" | "list" }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data } = usePullRequests(issue, issue.prCount === 1);
  const go = async (target: HTMLElement) => {
    const prs = await fetchPullRequests(issue).catch(() => []);
    if (prs.length === 1) openExternal(prs[0]!.url);
    else setAnchor(target);
  };
  // ⇧→ on this card or row: the badge's own menu, so it opens where a click would open it.
  const button = useRef<HTMLButtonElement>(null);
  useCommand("open-pull-requests", (key) => {
    if (key !== issue.key || !button.current) return;
    void go(button.current);
    return true;
  });
  const count = data?.length || (issue.prCount ?? 0);
  const text = pullRequestBadgeText(count, data?.[0]?.number);
  const badge = (
    <HoverCard label="Pull requests" content={<PullRequestsCard issue={issue} />}>
      <Badge.Button
        ref={button}
        aria-label={`Pull requests on ${issue.key}`}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onPointerEnter={() => void queryClient.prefetchQuery(pullRequestQuery(issue))}
        onClick={(e) => (anchor ? setAnchor(null) : void go(e.currentTarget))}
      >
        <Badge.Icon>
          <PullRequestStatusIcon status={(data?.length ? leadingStatus(data) : undefined) ?? issue.prStatus} />
        </Badge.Icon>
        {text && <Badge.Text>{text}</Badge.Text>}
      </Badge.Button>
    </HoverCard>
  );
  return (
    <>
      {count === 1 ? (
        <ContextMenu
          label="Pull request options"
          entries={() => (data?.[0] ? pullRequestActions(data[0]) : [{ name: data ? "No linked pull requests" : "Loading pull requests…" }])}
        >
          {badge}
        </ContextMenu>
      ) : (
        badge
      )}
      {anchor && (
        <ActionMenu
          anchor={anchor}
          align={layout === "list" ? "end" : undefined}
          label={goToPullRequestsLabel(count)}
          entries={data?.length ? pullRequestEntries(data) : [{ name: data ? "No linked pull requests" : "Loading pull requests…" }]}
          close={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/** ⇧→ on a card or row: the card's pull request badge opens it when shown; otherwise the one pull request, or the newest. */
export async function goToPullRequests(issue: Issue) {
  if (run("open-pull-requests", issue.key)) return;
  const prs = await fetchPullRequests(issue).catch(() => []);
  if (prs[0]) openExternal(prs[0].url);
}

// ——— Sub-issues (Linear's board card `wd` in IssueList, list row `at` in issueWidgetFieldPreferences) ———

/**
 * Linear's sub-issue badge, on every issue with sub-issues (no display property turns it off): the progress ring and "done/total",
 * the sub-issues its Sub-issues section lists (`subIssueCount`, so an epic counts its issues). A card counts its direct sub-issues
 * (`t.children`), a row every level below (`t.descendants`). A click is "Open sub-issue…" (`c_r`): a lone sub-issue opens, otherwise
 * (or from the keyboard) the menu of the direct sub-issues opens under the badge. With one sub-issue its hover is that issue's card
 * (Linear's `Ir` titled "Sub-issue"); with more, the action's name and ⌘⇧↓ as the tooltip.
 */
export function SubIssueBadge({ issue, layout }: { issue: Issue; layout: "board" | "list" }) {
  const count = useStore((s) => subIssueCount(s.issues, s.boards, issue.key, layout === "board" ? "children" : "descendants"));
  const children = useStore((s) => childrenByParent(s.issues).get(issue.key));
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!count) return null;
  // A count of one, at either depth, is one direct sub-issue.
  const only = count.total === 1 ? children?.[0] : undefined;
  const badge = (
    <SubIssueProgressButton
      variant="badge"
      completed={count.done}
      total={count.total}
      aria-label={`Sub-issues of ${issue.key}: ${count.done} of ${count.total} done`}
      aria-haspopup="dialog"
      aria-expanded={!!anchor}
      title={only ? undefined : shortcutTitle("Open sub-issue…", hotkeyOf("child-open"))}
      onClick={(e) => {
        if (anchor) return setAnchor(null);
        // Linear opens a lone direct sub-issue on a click, and lists it when the keyboard pressed the badge (`keyboardInvoked`).
        if (children?.length === 1 && e.detail > 0) openSubIssue(children[0]!, issue.key);
        else setAnchor(e.currentTarget);
      }}
    />
  );
  return (
    <>
      {only ? (
        <IssueHoverCard relation={{ key: only.key, kind: "sub-issue" }} issue={only}>
          {badge}
        </IssueHoverCard>
      ) : (
        badge
      )}
      {anchor && <ChildrenMenu parent={issue} anchor={anchor} close={() => setAnchor(null)} />}
    </>
  );
}

// ——— Comments and creator: no Linear card badge; each reuses Linear's nearest behaviour ———

/** The comment count. A click is Linear's "Comment on issue" (⌃M): the issue opens with its comment box focused, below its
 *  comments. */
export function CommentBadge({ issue }: { issue: Issue }) {
  const count = commentCount(issue);
  if (!count) return null;
  const label = `${count} ${count === 1 ? "comment" : "comments"}`;
  return (
    <Badge.Button
      aria-label={label}
      title={label}
      onClick={() => {
        navigate({ selected: issue.key, panel: true });
        post("focus-comment", issue.key);
      }}
    >
      <Badge.Icon>
        <Icon name="comment" />
      </Badge.Icon>
      <Badge.Text>{count}</Badge.Text>
    </Badge.Button>
  );
}

/** Linear's user card (`ift` → `sft`): a large avatar beside the name, with the detail line under it. */
function UserCard({ user, detail }: { user: User; detail?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 px-1 py-0.5">
        <Avatar user={user} size={32} title={null} />
        <span className="text-[13px] font-medium text-fg">{user.name}</span>
      </div>
      {detail && <span className="px-1 text-[12px] text-fg-3">{detail}</span>}
    </div>
  );
}

/** The creator's avatar with Linear's user hover card (the avatar's `enablePopover`, `dj` → `ift`), placed top-start. */
export function CreatorBadge({ issue }: { issue: Issue }) {
  if (!issue.creator) return null;
  return (
    <HoverCard
      label="Creator"
      content={<UserCard user={issue.creator} detail={issue.created ? `Created the issue ${fullTime(issue.created)}` : "Created the issue"} />}
    >
      <span className="flex items-center" aria-label={`Created by ${issue.creator.name}`} data-creator={issue.key}>
        <Avatar user={issue.creator} size={18} title={null} />
      </span>
    </HoverCard>
  );
}
