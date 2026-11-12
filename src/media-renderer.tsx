import { useEffect, useMemo, useState } from "react";
import type { MediaProps } from "./media-loader";
import type { Attachment } from "./attachment-media";
import { Adf } from "./adf";
import { mediaContainerStyle, mediaDimensions, safeExternalImage } from "./media-layout";
import { VideoPlayer } from "./video-player";
import { FileMedia } from "./file-media";
import { ImageMedia } from "./image-media";
import { externalMediaId } from "./media-edits";
const downloadURL = (url: string) => (url.startsWith("/api/") ? `${url}?download=1` : url);

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
              <div key={index} className="media-caption text-center text-[12px] text-fg-3">
                <Adf node={{ type: "paragraph", content: child.content }} />
              </div>
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
          <p role="alert" className="text-[12px] text-fg-3">
            Attachment data is unavailable
          </p>
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
  }, [id, issueKey, externalURL]);
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
          ? "media-inline inline-flex max-w-full align-middle text-[12px]"
          : "media-frame relative my-3 min-w-0"
      }
      style={reserved}
      onKeyDown={(event) => {
        if (event.key !== "Tab" && !event.metaKey && !event.ctrlKey) event.stopPropagation();
      }}
    >
      {error || failed || file?.missing ? (
        <Status
          role="alert"
          className="media-message rounded-md border border-line-2 bg-card p-3 text-[12px] text-fg-3"
        >
          {error ||
            (file?.missing
              ? "This local file is unavailable"
              : "Could not display this attachment")}{" "}
          <button className="ml-2 text-fg-2 hover:text-fg" onClick={retry}>
            Retry attachment
          </button>
          {file && !file.missing && (
            <a
              className="ml-3 text-accent"
              href={downloadURL(file.url)}
              download={!external ? file.name : undefined}
              target={external ? "_blank" : undefined}
              rel="noreferrer"
            >
              {external ? "Open external image" : `Download ${file.name}`}
            </a>
          )}
        </Status>
      ) : !file ? (
        <Status
          style={!size && !inline ? { minHeight: 60 } : undefined}
          role="status"
          className="media-message rounded-md border border-line-2 bg-card px-3 py-2 text-[13px] text-fg-3"
        >
          Loading attachment…
        </Status>
      ) : inline ? (
        <a
          data-attachment-id={file.id}
          href={downloadURL(file.url)}
          download={!external ? file.name : undefined}
          className="inline-flex max-w-full items-center rounded border border-line-2 bg-card px-1.5 text-fg-2 hover:bg-hover"
        >
          <span className="truncate">{file.name}</span>
        </a>
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
        <FileMedia file={file} issueKey={issueKey} />
      )}
    </Wrapper>
  );
}
