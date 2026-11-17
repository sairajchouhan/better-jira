import { expect, test } from "bun:test";
import { CARD_RULES } from "@/client/components/tooltip-rules";
import { hoveredWebLink, linkCardText } from "./document-link-cards";

test("a link's card reads Linear's `Ea`: host, the path unless it is only /, the query and the hash", () => {
  expect(linkCardText("https://example.com/")).toBe("example.com");
  expect(linkCardText("https://example.com")).toBe("example.com");
  expect(linkCardText("https://docs.example.com:8443/a/b?x=1&y=2#top")).toBe("docs.example.com:8443/a/b?x=1&y=2#top");
  expect(linkCardText("http://example.com/path/")).toBe("example.com/path/");
});

/** A stand-in for a link element: what `closest` finds above it, and its protocol. */
const element = (above: Record<string, unknown>, protocol = "https:") => {
  const self: Record<string, unknown> = {
    protocol,
    closest: (selector: string) => (selector === "a[href]" ? self : (above[selector] ?? null)),
  };
  return self as unknown as EventTarget;
};
const root = { contains: () => true };

test("every web link in a document gets the card, a plain link or a link chip, unless it has a card of its own", () => {
  const plain = element({});
  expect(hoveredWebLink(plain, root)).toBe(plain as never);
  // An issue chip sits in its issue card's trigger; a link inside an open card is the card's.
  expect(hoveredWebLink(element({ "[data-hover-card-trigger], [data-hover-card]": {} }), root)).toBeNull();
  expect(hoveredWebLink(element({}, "mailto:"), root)).toBeNull();
  expect(hoveredWebLink(element({}), { contains: () => false })).toBeNull();
  expect(hoveredWebLink(null, root)).toBeNull();
});

test("a link's card is Linear's ExternalLink popover: below the link from its start, 450ms in, 150ms out, a 4px pad", async () => {
  expect(CARD_RULES.documentLink).toMatchObject({
    timing: { delay: 450, restartOnMove: false },
    placement: "bottom-start",
    fallbacks: ["bottom", "bottom-start", "top-start", "top"],
    pad: 4,
    leaveGraceMs: 150,
  });
  const source = await Bun.file(new URL("./document-link-cards.tsx", import.meta.url)).text();
  expect(source).toContain("rules={CARD_RULES.documentLink}");
  expect(source).toContain('<Text variant="mini" color="title" wrap="pretty">');
  // A link removed under a still pointer closes its card.
  expect(source).toContain("setLink((link) => (link && !link.isConnected ? null : link))");
  // The read-only document and the editor both listen.
  expect(await Bun.file(new URL("./adf.tsx", import.meta.url)).text()).toContain("<DocumentLinkCards root={root} />");
  expect(await Bun.file(new URL("./rich-editor.tsx", import.meta.url)).text()).toContain("<DocumentLinkCards root={host} />");
});
