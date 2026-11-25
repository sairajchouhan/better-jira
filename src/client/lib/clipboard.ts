/**
 * Every clipboard write in the app, ported from Linear's clipboard class `DA` (startup-root.BhUCnb9L.js). One version counter
 * covers all of them, so a copy whose text arrives late never overwrites a newer copy. Linear's `registerWindow` and
 * `clipboardWindow` (pop-out windows) are left out: this app has one window.
 */

/** Linear's `Vdt`: thrown into a late copy's clipboard item so the browser drops it. */
class Cancelled extends Error {
  constructor() {
    super("Clipboard write cancelled by newer operation");
  }
}

let version = 0;
const clipboard = () => navigator.clipboard;
/** Whether the browser can put several formats, or a Promise, on the clipboard (Linear checks `ClipboardItem in window`). */
export const canCopyRich = () => typeof ClipboardItem !== "undefined";
const notAllowed = (error: unknown) => (error as { name?: string } | null)?.name === "NotAllowedError";

/** Linear's `copyWithEvent`: a synchronous `execCommand("copy")` whose capture-phase `copy` listener sets every format.
 *  The fallback when the async clipboard API refuses (no focus, no permission). */
export function copyWithEvent(doc: Pick<Document, "addEventListener" | "removeEventListener" | "execCommand">, formats: Record<string, string>) {
  let copied = false;
  const listener = (event: Event) => {
    const data = (event as ClipboardEvent).clipboardData;
    if (!data) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (const [type, value] of Object.entries(formats)) data.setData(type, value);
    copied = true;
  };
  doc.addEventListener("copy", listener, true);
  try {
    doc.execCommand("copy");
    return copied;
  } catch {
    return false;
  } finally {
    doc.removeEventListener("copy", listener, true);
  }
}

/** Linear's `copyText`. */
export async function copyText(text: string) {
  const current = ++version;
  try {
    await clipboard().writeText(text);
  } catch (error) {
    if (notAllowed(error) && version === current && copyWithEvent(document, { "text/plain": text })) return;
    throw error;
  }
}

/** Starts the write now, inside the click, with the data to follow (`type` is the clipboard format). */
async function writeLater(type: string, data: Promise<Blob>, current: number) {
  const item = data.then((blob) => {
    if (version !== current) throw new Cancelled();
    return blob;
  });
  await clipboard().write([new ClipboardItem({ [type]: item })]);
}

/**
 * Linear's `copyTextAsync`: the write starts at once, inside the user's click, and the text arrives when `text` resolves, so a
 * browser that wants a live gesture (Safari) still accepts it. A newer copy made meanwhile wins: this one resolves "cancelled"
 * and writes nothing. Without `ClipboardItem` it waits for the text and writes it, unless a newer copy came first.
 */
export async function copyTextAsync(text: Promise<string>): Promise<"copied" | "cancelled"> {
  const current = ++version;
  try {
    if (canCopyRich()) await writeLater("text/plain", text.then((value) => new Blob([value], { type: "text/plain" })), current);
    else {
      const value = await text;
      if (version !== current) return "cancelled";
      await clipboard().writeText(value);
    }
    return version === current ? "copied" : "cancelled";
  } catch (error) {
    // The browser may report our Cancelled as its own error; a newer copy explains it either way.
    if (error instanceof Cancelled || version !== current) return "cancelled";
    throw error;
  }
}

/** An image whose bytes are still loading (always PNG: the only image type browsers put on the clipboard). */
export async function copyImageAsync(png: Promise<Blob>) {
  const current = ++version;
  try {
    await writeLater("image/png", png, current);
  } catch (error) {
    if (error instanceof Cancelled || version !== current) return;
    throw error;
  }
}

/** Linear's `copyRichText`: `html` for rich editors (Slack, Docs, Jira), `plain` for everything else; plain text alone without
 *  `ClipboardItem`, and the `copy` event when the browser refuses. */
export async function copyRichText(html: string, plain: string) {
  const current = ++version;
  try {
    if (canCopyRich())
      await clipboard().write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    else await clipboard().writeText(plain);
  } catch (error) {
    if (notAllowed(error) && version === current && copyWithEvent(document, { "text/plain": plain, "text/html": html })) return;
    throw error;
  }
}

/** Linear's `copyLink`. */
export const copyLink = (html: string, markdown: string) => copyRichText(html.trim(), markdown.trim());

const MARKDOWN_LINK_ANGLE_BRACKET = /\[([^\]]*)\]\(<[^>]*>\)/g;
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;
/** Linear's `stripMarkdownLinks`: `[text](url)` becomes `text`. */
export const stripMarkdownLinks = (text: string) =>
  text.replace(MARKDOWN_LINK_ANGLE_BRACKET, "$1").replace(MARKDOWN_LINK, "$1");
/** Linear's `formatLinkedText`: "KEY: Title", or the title alone, with Markdown links stripped. */
export const formatLinkedText = (text: string, identifier?: string) =>
  stripMarkdownLinks(identifier ? `${identifier}: ${text}` : text);

const sameLength = (texts: string[], urls: string[]) => texts.length > 0 && texts.length === urls.length;
/** Linear's `generateHTMLForLinkedTexts`: one link, closed by a zero-width space so a rich editor doesn't stretch it over the
 *  next word typed, or a list of links. */
export function linkedTextsHTML(texts: string[], urls: string[]) {
  if (!sameLength(texts, urls)) return undefined;
  const escaped = texts.map((text) => stripMarkdownLinks(text).replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return escaped.length === 1
    ? `<a href="${urls[0]}">${escaped[0]}&#8203;</a>`
    : `<ul>${escaped.map((text, i) => `<li><a href="${urls[i]}">${text}</a></li>`).join("")}</ul>`;
}
/** Linear's `generateMarkdownForLinkedTexts`: `[text](url)`, or a bulleted list of them. */
export function linkedTextsMarkdown(texts: string[], urls: string[]) {
  if (!sameLength(texts, urls)) return undefined;
  const escaped = texts.map((text) => stripMarkdownLinks(text).replace(/[[\]]/g, "\\$&"));
  return escaped.length === 1 ? `[${escaped[0]}](${urls[0]})` : escaped.map((text, i) => `- [${text}](${urls[i]})`).join("\n");
}
/** Copies `texts` linked to `urls` as HTML and Markdown at once (Linear's Copy title as link, and ⌥ Copy ID). */
export function copyLinkedTexts(texts: string[], urls: string[]) {
  const html = linkedTextsHTML(texts, urls),
    markdown = linkedTextsMarkdown(texts, urls);
  if (!html || !markdown) return Promise.reject(new Error("Nothing to link"));
  return copyLink(html, markdown);
}

/** Linear's `dragData`: a dragged row is also its link, for a tab bar (`text/uri-list`), a chat box (`text/plain`) and a rich
 *  editor (`text/html`). */
export function dragData(url: string) {
  const href = url.startsWith("http") ? url : new URL(url, location.origin).href;
  return { "text/uri-list": href, "text/plain": href, "text/html": `<a href="${encodeURI(href)}">${href}</a>` };
}
/** A dragged row: its link, plus `key` under the app's own `type`, which is all an in-app drop reads. */
export const dragItem = (type: string, key: string, url: string): Record<string, string> => ({ ...dragData(url), [type]: key });
