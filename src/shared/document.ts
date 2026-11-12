import { smartLinkText, type SmartLinkDetails } from "./smart-link";
export type AdfMark = { type: string; attrs?: Record<string, unknown>; [key: string]: unknown };
export type AdfNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: AdfMark[];
  content?: AdfNode[];
  version?: number;
  [key: string]: unknown;
};
export type AdfDocument = AdfNode & { type: "doc"; version: 1 };

export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
/** A Jira date node's day. Jira stores midnight UTC, so it is read in UTC to keep the day. */
export function jiraDate(timestamp: unknown): string {
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime())
    ? "Date"
    : date.toLocaleDateString(undefined, { timeZone: "UTC" });
}
export function plainDocument(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: text
      ? text.split(/\n{2,}/).map((p) => ({
          type: "paragraph",
          content: p
            .split("\n")
            .flatMap((line, i) => [
              ...(i ? [{ type: "hardBreak" }] : []),
              ...(line ? [{ type: "text", text: line }] : []),
            ]),
        }))
      : [],
  };
}
export function normalizeDocument(value: unknown): AdfDocument {
  if (typeof value === "string") return plainDocument(value);
  if (
    value &&
    typeof value === "object" &&
    (value as AdfNode).type === "doc" &&
    Array.isArray((value as AdfNode).content)
  )
    return structuredClone(value) as AdfDocument;
  return plainDocument("");
}

export function documentHasMedia(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || depth > 100) return false;
  const value = node as AdfNode;
  if (
    (value.type === "media" || value.type === "mediaInline") &&
    (typeof value.attrs?.id === "string" || typeof value.attrs?.url === "string")
  )
    return true;
  return (
    Array.isArray(value.content) &&
    value.content.some((child) => documentHasMedia(child, depth + 1))
  );
}

const discarded = new Map<string, number>();
/** The owner threw this content away (a discarded draft): media still uploading from editors mounted before now is dropped, not added to the next draft. */
export const discardLateMedia = (scope: string) => {
  discarded.set(scope, performance.now());
};
export const lateMediaDiscarded = (scope: string | undefined, since: number) =>
  !!scope && (discarded.get(scope) ?? -Infinity) >= since;

/** Plain text → ADF: blank lines split paragraphs, single newlines become hard breaks. */
export function textToAdf(text: string): AdfDocument {
  return {
    type: "doc",
    version: 1,
    content: text
      .trim()
      .split(/\n{2,}/)
      .map((p) => ({
        type: "paragraph",
        content: p
          .split("\n")
          .flatMap((line, i) => [
            ...(i ? [{ type: "hardBreak" }] : []),
            ...(line ? [{ type: "text", text: line }] : []),
          ]),
      })),
  };
}

const CARDS = ["inlineCard", "blockCard", "embedCard"];
/** ADF as plain text, with each smart link read by `card`. */
function plainText(node: any, card: (node: any) => string): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.attrs?.text) return node.attrs.text;
  if (CARDS.includes(node.type)) return card(node);
  const kids: string[] = (node.content ?? []).map((child: any) => plainText(child, card));
  if (node.type === "doc") return kids.join("\n\n");
  if (node.type === "bulletList" || node.type === "orderedList")
    return kids.map((k) => `- ${k}`).join("\n");
  return kids.join(node.type === "listItem" ? "\n" : "");
}

/** Plain text of ADF: what a reader sees, without formatting or media. */
export function adfToText(node: any, details?: (url: string) => SmartLinkDetails | undefined): string {
  return plainText(node, (card) =>
    smartLinkText(card.attrs?.url, card.attrs?.data, details?.(card.attrs?.url)),
  );
}

/**
 * The text a description edit started from, which the server compares with Jira's text to tell someone else's edit
 * apart (DESCRIPTION_CONFLICT). A smart link reads as its URL, the one part Jira keeps as sent: how a chip reads
 * (key, title) changes with the build and with what the mirror knows, and a base must read the same on every build
 * (#2). Never change what this returns; the server also accepts the forms older builds sent (`descriptionBases`).
 */
export const descriptionBaseText = (node: unknown): string =>
  plainText(node, (card) => String(card.attrs?.url ?? ""));

/** Every form a build so far may have sent as the base of an edit of `node`: this build's, the chip text builds since
 *  BJ-199 sent, and the URL-only inline card (with empty block cards) earlier builds sent. */
export const descriptionBases = (node: unknown): string[] => [
  descriptionBaseText(node),
  adfToText(node),
  plainText(node, (card) => (card.type === "inlineCard" ? String(card.attrs?.url ?? "") : "")),
];
