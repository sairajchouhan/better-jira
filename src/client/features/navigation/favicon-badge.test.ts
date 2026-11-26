import { describe, expect, test } from "bun:test";
import { syncFavicon, UNREAD_FAVICON_HREF } from "./favicon-badge";

type FakeLink = {
  rel: string;
  type: string;
  href: string;
  attrs: Map<string, string>;
  isConnected: boolean;
  hasAttribute: (name: string) => boolean;
  setAttribute: (name: string, value: string) => void;
  remove: () => void;
};

function fakeDocument(initialIcons: { href: string; type?: string }[]) {
  const children: FakeLink[] = [];
  const makeLink = (init: { rel?: string; href?: string; type?: string } = {}): FakeLink => {
    const link: FakeLink = {
      rel: init.rel ?? "",
      type: init.type ?? "",
      href: init.href ?? "",
      attrs: new Map(),
      isConnected: false,
      hasAttribute: (name) => link.attrs.has(name),
      setAttribute: (name, value) => void link.attrs.set(name, value),
      remove() {
        const idx = children.indexOf(link);
        if (idx >= 0) children.splice(idx, 1);
        link.isConnected = false;
      },
    };
    return link;
  };

  for (const icon of initialIcons) {
    const link = makeLink({ rel: "icon", href: icon.href, type: icon.type });
    link.isConnected = true;
    children.push(link);
  }

  const head = {
    querySelectorAll: (selector: string) => {
      if (selector === 'link[rel="icon"]') return children.filter((c) => c.rel === "icon");
      if (selector === "link[data-unread-favicon]") return children.filter((c) => c.hasAttribute("data-unread-favicon"));
      return [];
    },
    querySelector: (selector: string) => head.querySelectorAll(selector)[0] ?? null,
    appendChild: (link: FakeLink) => {
      if (!children.includes(link)) children.push(link);
      link.isConnected = true;
      return link;
    },
  };

  return {
    head,
    children,
    createElement: () => makeLink(),
  } as unknown as Document & { children: FakeLink[] };
}

describe("syncFavicon", () => {
  test("swaps static icon links for the unread dot favicon and restores them when cleared", () => {
    const doc = fakeDocument([
      { href: "/assets/favicon.ico" },
      { href: "/assets/favicon.svg", type: "image/svg+xml" },
    ]);

    syncFavicon(false, doc);
    expect(doc.children.map((c) => c.href)).toEqual(["/assets/favicon.ico", "/assets/favicon.svg"]);

    syncFavicon(true, doc);
    expect(doc.children).toHaveLength(1);
    expect(doc.children[0]?.href).toBe(UNREAD_FAVICON_HREF);
    expect(doc.children[0]?.hasAttribute("data-unread-favicon")).toBe(true);

    // Repeated calls with the same state do not duplicate the icon link.
    syncFavicon(true, doc);
    expect(doc.children).toHaveLength(1);

    syncFavicon(false, doc);
    expect(doc.children.map((c) => c.href)).toEqual(["/assets/favicon.ico", "/assets/favicon.svg"]);
    expect(doc.children.every((c) => !c.hasAttribute("data-unread-favicon"))).toBe(true);
  });
});
