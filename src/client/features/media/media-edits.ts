export type ImageCrop = { x: number; y: number; width: number; height: number };
export type ImageComment = { id: string; text: string; author: string; at: string };
/** `src` keeps a non-local image's source so its comments still show it after the image leaves the document, as in Linear. */
export type MediaEdit = { crop?: ImageCrop; comments?: ImageComment[]; src?: string };
/** Image comments with a Jira id are real Jira comments, so `comments` already counts them. */
export const jiraCommentId = (id: string) => /^\d+$/.test(id);
export function commentCount(issue: {
  comments: number;
  mediaEdits?: Record<string, MediaEdit>;
}): number {
  return (
    Math.max(0, issue.comments) +
    Object.values(issue.mediaEdits ?? {}).reduce(
      (total, edit) => total + (edit.comments?.filter((c) => !jiraCommentId(c.id)).length ?? 0),
      0,
    )
  );
}
/** Jira comments that belong to an image thread; the comment list leaves them to the thread. */
export const imageCommentIds = (edits?: Record<string, MediaEdit>) =>
  new Set(
    Object.values(edits ?? {})
      .flatMap((edit) => edit.comments ?? [])
      .map((c) => c.id),
  );
/** Stable node identity without persisting a potentially signed source URL as an edit key. */
export function externalMediaId(url: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(url)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `external-${hash.toString(16).padStart(16, "0")}`;
}
export function validCrop(value: unknown): value is ImageCrop {
  if (!value || typeof value !== "object") return false;
  const r = value as ImageCrop;
  return (
    [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
    r.x >= 0 &&
    r.y >= 0 &&
    r.width > 0 &&
    r.height > 0 &&
    r.x + r.width <= 1.000001 &&
    r.y + r.height <= 1.000001
  );
}
export function validMediaEdits(value: unknown): boolean {
  return (
    value === undefined ||
    (!!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every(
        (edit) =>
          edit &&
          typeof edit === "object" &&
          !Array.isArray(edit) &&
          (edit.crop === undefined || validCrop(edit.crop)) &&
          (edit.src === undefined || typeof edit.src === "string") &&
          (edit.comments === undefined ||
            (Array.isArray(edit.comments) &&
              edit.comments.every(
                (c: ImageComment) =>
                  c &&
                  ["id", "text", "author", "at"].every(
                    (key) => typeof c[key as keyof ImageComment] === "string",
                  ),
              ))),
      ))
  );
}
export function adjustCrop(crop: ImageCrop, handle: string, dx: number, dy: number): ImageCrop {
  let left = crop.x,
    top = crop.y,
    right = crop.x + crop.width,
    bottom = crop.y + crop.height;
  if (handle === "move") {
    left = Math.max(0, Math.min(1 - crop.width, left + dx));
    top = Math.max(0, Math.min(1 - crop.height, top + dy));
    return { ...crop, x: left, y: top };
  }
  if (handle.includes("left")) left = Math.max(0, Math.min(right - 0.01, left + dx));
  if (handle.includes("right")) right = Math.max(left + 0.01, Math.min(1, right + dx));
  if (handle.includes("top")) top = Math.max(0, Math.min(bottom - 0.01, top + dy));
  if (handle.includes("bottom")) bottom = Math.max(top + 0.01, Math.min(1, bottom + dy));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
