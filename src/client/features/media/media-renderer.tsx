import { Button, ButtonLink } from "@/client/components/button";
import { EmptyState, LoadingState } from "@/client/components/empty-state";
import { Text } from "@/client/components/text";
import { useEffect, useMemo, useState } from "react";
import type { MediaProps } from "./media-loader";
import type { Attachment } from "@/shared/attachment-media";
import { Adf } from "@/client/features/editor/adf";
import { downloadURL, mediaContainerStyle, mediaDimensions, safeExternalImage } from "./media-layout";
import { VideoPlayer } from "./video-player";
import { FileMedia } from "./file-media";
import { ImageMedia } from "./image-media";
import { externalMediaId } from "./media-edits";

export function MediaRenderer({ node, issueKey, attachments, embedded, onSelect }: MediaProps) {
  if (node.type === "mediaSingle" || node.type === "mediaGroup") {
    const children = Array.isArray(node.content)
      ? node.content.filter((n) => n && typeof n === "object")
      : [];
    return (
      <div
        data-media-group
        data-media-layout={String(node.attrs?.layout ?? "center")}
        style={embedded ? { display: "flow-root" } : mediaContainerStyle(node)}
        className={node.type === "mediaGroup" ? "media-filmstrip" : undefined}
      >
        {children.length ? (
          children.map((child, index) =>
            child.type === "caption" ? (
              <Text
                as="div"
                key={index}
                variant="mini"
                color="muted"
                align="center"
                className="media-caption"
              >
                <Adf node={{ type: "paragraph", content: child.content }} />
              </Text>
            ) : (
              <MediaRenderer
                key={index}
                node={child}
                issueKey={issueKey}
                attachments={attachments}
                onSelect={onSelect}
              />
            ),
          )
        ) : (
          <EmptyState role="alert" title="Attachment data is unavailable" />
        )}
      </div>
    );
  }
  return (
    <MediaFile node={node} issueKey={issueKey} attachments={attachments} onSelect={onSelect} />
  );
}
function MediaFile({ node, issueKey, attachments, onSelect }: MediaProps) {
  const id = String(node.attrs?.id ?? ""),
    external = node.attrs?.type === "external";
  const externalURL = external ? safeExternalImage(node.attrs?.url) : undefined;
  useEffect(() => {
    const anchor = `attachment-${externalURL ? externalMediaId(externalURL) : id}`;
    if (location.hash === `#${anchor}`)
      requestAnimationFrame(() =>
        document.getElementById(anchor)?.scrollIntoView({ block: "center" }),
      );
  }, [id, externalURL]);
  const local = useMemo(
    () =>
      externalURL
        ? {
            id: externalMediaId(externalURL),
            url: externalURL,
            name: String(node.attrs?.alt ?? "External image"),
            type: "image/external",
            size: 0,
          }
        : attachments?.find((file) => file.id === id || file.mediaId === id),
    [externalURL, node.attrs?.alt, attachments, id],
  );
  const [attempt, retry] = useState(0);
  // A new file or a retry starts over with fresh state; a replaced mirror object with the same URL does not.
  return (
    <LoadedMedia
      key={`${issueKey}:${id}:${local?.url}:${external}:${attempt}`}
      node={node}
      issueKey={issueKey}
      onSelect={onSelect}
      local={local}
      externalURL={externalURL}
      retry={() => retry((n) => n + 1)}
    />
  );
}
function LoadedMedia({
  node,
  issueKey,
  onSelect,
  local,
  externalURL,
  retry,
}: Omit<MediaProps, "attachments" | "embedded"> & {
  local: Attachment | undefined;
  externalURL: string | undefined;
  retry: () => void;
}) {
  const id = String(node.attrs?.id ?? ""),
    inline = node.type === "mediaInline",
    external = node.attrs?.type === "external";
  const [remote, setRemote] = useState<Attachment>(),
    [error, setError] = useState(() =>
      local
        ? ""
        : external
          ? "External images require an HTTPS URL"
          : !issueKey || !id
            ? "Attachment unavailable"
            : "",
    ),
    [failed, setFailed] = useState(false),
    [intrinsic, setIntrinsic] = useState<{ width: number; height: number }>();
  useEffect(() => {
    if (local || external || !issueKey || !id) return;
    const abort = new AbortController();
    void fetch(`/api/issues/${encodeURIComponent(issueKey)}/media/${encodeURIComponent(id)}`, {
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This attachment could not be found"
              : "Could not load attachment",
          );
        const file = (await response.json()) as Attachment;
        if (!file.url?.startsWith(`/api/issues/${encodeURIComponent(issueKey)}/attachments/`))
          throw new Error("Invalid attachment source");
        setRemote(file);
      })
      .catch((reason) => {
        if (!abort.signal.aborted)
          setError(reason instanceof Error ? reason.message : "Could not load attachment");
      });
    return () => abort.abort();
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- The key remounts this for a new file or retry; mirror object replacements must not refetch.
  }, []);
  const file = local ?? remote,
    size = intrinsic ?? mediaDimensions(node),
    Wrapper = inline ? "span" : "div",
    Status = inline ? "span" : "div";
  const reserved = !inline && size ? { aspectRatio: `${size.width}/${size.height}` } : undefined;
  return (
    <Wrapper
      contentEditable={false}
      data-media-interactive
      id={`attachment-${externalURL ? externalMediaId(externalURL) : id}`}
      data-media-id={externalURL ? externalMediaId(externalURL) : id}
      className={
        inline
          ? "media-inline"
          : "media-frame relative my-3 min-w-0"
      }
      style={reserved}
      onKeyDown={(event) => {
        if (event.key !== "Tab" && !event.metaKey && !event.ctrlKey) event.stopPropagation();
      }}
    >
      {/* Recovery can be inline phrasing content; EmptyState is a block-only frame. */}
      {error || failed || file?.missing ? (
        <Status
          role="alert"
          className="media-message rounded-md border border-line-2 bg-card p-3 text-[12px] text-fg-3"
        >
          {error ||
            (file?.missing
              ? "This local file is unavailable"
              : "Could not display this attachment")}{" "}
          <Button variant="link" size="small" className="ml-2" onClick={retry}>
            Retry attachment
          </Button>
          {file && !file.missing && (
            <ButtonLink
              variant="link"
              size="small"
              className="ml-3"
              href={downloadURL(file.url)}
              download={!external ? file.name : undefined}
              target={external ? "_blank" : undefined}
              rel="noreferrer"
            >
              {external ? "Open external image" : `Download ${file.name}`}
            </ButtonLink>
          )}
        </Status>
      ) : !file ? (
        inline ? (
          // Inline media cannot contain LoadingState's block frame.
          <Text role="status" aria-busy variant="mini" color="muted">
            Loading attachment…
          </Text>
        ) : (
          <LoadingState style={!size ? { minHeight: 60 } : undefined}>
            Loading attachment…
          </LoadingState>
        )
      ) : inline ? (
        // Linear has no inline file: a Jira inline attachment is the same file block, on its own line in the paragraph.
        <FileMedia file={file} issueKey={issueKey} onSelect={onSelect} />
      ) : file.type.startsWith("video/") ? (
        <VideoPlayer key={file.url} file={file} onSize={setIntrinsic} onSelect={onSelect} />
      ) : external || /^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(file.type) ? (
        <ImageMedia
          key={file.url}
          file={file}
          external={external}
          issueKey={issueKey}
          onSelect={onSelect}
          onSize={setIntrinsic}
          onError={() => setFailed(true)}
        />
      ) : file.type.startsWith("audio/") ? (
        <audio
          key={file.url}
          data-attachment-id={file.id}
          aria-label={file.name}
          src={file.url}
          controls
          preload="metadata"
          className="w-full"
          onError={() => setFailed(true)}
        />
      ) : (
        <FileMedia file={file} issueKey={issueKey} onSelect={onSelect} />
      )}
    </Wrapper>
  );
}
