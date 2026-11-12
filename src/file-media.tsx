import { Text } from "./text";
import { IconButton } from "./button";
import "./media-primitives.css";
import { notifyMedia } from "./media-toast";
import { Icon } from "./icons";
import type { Attachment } from "./attachment-media";
import { attachmentLink } from "./media-layout";
export function FileMedia({ file, issueKey }: { file: Attachment; issueKey?: string }) {
  const size =
    file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${Math.round(file.size / 1024)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="file-media" data-attachment-id={file.id} tabIndex={0}>
      <Icon name="file" size={20} />
      <div className="min-w-0 flex-1">
        <div className="truncate">{file.name}</div>
        <Text as="div" variant="micro" color="muted">
          {size}
        </Text>
      </div>
      <div className="file-media-actions" role="toolbar" aria-label="File actions">
        <IconButton
          label="Copy attachment link"
          disabled={!issueKey && file.url.startsWith("blob:")}
          disabledReason="Create the issue before copying its attachment link"
          onClick={() => {
            void navigator.clipboard
              .writeText(attachmentLink(file, location.href))
              .then(() => notifyMedia("Link copied"))
              .catch(() => notifyMedia("Could not copy link"));
          }}
        >
          <Icon name="link" />
        </IconButton>
        {/* Icon-only, so not ButtonLink yet: it lacks Linear's `fk` onlyIcon shape (Ist.onlyIcon, padding-inline 2px). */}
        <a
          aria-label={`Download ${file.name}`}
          href={file.url.startsWith("/api/") ? `${file.url}?download=1` : file.url}
          download={file.name}
        >
          <Icon name="download" />
        </a>
      </div>
    </div>
  );
}
