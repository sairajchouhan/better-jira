import type { CSSProperties } from "react";
import type { AdfNode } from "./document";
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
