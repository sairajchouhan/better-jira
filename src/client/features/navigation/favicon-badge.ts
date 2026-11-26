/**
 * Switches the browser tab favicon to show an unread indicator dot when the inbox has unread notifications,
 * and restores the original `<link rel="icon">` tags when the count reaches zero.
 */

const UNREAD_FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
  "<style>.i{fill:#141417}.d{fill:#EF4444}@media (prefers-color-scheme:dark){.i{fill:#EDEDF0}.d{fill:#FF5555}}</style>" +
  '<path class="i" d="M8 1A7 7 0 1 0 15 8H8Z"/>' +
  '<circle class="d" cx="12.5" cy="3.5" r="3.3"/>' +
  "</svg>";

export const UNREAD_FAVICON_HREF = `data:image/svg+xml,${encodeURIComponent(UNREAD_FAVICON_SVG)}`;

const UNREAD_ATTR = "data-unread-favicon";

type IconState = {
  originals: HTMLLinkElement[];
  badged: boolean | undefined;
};

const stateByDoc = new WeakMap<Document, IconState>();

function iconState(doc: Document): IconState {
  let state = stateByDoc.get(doc);
  if (!state) {
    const originals = [...doc.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')].filter(
      (link) => !link.hasAttribute(UNREAD_ATTR),
    );
    state = { originals, badged: undefined };
    stateByDoc.set(doc, state);
  }
  return state;
}

/** Updates `<head>` icon links to reflect whether the inbox has unread notifications. */
export function syncFavicon(hasUnread: boolean, doc: Document | undefined = globalThis.document) {
  if (!doc?.head) return;
  const state = iconState(doc);
  if (state.badged === hasUnread) return;
  state.badged = hasUnread;

  if (hasUnread) {
    for (const link of state.originals) link.remove();
    const existing = doc.head.querySelector<HTMLLinkElement>(`link[${UNREAD_ATTR}]`);
    if (existing) {
      existing.href = UNREAD_FAVICON_HREF;
      return;
    }
    const link = doc.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.href = UNREAD_FAVICON_HREF;
    link.setAttribute(UNREAD_ATTR, "");
    doc.head.appendChild(link);
    return;
  }

  for (const link of doc.head.querySelectorAll(`link[${UNREAD_ATTR}]`)) link.remove();
  for (const link of state.originals) {
    if (!link.isConnected) doc.head.appendChild(link);
  }
}
