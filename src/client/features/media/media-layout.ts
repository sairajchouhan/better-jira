export function downloadURL(url: string): string {
  return url.startsWith("/api/") ? `${url}${url.includes("?") ? "&" : "?"}download=1` : url;
}

import type { CSSProperties } from "react";
import type { AdfNode } from "@/shared/document";
import type { Attachment } from "@/shared/attachment-media";
export function mediaDimensions(node: AdfNode): { width: number; height: number } | undefined {
  const width = Number(node.attrs?.width),
    height = Number(node.attrs?.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
    return { width, height };
  for (const child of Array.isArray(node.content) ? node.content : []) {
    if (child && typeof child === "object") {
      const size = mediaDimensions(child);
      if (size) return size;
    }
  }
}
export function mediaContainerStyle(node: AdfNode): CSSProperties {
  if (node.type === "mediaInline")
    return { display: "inline-flex", verticalAlign: "middle", maxWidth: "100%", cursor: "default" };
  const style: CSSProperties = { display: "flow-root", maxWidth: "100%", cursor: "default" };
  if (node.type !== "mediaSingle") return style;
  const attrs = node.attrs ?? {},
    width = Number(attrs.width),
    layout = String(attrs.layout ?? "center");
  const natural = mediaDimensions(node);
  style.width =
    Number.isFinite(width) && width > 0
      ? `${attrs.widthType === "pixel" ? width : Math.min(width, 100)}${attrs.widthType === "pixel" ? "px" : "%"}`
      : natural
        ? `${natural.width}px`
        : "100%";
  if (layout === "wrap-left" || layout === "wrap-right") {
    style.float = layout === "wrap-left" ? "left" : "right";
    style.marginInline = layout === "wrap-left" ? "0 16px" : "16px 0";
  } else if (layout === "align-start") style.marginInline = "0 auto";
  else if (layout === "align-end") style.marginInline = "auto 0";
  else if (layout === "wide" || layout === "full-width") {
    const bleed = layout === "wide" ? 16 : 32;
    style.width = `calc(100% + ${bleed * 2}px)`;
    style.maxWidth = `min(calc(100% + ${bleed * 2}px), calc(100vw - 24px))`;
    style.marginInline = `-${bleed}px`;
  } else style.marginInline = "auto";
  return style;
}
/** The width, as Jira's percentage of the column (10–100), that dragging a resize handle `dx` pixels gives an image `start`
 * pixels wide. A centred image grows on both sides, so it grows twice the drag. */
export function dragWidth(
  start: number,
  dx: number,
  side: "left" | "right",
  layout: unknown,
  column: number,
): number {
  const centred = !["align-start", "align-end", "wrap-left", "wrap-right"].includes(String(layout ?? "center"));
  const grow = (side === "right" ? dx : -dx) * (centred ? 2 : 1);
  return Math.max(10, Math.min(100, Math.round(((start + grow) / Math.max(1, column)) * 100)));
}
/** The image types rich text shows as an image; any other file is a file block. */
export const isShownImage = (type: string) => /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(type);
/**
 * Whether a mediaSingle gets width handles: an image or a video does, a file block never does (Linear's `file` node has
 * only href, name, size and mimetype; no width). The file's type comes from the issue's attachments; one not listed is
 * an image when Jira gave it dimensions, as Jira does for every image it stores.
 */
export function resizableMedia(node: AdfNode, attachments: Attachment[] | undefined): boolean {
  if (node.type !== "mediaSingle") return false;
  const media = (Array.isArray(node.content) ? node.content : []).find((child) => child?.type === "media");
  if (!media) return false;
  if (media.attrs?.type === "external") return true;
  const id = String(media.attrs?.id ?? ""),
    file = attachments?.find((a) => a.id === id || a.mediaId === id);
  return file ? isShownImage(file.type) || file.type.startsWith("video/") : !!mediaDimensions(media);
}
/** A mediaSingle at `width` percent, as Jira stores a resized image; a wide or full-width one becomes centred. */
export function resizedMedia(node: AdfNode, width: number): AdfNode {
  const { widthType: _type, ...attrs } = node.attrs ?? {};
  return {
    ...node,
    attrs: {
      ...attrs,
      layout: ["wide", "full-width"].includes(String(attrs.layout)) ? "center" : (attrs.layout ?? "center"),
      width,
    },
  };
}
export function safeExternalImage(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password) return url.href;
  } catch {}
}
export function attachmentLink(file: { id: string; url: string }, base: string): string {
  const url = new URL(file.url.startsWith("blob:") ? base : file.url, base);
  if (file.url.startsWith("blob:")) url.hash = `attachment-${file.id}`;
  return url.href;
}

/**
 * Linear's file size (startup-entry.Dt5YDWdY.js `pL`): the largest of B, KB, MB, GB (1024 apart) the size reaches, at
 * most two fraction digits in the reader's locale; a size that is not a number is "Unknown size" (`uBe`).
 */
export function formatFileSize(bytes: number, locale?: string): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "Unknown size";
  const size = Math.abs(bytes);
  const [unit, scale] =
    size >= 1073741824 ? ["GB", 1073741824] : size >= 1048576 ? ["MB", 1048576] : size >= 1024 ? ["KB", 1024] : ["B", 1];
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bytes / scale)} ${unit}`;
}
