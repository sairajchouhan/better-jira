import { Text } from "@/client/components/text";
import { NodeToolbar } from "@/client/components/node-toolbar";
import { Icon } from "@/client/components/icons";
import { showNotification } from "@/client/state/app-notifications";
import type { Attachment } from "@/shared/attachment-media";
import { attachmentLink, downloadURL, formatFileSize } from "./media-layout";

/** `ne` (copyLink) of Linear's file node: copy the file's URL, then its info toast; a refused clipboard says so. */
async function copyFileLink(file: Attachment) {
  try {
    await navigator.clipboard.writeText(attachmentLink(file, location.href));
  } catch {
    showNotification({ text: "File URL could not be copied to clipboard", detail: "Please try again" });
    return;
  }
  showNotification({ text: "File URL copied to clipboard" });
}

/**
 * Linear's file block (startup-root.CnUSfl4j.js `pBe` → `cBe` → `uBe`): every non-image, non-video file in rich text,
 * in descriptions and comments alike, block or inline. It paints in the elevated theme (`w_`), so it carries
 * `data-elevation="dialog"`: bgBase, a thinPixel bgBorderFaintThin border, shadowLow, the editor's 6px block radius.
 * The row is the file icon (labelFaint), the name (regular, truncated) over its size (micro, labelMuted), then the
 * "File actions" toolbar (`lBe.plain`: Copy link, Download), revealed on hover. Pressing the block elsewhere selects
 * its node in an editor (`onSelect`), where Backspace deletes it. Spans only, so it may sit inside a paragraph.
 */
export function FileMedia({
  file,
  issueKey,
  onSelect,
}: {
  file: Attachment;
  issueKey?: string;
  onSelect?: () => void;
}) {
  return (
    <span
      className="file-media"
      data-elevation="dialog"
      data-attachment-id={file.id}
      data-node-toolbar-host
      onMouseDown={
        onSelect &&
        ((event) => {
          if ((event.target as Element).closest(".ui-button")) return;
          event.preventDefault();
          onSelect();
        })
      }
    >
      <span className="file-media-row">
        <span className="file-media-main">
          <span className="file-media-icon">
            <Icon name="file-filled" size={16} />
          </span>
          <span className="file-media-text">
            <Text variant="regular" wrap="truncate" title={file.name} className="file-media-name">
              {file.name}
            </Text>
            <Text variant="micro" color="muted" className="file-media-size">
              {formatFileSize(file.size)}
            </Text>
          </span>
        </span>
        <NodeToolbar label="File actions" reveal="hover">
          <NodeToolbar.Button
            label="Copy link"
            icon={<Icon name="link-filled" />}
            disabled={!issueKey && file.url.startsWith("blob:")}
            disabledReason="Create the issue before copying its file link"
            onClick={() => void copyFileLink(file)}
          />
          <NodeToolbar.Link
            label="Download"
            icon={<Icon name="download-filled" />}
            href={downloadURL(file.url)}
            download={file.name}
          />
        </NodeToolbar>
      </span>
    </span>
  );
}
