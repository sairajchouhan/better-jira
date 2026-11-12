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

/** Plain text of ADF: what a reader sees, without formatting or media. */
export function adfToText(node: any, details?: (url: string) => SmartLinkDetails | undefined): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text;
  if (node.type === "hardBreak") return "\n";
  if (node.attrs?.text) return node.attrs.text;
  if (["inlineCard", "blockCard", "embedCard"].includes(node.type))
    return smartLinkText(node.attrs?.url, node.attrs?.data, details?.(node.attrs?.url));
  const kids: string[] = (node.content ?? []).map((child: any) => adfToText(child, details));
  if (node.type === "doc") return kids.join("\n\n");
  if (node.type === "bulletList" || node.type === "orderedList")
    return kids.map((k) => `- ${k}`).join("\n");
  return kids.join(node.type === "listItem" ? "\n" : "");
}
