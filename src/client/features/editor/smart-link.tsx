import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { IssueHoverCard } from "@/client/features/issue/issue-hover-card";
import { Icon, PullRequestStatusIcon, StatusIcon } from "@/client/components/icons";
import { SiteIcon } from "@/client/components/link-icon";
import { CARD_RULES } from "@/client/components/tooltip-rules";
import { usePullRequestStatus } from "@/client/state/pull-request-status";
import { openIssueByKey } from "@/client/features/navigation/app-navigation";
import { useSmartLinkDetails } from "@/client/state/smart-link-details";
import { get, statusOf, subscribe } from "@/client/state/store";
import { safeLink } from "@/shared/document";
import { githubPullRequest, smartLink, type SmartLink as Target } from "@/shared/smart-link";

/** Linear's mention chip (startup-root `jE`): an image kept on the first line with its text, then a muted prefix (an issue's
 *  key) and the label. One chip for every smart link kind, in read-only documents and the editor alike. */
export function MentionChip({ kind, href, image, prefix, label, onClick }: {
  kind: Target["kind"]; href: string; image: ReactNode; prefix?: string; label?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a
      className="mention-chip smart-link"
      data-smart-link={kind}
      href={href}
      {...(onClick ? { onClick } : { target: "_blank", rel: "noreferrer" })}
      draggable={false}
    >
      <span className="smart-link-image">
        {image}
        {"⁠ "}
      </span>
      <span className="smart-link-text">
        {prefix ? <span className="smart-link-affix">{label ? `${prefix} ` : prefix}</span> : null}
        {label}
      </span>
    </a>
  );
}

/** Linear's issue mention: status icon, key, title. From the mirror when the issue is on a board, else the server's read;
 *  until then the key alone, as Linear's fallback shows it. A plain click on an issue of this Jira site opens it here, held
 *  or not (BJ-354), as Linear's mention loads any issue by its identifier (`getIssueOrSuspend`); ⌘-click, and an issue on
 *  another site, open Jira's page (as editor-links' followLink does). */
function IssueLink({ link }: { link: Extract<Target, { kind: "issue" }> }) {
  const mirror = () => (link.site === get().site ? get().issues.get(link.key) : undefined);
  const mirrored = useSyncExternalStore(subscribe, mirror, mirror);
  const details = useSmartLinkDetails(link.url, !mirrored && link.site === get().site);
  const status = mirrored ? statusOf(mirrored) : details?.status;
  return (
    <IssueHoverCard
      relation={{ kind: "related", key: link.key, issue: { summary: mirrored?.summary ?? details?.title ?? link.key, status: status ?? { name: "", category: "new" } } }}
      issue={mirrored}
      // In a document an issue chip's card is the editor's popover (`HUn` → `Aa`), as a mention's is.
      rules={CARD_RULES.document}
    >
    <MentionChip
      kind="issue"
      href={link.url}
      image={<StatusIcon status={status ?? { name: "", category: "new" }} />}
      prefix={link.key}
      label={mirrored?.summary ?? details?.title}
      onClick={
        link.site === get().site
          ? (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              openIssueByKey(link.key);
            }
          : undefined
      }
    />
    </IssueHoverCard>
  );
}

function PageLink({ link }: { link: Extract<Target, { kind: "confluence" }> }) {
  const details = useSmartLinkDetails(link.url, !!link.pageId && link.site === get().site);
  return <MentionChip kind="confluence" href={link.url} image={<Icon name="file" />} label={details?.title || link.title} />;
}

/** A link's image in its chip: a GitHub pull request's state icon once this app has read its state (an issue's pull requests), as
 *  Linear's PR mention shows it; else its site's icon (GitHub's logo, or a favicon), so a pull request whose state is unread wears
 *  GitHub's logo, not a state it may not have. The state colours are GitHub's own (Primer's open green, merged purple, closed
 *  red), the user's choice over Linear's palette. */
const ExternalLinkImage = ({ url }: { url: string }) => (githubPullRequest(url) ? <PullRequestImage url={url} /> : <SiteIcon url={url} />);

/** Only a pull request link watches the query cache for its state. */
function PullRequestImage({ url }: { url: string }) {
  const status = usePullRequestStatus(url);
  return status ? <PullRequestStatusIcon status={status} /> : <SiteIcon url={url} />;
}

function ExternalLink({ link }: { link: Extract<Target, { kind: "external" }> }) {
  return (
    <MentionChip
      kind="external"
      href={link.url}
      image={<ExternalLinkImage url={link.url} />}
      label={link.title}
    />
  );
}

/** The wrapper both renderings give a smart link, so the read-only document and the editor lay it out the same. */
export const smartLinkWrapper = (block: boolean) =>
  block ? { tag: "p" as const, className: "smart-link-block" } : { tag: "span" as const, className: "smart-link-node" };

/** A Jira smart link (inlineCard, blockCard, or an embedCard that can't be framed) as Linear's mention chip (BJ-16). */
export function SmartLink({ url, data }: { url: unknown; data?: unknown }) {
  const link = smartLink(url, data);
  if (!link)
    return (
      <a href={safeLink(url) ?? undefined} target="_blank" rel="noreferrer">
        {String(url ?? "Link")}
      </a>
    );
  switch (link.kind) {
    case "issue":
      return <IssueLink link={link} />;
    case "confluence":
      return <PageLink link={link} />;
    default:
      return <ExternalLink link={link} />;
  }
}
