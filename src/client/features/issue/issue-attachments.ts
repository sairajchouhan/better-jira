import { resourceMediaIds } from "@/shared/issue-resource";
import type { Issue } from "@/client/state/store";

type Attachments = NonNullable<Issue["attachments"]>;
type Fields = { description?: unknown; comment?: { comments?: { body?: unknown }[] } };

/**
 * An issue's attachments split in two: `embedded` ones the description, a comment or a document already shows inline,
 * and `visible` ones the attachment list shows. Media is matched by attachment id or Jira media id.
 */
export function attachmentSplit(
  issue: Pick<Issue, "attachments" | "resources">,
  fields: Fields | undefined,
): { visible: Attachments; embedded: Attachments } {
  // Documents read through their bodies and revisions; ADF reads through `content` only.
  const ids = new Set<string>();
  for (const resource of issue.resources ?? []) resourceMediaIds(resource, ids);
  resourceMediaIds(fields?.description, ids);
  for (const comment of fields?.comment?.comments ?? []) resourceMediaIds(comment.body, ids);
  const shown = (a: Attachments[number]) => ids.has(a.id) || ids.has(a.mediaId ?? "");
  const all = issue.attachments ?? [];
  return { visible: all.filter((a) => !shown(a)), embedded: all.filter(shown) };
}

/**
 * Media ids anywhere in a stored value, read through every key and array, not just `content`: drafts wrap their
 * documents (`{ doc, base }`, `{ title, body }`), and a caller listing several documents passes an array. A media node
 * under a key ADF doesn't nest content in (`attrs`, `marks`) counts here but not in `attachmentSplit`.
 */
export function storedMediaIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return ids;
  if (Array.isArray(value)) {
    for (const v of value) storedMediaIds(v, ids);
    return ids;
  }
  const node = value as Record<string, any>;
  if (["media", "mediaInline"].includes(node.type) && node.attrs?.id)
    ids.add(String(node.attrs.id));
  for (const child of Object.values(node)) storedMediaIds(child, ids);
  return ids;
}
