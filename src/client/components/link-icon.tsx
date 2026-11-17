import { useState } from "react";
import { faviconSrc } from "@/shared/smart-link";
import { GitHubLogo, Icon } from "./icons";

/** A site's icon, falling back to the link icon when it does not load. One control for resources and smart links. */
export function LinkIcon({ src, size = 16, className = "rounded-full" }: { src?: string; size?: 14 | 16; className?: string }) {
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? (
    <img
      data-link-icon
      alt=""
      src={src}
      width={size}
      height={size}
      onError={() => setFailed(src)}
      className={`shrink-0 object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <Icon name="link" />
  );
}

/** Whether a URL is on github.com. */
export const isGitHub = (url: string | undefined) =>
  !!url && URL.canParse(url) && new URL(url).hostname.replace(/^www\./, "") === "github.com";

/** The 14px icon of the site a link points at: one control for a smart link in a comment or description, a link badge and its
 *  card, and an Activity link entry. GitHub gets Linear's GitHub logo (`HT`) in its labelMuted colour, since GitHub's favicon is a
 *  black mark that disappears on the dark theme; every other site its favicon through our server, rounded 3px. */
export function SiteIcon({ url }: { url?: string }) {
  if (isGitHub(url)) return <GitHubLogo />;
  const origin = url && URL.canParse(url) ? new URL(url).origin : undefined;
  return <LinkIcon src={origin && faviconSrc(origin)} size={14} className="rounded-[3px]" />;
}
