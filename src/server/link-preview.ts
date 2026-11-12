import { resourceURL, type LinkPreview } from "@/shared/issue-resource";
/** Named references pages use in titles and descriptions; numeric ones are read by number. */
const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", times: "×",
};
/** HTMLRewriter hands text and attributes over as written: `&quot;` stays `&quot;` unless read here (#8). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== "#") return NAMED[name.toLowerCase()] ?? whole;
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}
/** Like Linear's link unfurl: the page title, a description (meta, else the first paragraph) and its icon. Server side only (HTMLRewriter). */
export async function previewFrom(html: string, base: string): Promise<LinkPreview> {
  const meta: Record<string, string> = {};
  let title = "",
    paragraph = "",
    inTitle = false,
    inParagraph = 0,
    icon = "";
  await new HTMLRewriter()
    .on("meta", {
      element(e) {
        const key = (e.getAttribute("property") ?? e.getAttribute("name") ?? "").toLowerCase(),
          content = e.getAttribute("content");
        if (key && content && !(key in meta)) meta[key] = content;
      },
    })
    .on("link", {
      element(e) {
        const rel = (e.getAttribute("rel") ?? "").toLowerCase().split(/\s+/),
          href = e.getAttribute("href");
        if (!icon && href && rel.includes("icon")) icon = href;
      },
    })
    .on("title", {
      element(e) {
        inTitle = true;
        e.onEndTag(() => {
          inTitle = false;
        });
      },
      text(t) {
        if (inTitle) title += t.text;
      },
    })
    .on("p", {
      element(e) {
        if (paragraph) return;
        inParagraph++;
        e.onEndTag(() => {
          inParagraph--;
        });
      },
      text(t) {
        if (inParagraph && paragraph.length < 400) paragraph += t.text;
      },
    })
    .transform(new Response(html))
    .text();
  const clean = (value: string | undefined) =>
    value && decodeEntities(value).replace(/\s+/g, " ").trim().slice(0, 300) || undefined;
  let iconURL: string | null = null;
  try {
    iconURL = resourceURL(new URL(decodeEntities(icon) || "/favicon.ico", base).href);
  } catch {}
  return {
    title: clean(meta["og:title"] ?? title),
    description: clean(meta["og:description"] ?? meta.description ?? paragraph),
    ...(iconURL ? { icon: iconURL } : {}),
  };
}
export async function fetchPreview(url: string): Promise<LinkPreview | null> {
  const href = resourceURL(url);
  if (!href) return null;
  try {
    const response = await fetch(href, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "text/html" },
    });
    if (!response.ok || !/html/i.test(response.headers.get("content-type") ?? "")) return null;
    return await previewFrom((await response.text()).slice(0, 500_000), response.url || href);
  } catch {
    return null;
  }
}
