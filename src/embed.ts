/** Linear's embeddable hosts (startup-root `preferredDomains`): a URL pasted from one offers the paste-link menu's embed. */
const EMBED_HOSTS = ["youtube.com", "youtu.be", "loom.com", "figma.com", "jam.dev", "tella.tv", "miro.com", "cleanshot.com"];

const hostOf = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);
    return /^https?:$/.test(protocol) ? hostname.toLowerCase() : null;
  } catch {
    return null;
  }
};
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const embedHost = (url: string) => {
  const host = hostOf(url);
  return host ? EMBED_HOSTS.find((domain) => onHost(host, domain)) : undefined;
};

/** Linear's `isEmbeddableUrl`: an http(s) URL on one of the preferred hosts. */
export const isEmbeddable = (url: string) => !!embedHost(url);

/** The paste-link menu's embed title, Linear's `Kc` (EditorComponent): the default "Show embed" lists after "Keep as link". */
export function embedLabel(url: string) {
  switch (embedHost(url)) {
    case "youtube.com":
    case "youtu.be":
    case "loom.com":
    case "tella.tv":
      return "Embed video";
    case "figma.com":
      return "Embed preview";
    case "miro.com":
      return "Embed board";
    default:
      return "Show embed";
  }
}

/** The frame address for an embed of `url`, or null when it isn't one we can frame. Linear asks iframe.ly; these are each
 * provider's public embed URLs. ponytail: jam.dev and cleanshot frame the page itself; map them when their embed URLs matter. */
export function embedSource(url: string): string | null {
  const host = embedHost(url);
  if (!host) return null;
  const u = new URL(url),
    path = u.pathname.split("/").filter(Boolean);
  switch (host) {
    case "youtube.com":
    case "youtu.be": {
      const id =
        host === "youtu.be" ? path[0] : u.searchParams.get("v") ?? (["shorts", "embed", "live"].includes(path[0]!) ? path[1] : null);
      return id && /^[\w-]+$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }
    case "loom.com":
      return ["share", "embed"].includes(path[0]!) && path[1] ? `https://www.loom.com/embed/${path[1]}` : null;
    case "figma.com":
      return `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(url)}`;
    case "miro.com":
      return path[0] === "app" && path[1] === "board" && path[2] ? `https://miro.com/app/live-embed/${path[2]}/` : null;
    case "tella.tv":
      return path[0] === "video" && path[1] ? `https://www.tella.tv/video/${path[1]}/embed` : null;
    default:
      return u.protocol === "https:" ? u.href : null;
  }
}

/** The frame's attributes (DOM names), shared by the editor's node and the read-only view. Linear's embed is 100% × 400px (CSS `.rich-embed`). */
export const embedFrame = (src: string) => ({
  src,
  title: "Embedded content",
  loading: "lazy",
  allow: "fullscreen; picture-in-picture; clipboard-write; encrypted-media",
  allowfullscreen: "true",
  referrerpolicy: "strict-origin-when-cross-origin",
  sandbox: "allow-scripts allow-same-origin allow-popups allow-presentation allow-forms",
}) as const;
