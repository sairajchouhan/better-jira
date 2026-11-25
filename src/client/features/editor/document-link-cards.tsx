import { useEffect, useState, type RefObject } from "react";
import { ElementHoverCard } from "@/client/components/hover-card";
import { CARD_RULES } from "@/client/components/tooltip-rules";
import { Text } from "@/client/components/text";

/** What Linear's link card reads for a URL (LightboxEditorProvider `Ea`): its host, then its path unless that is only "/", its query
 *  and its hash. */
export function linkCardText(href: string): string {
  if (!URL.canParse(href)) return href;
  const url = new URL(href);
  return url.host + (url.pathname === "/" ? "" : url.pathname) + url.search + url.hash;
}

/** The web link a pointer is over in a document, if that link has no card of its own: an issue chip's card is its issue's. */
export function hoveredWebLink(target: EventTarget | null, root: Pick<HTMLElement, "contains">): HTMLAnchorElement | null {
  if (typeof (target as Element | null)?.closest !== "function") return null;
  const link = (target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link || !root.contains(link) || link.closest("[data-hover-card-trigger], [data-hover-card]")) return null;
  return /^https?:$/.test(link.protocol) ? link : null;
}

/**
 * Linear's `linkPopovers` (`HUn`) for a comment or description: the pointer over a web link (a plain link, or a link chip without
 * a card of its own) opens the document popover (`Aa`) under it with the link's address (`Ea`), 450ms after the pointer comes onto
 * it, 150ms after it leaves. One listener on the document's root finds the link, as `HUn` does for its view, so the read-only
 * document and the editor (whose chips render in their own React roots) share it.
 */
export function DocumentLinkCards({ root }: { root: RefObject<HTMLElement | null> }) {
  const [link, setLink] = useState<HTMLAnchorElement | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const found = hoveredWebLink(event.target, element);
      if (found) setLink(found);
    };
    element.addEventListener("pointerover", over);
    // A link the editor removes (typed away under a still pointer) takes its card with it: no pointerleave comes.
    const gone = new MutationObserver(() => setLink((link) => (link && !link.isConnected ? null : link)));
    gone.observe(element, { childList: true, subtree: true });
    return () => {
      element.removeEventListener("pointerover", over);
      gone.disconnect();
    };
  }, [root]);
  if (!link?.isConnected) return null;
  return (
    <ElementHoverCard
      key={linkKey(link)}
      element={link}
      rules={CARD_RULES.documentLink}
      label="Link"
      content={<LinkCardText href={link.href} />}
    />
  );
}

/** A key per link element, so each link gets its own card and timers. */
const linkKeys = new WeakMap<Element, number>();
let nextLinkKey = 0;
const linkKey = (link: Element) => {
  let key = linkKeys.get(link);
  if (key === undefined) linkKeys.set(link, (key = nextLinkKey++));
  return key;
};

/** `Ea`: the address in Text mini, labelTitle, wrapped pretty. */
const LinkCardText = ({ href }: { href: string }) => (
  <Text variant="mini" color="title" wrap="pretty">
    {linkCardText(href)}
  </Text>
);
