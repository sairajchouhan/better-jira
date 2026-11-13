/** The board card's and list row's link, pull request, comment and creator badges (Linear's `mt`, `mhn`; .raj/linear.md "Board card"). */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QueryObserver } from "@tanstack/query-core";
import { Avatar } from "@/client/components/avatar";
import { Badge } from "@/client/components/badge";
import { HoverCard, MoreList } from "@/client/components/hover-card";
import { Icon } from "@/client/components/icons";
import { LinkIcon } from "@/client/components/link-icon";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { navigate } from "@/client/features/navigation/app-navigation";
import { post, run, useCommand } from "@/client/features/navigation/commands";
import { commentCount } from "@/client/features/media/media-edits";
import { fullTime } from "./issue-dates";
import { queryClient } from "@/client/state/server-data";
import type { Issue, User } from "@/shared/issue-model";
import { pullRequestStatus, type PullRequest } from "@/shared/pull-requests";
import { externalTitle, faviconSrc, linkBadgeText } from "@/shared/smart-link";

const openExternal = (url: string) => void window.open(url, "_blank", "noopener,noreferrer");

// ——— Links (Linear `mt`, "Open link…" `ht`, card `gt`) ———

type Link = { url: string; title: string; subtitle: string; origin?: string };
const linkOf = (url: string): Link => {
  if (!URL.canParse(url)) return { url, title: url, subtitle: url };
  const parsed = new URL(url);
  return { url, title: externalTitle(parsed), subtitle: url, origin: parsed.origin };
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
  const links = (issue.links ?? []).map(linkOf);
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

type PullRequestKey = readonly ["pull-requests", string];
const pullRequestQuery = (key: string, enabled = true) => ({
  queryKey: ["pull-requests", key] as PullRequestKey,
  queryFn: async (): Promise<PullRequest[]> => {
    const response = await fetch(`/api/issues/${encodeURIComponent(key)}/pull-requests`);
    if (!response.ok) throw new Error("Could not read the pull requests from Jira.");
    return response.json();
  },
  enabled,
  staleTime: 60_000,
  retry: false,
});
/** The issue's pull requests from Jira's development panel: one read per issue a minute, shared by its badge, card and menu. */
export const fetchPullRequests = (key: string) => queryClient.fetchQuery(pullRequestQuery(key));
function usePullRequests(key: string) {
  const [observer] = useState(
    () => new QueryObserver<PullRequest[], Error, PullRequest[], PullRequest[], PullRequestKey>(queryClient, pullRequestQuery(key)),
  );
  useEffect(() => observer.setOptions(pullRequestQuery(key)), [observer, key]);
  const result = () => observer.getCurrentResult();
  return useSyncExternalStore((changed) => observer.subscribe(changed), result, result);
}

const PR_COLOR: Record<PullRequest["status"], string> = {
  open: "var(--st-review)",
  merged: "var(--st-done)",
  declined: "var(--st-canceled)",
  draft: "var(--st-backlog)",
};
const PullRequestIcon = ({ pr }: { pr: PullRequest }) => (
  <span className="flex" style={{ color: PR_COLOR[pr.status] }} data-pr-status={pr.status}>
    <Icon name="branch" />
  </span>
);

/** Linear's PR row (`Whn`): status icon, title (opens it), and a muted line of repository, number, status and author. */
function PullRequestRow({ pr }: { pr: PullRequest }) {
  return (
    <a href={pr.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2" data-pull-request={pr.number}>
      <PullRequestIcon pr={pr} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium text-fg">{pr.title}</span>
        <span className="truncate text-[12px] text-fg-3">
          {[`${pr.repo ?? ""}${pr.number}`, pullRequestStatus(pr), pr.author].filter(Boolean).join(" · ")}
        </span>
      </span>
    </a>
  );
}

/** Linear's PR card (`Vhn`): the one pull request, or up to three with "Show N more". */
function PullRequestsCard({ issue }: { issue: Issue }) {
  const { data, isError } = usePullRequests(issue.key);
  if (isError) return <span className="text-fg-3">Could not read the pull requests from Jira.</span>;
  if (!data) return <span className="text-fg-3">Loading pull requests…</span>;
  if (!data.length) return <span className="text-fg-3">Jira lists no pull requests.</span>;
  return <MoreList items={data} max={3}>{(shown) => shown.map((pr) => <PullRequestRow key={pr.url} pr={pr} />)}</MoreList>;
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

/** Linear's pull request badge (`mhn`): the count, "N PRs"; a click runs "Go to linked pull request…", which opens the one pull
 *  request or lists them below the badge, left edges flush (`bottom-left`); ⇧→ on the card does the same. Hover shows the card. */
export function PullRequestBadge({ issue }: { issue: Issue }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data } = usePullRequests(issue.key);
  const go = async (target: HTMLElement) => {
    const prs = await fetchPullRequests(issue.key).catch(() => []);
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
  const count = issue.prCount ?? 0;
  return (
    <>
      <HoverCard label="Pull requests" content={<PullRequestsCard issue={issue} />}>
        <Badge.Button
          ref={button}
          aria-label={`Pull requests on ${issue.key}`}
          aria-haspopup="dialog"
          aria-expanded={!!anchor}
          onPointerEnter={() => void queryClient.prefetchQuery(pullRequestQuery(issue.key))}
          onClick={(e) => (anchor ? setAnchor(null) : void go(e.currentTarget))}
        >
          <Badge.Icon>
            <Icon name="branch" />
          </Badge.Icon>
          <Badge.Text>
            {count} PR{count === 1 ? "" : "s"}
          </Badge.Text>
        </Badge.Button>
      </HoverCard>
      {anchor && (
        <ActionMenu
          anchor={anchor}
          label={goToPullRequestsLabel(count)}
          entries={data?.length ? pullRequestEntries(data) : [{ name: data ? "Jira lists no pull requests" : "Loading pull requests…" }]}
          close={() => setAnchor(null)}
        />
      )}
    </>
  );
}

/** ⇧→ on a card or row: the card's pull request badge opens it when shown; otherwise the one pull request, or the newest. */
export async function goToPullRequests(issue: Issue) {
  if (run("open-pull-requests", issue.key)) return;
  const prs = await fetchPullRequests(issue.key).catch(() => []);
  if (prs[0]) openExternal(prs[0].url);
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
      // The name the board specs (and screen readers) have always read: "<n> comments".
      aria-label={`${count} comments`}
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
