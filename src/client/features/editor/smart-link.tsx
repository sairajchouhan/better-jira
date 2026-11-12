import { useEffect, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { QueryObserver } from "@tanstack/query-core";
import { IssueHoverCard } from "@/client/features/issue/issue-hover-card";
import { Icon, StatusIcon } from "@/client/components/icons";
import { LinkIcon } from "@/client/components/link-icon";
import { navigate } from "@/client/features/navigation/app-navigation";
import { queryClient } from "@/client/state/server-data";
import { get, statusOf, subscribe } from "@/client/state/store";
import { safeLink } from "@/shared/document";
import { faviconSrc, smartLink, type SmartLink as Target, type SmartLinkDetails } from "@/shared/smart-link";

type Key = readonly ["smart-link", string];
const detailsQuery = (url: string, enabled: boolean) => ({
  queryKey: ["smart-link", url] as Key,
  queryFn: async (): Promise<SmartLinkDetails | null> => {
    const response = await fetch(`/api/smart-link?url=${encodeURIComponent(url)}`);
    return response.ok ? response.json() : null;
  },
  enabled,
  staleTime: Infinity,
});
/** The server's one cached read behind a link on this Jira site (an issue off the board, a Confluence page); the same
 *  URL anywhere on screen shares it. Nothing for other sites. */
function useServerDetails(url: string, enabled: boolean) {
  const [observer] = useState(
    () => new QueryObserver<SmartLinkDetails | null, Error, SmartLinkDetails | null, SmartLinkDetails | null, Key>(queryClient, detailsQuery(url, enabled)),
  );
  useEffect(() => observer.setOptions(detailsQuery(url, enabled)), [observer, url, enabled]);
  const result = () => observer.getCurrentResult();
  return useSyncExternalStore((changed) => observer.subscribe(changed), result, result).data;
}

/** Linear's mention chip (startup-root `jE`): an image kept on the first line with its text, then a muted prefix (an issue's
 *  key) and the label. One chip for every smart link kind, in read-only documents and the editor alike. */
export function MentionChip(props: { kind: "person"; id: string; label: string } | {
  kind: Target["kind"]; href: string; image: ReactNode; prefix?: string; label?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (props.kind === "person") return <span className="mention-chip" data-mention-id={props.id}>{props.label}</span>;
  const {
  kind,
  href,
  image,
  prefix,
  label,
  onClick,
} = props;
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
 *  until then the key alone, as Linear's fallback shows it. A plain click on a mirrored issue opens it here; ⌘-click, and
 *  any other issue, open Jira's page (as editor-links' followLink does). */
function IssueLink({ link }: { link: Extract<Target, { kind: "issue" }> }) {
  const mirror = () => (link.site === get().site ? get().issues.get(link.key) : undefined);
  const mirrored = useSyncExternalStore(subscribe, mirror, mirror);
  const details = useServerDetails(link.url, !mirrored && link.site === get().site);
  const status = mirrored ? statusOf(mirrored) : details?.status;
  return (
    <IssueHoverCard relation={{ kind: "related", key: link.key, issue: { summary: mirrored?.summary ?? details?.title ?? link.key, status: status ?? { name: "", category: "new" } } }} issue={mirrored}>
    <MentionChip
      kind="issue"
      href={link.url}
      image={<StatusIcon status={status ?? { name: "", category: "new" }} />}
      prefix={link.key}
      label={mirrored?.summary ?? details?.title}
      onClick={
        mirrored
          ? (event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              navigate({ board: mirrored.board, selected: mirrored.key, panel: true, view: get().view });
            }
          : undefined
      }
    />
    </IssueHoverCard>
  );
}

function PageLink({ link }: { link: Extract<Target, { kind: "confluence" }> }) {
  const details = useServerDetails(link.url, !!link.pageId && link.site === get().site);
  return <MentionChip kind="confluence" href={link.url} image={<Icon name="file" />} label={details?.title || link.title} />;
}

function ExternalLink({ link }: { link: Extract<Target, { kind: "external" }> }) {
  return (
    <MentionChip
      kind="external"
      href={link.url}
      image={<LinkIcon src={faviconSrc(link.origin)} size={14} className="rounded-[3px]" />}
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
