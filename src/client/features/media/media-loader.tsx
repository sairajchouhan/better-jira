import { LoadingState } from "@/client/components/empty-state";
import { Text } from "@/client/components/text";
import { FileBlockLoading } from "./file-block";
import { lazy, Suspense, useState } from "react";
import type { AdfNode } from "@/shared/document";
import type { Attachment } from "@/shared/attachment-media";
import { mediaContainerStyle, mediaDimensions } from "./media-layout";
let loaded: typeof import("./media-renderer").MediaRenderer | undefined;
const load = () =>
  import("./media-renderer").then((m) => ({ default: (loaded = m.MediaRenderer) }));
const Renderer = lazy(load);
// Fetched once the page is idle, like the editor, so media renders without "Loading attachment…" once it is in.
if (typeof window !== "undefined")
  (window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(() => void load());
export type MediaProps = {
  node: AdfNode;
  issueKey?: string;
  attachments?: Attachment[];
  embedded?: boolean;
  onSelect?: () => void;
};
function LoadingMedia({ node, embedded }: MediaProps) {
  if (node.type === "mediaSingle" || node.type === "mediaGroup")
    return (
      <div
        style={embedded ? { display: "flow-root" } : mediaContainerStyle(node)}
        className={node.type === "mediaGroup" ? "media-filmstrip" : undefined}
      >
        {(Array.isArray(node.content) ? node.content : [])
          .filter((n) => n && typeof n === "object")
          .map((child, index) =>
            child.type === "caption" ? (
              <Text as="div" key={index} variant="mini" color="muted" align="center">
                {child.content?.map((n) => n.text ?? "").join("")}
              </Text>
            ) : (
              <LoadingMedia key={index} node={child} />
            ),
          )}
      </div>
    );
  const inline = node.type === "mediaInline",
    Wrapper = inline ? "span" : "div",
    size = mediaDimensions(node);
  return (
    <Wrapper
      data-media-loading
      className={inline ? "inline-flex" : "media-frame my-3"}
      style={!inline && size ? { aspectRatio: `${size.width}/${size.height}` } : undefined}
    >
      {inline ? (
        // LoadingState is a block frame; inline atoms must retain phrasing content.
        <Text role="status" aria-busy variant="mini" color="muted">
          Loading attachment…
        </Text>
      ) : (
        size ? <LoadingState>Loading attachment…</LoadingState> : <FileBlockLoading />
      )}
    </Wrapper>
  );
}
export function MediaView(props: MediaProps) {
  // A loaded renderer mounts directly; chosen once, so a later load never remounts the media.
  const [Component] = useState(() => loaded ?? Renderer);
  return (
    <Suspense fallback={<LoadingMedia {...props} />}>
      <Component {...props} />
    </Suspense>
  );
}
