import type { ComponentProps, ReactNode } from "react";
import { Icon } from "@/client/components/icons";
import { Text } from "@/client/components/text";

/**
 * The frame of Linear's file block (startup-root.CnUSfl4j.js `uBe`, index.css `.file-media`): the file icon, the name
 * (regular, truncated) over its detail line (micro, labelMuted), then `children` at the row's end (the File actions
 * toolbar). A loaded file and the placeholder that waits for it share it, so the file lands without moving the text below.
 * Spans only, so it may sit inside a paragraph.
 */
export function FileBlock({
  name,
  title,
  detail,
  children,
  ...props
}: Omit<ComponentProps<"span">, "title"> & { name: ReactNode; title?: string; detail: ReactNode }) {
  return (
    <span className="file-media" data-elevation="dialog" {...props}>
      <span className="file-media-row">
        <span className="file-media-main">
          <span className="file-media-icon">
            <Icon name="file-filled" size={16} />
          </span>
          <span className="file-media-text">
            <Text variant="regular" wrap="truncate" title={title} className="file-media-name">
              {name}
            </Text>
            <Text variant="micro" color="muted" className="file-media-size">
              {detail}
            </Text>
          </span>
        </span>
        {children}
      </span>
    </span>
  );
}

/**
 * Waiting on a media node Jira gave no dimensions. Jira stores dimensions for every image and video it shows, so this is a
 * file: it holds the file block's own height, not a generic 60px box.
 */
export function FileBlockLoading() {
  return <FileBlock role="status" aria-busy name="Loading attachment…" detail={" "} />;
}
