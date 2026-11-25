import { Icon } from "@/client/components/icons";
import type { IssueResource } from "@/shared/issue-resource";
import type { User } from "@/shared/issue-model";

/** The icons a document can take (its page's icon picker), the first its default. */
export const DOCUMENT_ICONS = ["file", "layers", "list", "board", "calendar", "comment", "link", "pencil", "star", "check"] as const;
/** A document's colour before one is picked. */
export const DOCUMENT_ICON_COLOR = "#8b8b91";

export const documentIconName = (resource: Pick<IssueResource, "icon">) =>
  DOCUMENT_ICONS.find((name) => name === resource.icon?.name) ?? "file";

/** Who last edited a document, as far as we know: its last editor, else its owner. */
export const documentEditor = (resource: Pick<IssueResource, "editedBy" | "owner">): User | undefined =>
  resource.editedBy ?? resource.owner;

/**
 * A document's own icon (Linear's document icon, `ej`/`tj`): its picked icon or emoji in its picked colour. The one read-only glyph
 * for a document wherever it is listed (a sidebar favorite, its hover card, a resource row, ⌘K); its page draws the same glyph as
 * the button that opens the picker.
 */
export function DocumentGlyph({ resource, size = 16 }: { resource: Pick<IssueResource, "icon">; size?: number }) {
  const emoji = resource.icon?.name.startsWith("emoji:") ? resource.icon.name.slice(6) : null;
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center leading-none"
      style={{ color: resource.icon?.color ?? DOCUMENT_ICON_COLOR, width: size, height: size, fontSize: emoji ? size : undefined }}
      data-document-glyph={emoji ?? documentIconName(resource)}
    >
      {emoji ?? <Icon name={documentIconName(resource)} size={size} />}
    </span>
  );
}
