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

/** The icon of the site a link points at: one control for a smart link in a comment or description, a link badge and its card, an
 *  Activity link entry, and an issue's link row. GitHub gets Linear's GitHub logo (`HT`) in its labelMuted colour, since GitHub's
 *  favicon is a black mark that disappears on the dark theme; every other site its favicon (`icon`, the page's own when it was
 *  unfurled, else through our server). Inline it is 14px, rounded 3px; in a resource row 16px and round, as Linear's attachment
 *  row draws it (live RAJ-66: a GitHub link's row shows the 16px logo in labelMuted, another site's unfurled icon radius 8px). */
export function SiteIcon({ url, icon, size = 14 }: { url?: string; icon?: string; size?: 14 | 16 }) {
  if (isGitHub(url)) return <GitHubLogo size={size} />;
  const origin = url && URL.canParse(url) ? new URL(url).origin : undefined;
  return <LinkIcon src={icon || (origin && faviconSrc(origin))} size={size} className={size === 16 ? "rounded-full" : "rounded-[3px]"} />;
}
