import { Button, IconButton } from "./button";
import { notifyMedia } from "./media-toast";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import type { Attachment } from "./attachment-media";
import { copyMediaImage } from "./image-media";
import { Icon } from "./icons";
import { ImageCropEditor } from "./image-crop";
import type { ImageCrop } from "./media-edits";
import { attachmentLink } from "./media-layout";
export function ImageViewer({
  file,
  original,
  crop,
  startCrop,
  onCrop,
  external,
  editable,
  readReason,
  issueKey,
  close,
}: {
  issueKey?: string;
  editable: boolean;
  readReason: string;
  original: Attachment;
  crop?: ImageCrop;
  startCrop?: boolean;
  onCrop?: (crop: ImageCrop) => void | Promise<void>;
  file: Attachment;
  external: boolean;
  close: () => void;
}) {
  const [cropping, setCropping] = useState(!!startCrop);
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; px: number; py: number } | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 }),
    [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight }),
    [zoomed, setZoomed] = useState(false),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    // A failure belongs to the URL that failed, so a new image URL shows again without a reset.
    [failedURL, setFailedURL] = useState<string>(),
    failed = failedURL === file.url;
  const fit = size.width
      ? Math.min(
          (viewport.width - 16) / (2 * size.width),
          (viewport.height - 80) / (2 * size.height),
        )
      : 1,
    scale = fit * (zoomed ? 2 : 1);
  const move = (x: number, y: number) => {
    const mx = Math.max(32, (size.width * scale - viewport.width) / 2),
      my = Math.max(32, (size.height * scale - viewport.height + 44) / 2);
    setPan({ x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) });
  };
  const zoom = () => {
    setZoomed((value) => !value);
    setPan({ x: 0, y: 0 });
  };
  const escape = () => {
    if (cropping) {
      setCropping(false);
      return;
    }
    if (zoomed) {
      setZoomed(false);
      setPan({ x: 0, y: 0 });
    } else close();
  };
  useHotkeys(
    [
      { hotkey: "Escape", callback: escape },
      {
        hotkey: "Mod+K",
        callback: close,
        options: { preventDefault: false, stopPropagation: false },
      },
      {
        hotkey: "Mod+/",
        callback: close,
        options: { preventDefault: false, stopPropagation: false },
      },
      ...(["Tab", "Shift+Tab"] as const).map((hotkey) => ({
        hotkey,
        callback: () => {
          const elements = [
            ...root.current!.querySelectorAll<HTMLElement>("button:not(:disabled),a[href]"),
          ];
          const i = elements.indexOf(document.activeElement as HTMLElement),
            step = hotkey === "Tab" ? 1 : -1;
          elements[
            i < 0
              ? step < 0
                ? elements.length - 1
                : 0
              : (i + step + elements.length) % elements.length
          ]?.focus();
        },
      })),
    ] as UseHotkeyDefinition[],
    { target: root, capture: true, ignoreInputs: false },
  );
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    const resize = () => setViewport({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("resize", resize);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Crop mode replaces the measured image element.
  }, [cropping]);
  if (cropping && onCrop)
    return createPortal(
      <ImageCropEditor
        file={original}
        initial={crop}
        save={async (value) => {
          await onCrop(value);
          setCropping(false);
        }}
        cancel={() => setCropping(false)}
      />,
      document.body,
    );
  // Linear media preview (PBe) owns a full-window shell with staged Escape, zoom and pan.
  return createPortal(
    <div
      ref={root}
      data-media-interactive
      role="dialog"
      aria-modal="true"
      aria-label="Preview"
      tabIndex={-1}
      className="image-preview"
      onKeyDown={(event) => {
        if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
      }}
    >
      <div className="image-preview-toolbar">
        <Button variant="borderless" size="medium" aria-label="Toggle image zoom" onClick={zoom}>
          {Math.round(scale * 100)}%
        </Button>
        <div className="image-preview-tools">
          {onCrop && (
            <IconButton label="Crop image" onClick={() => setCropping(true)}>
              <Icon name="crop" size={16} />
            </IconButton>
          )}
          {/* Icon-only, so not ButtonLink yet: it lacks Linear's `fk` onlyIcon shape (Ist.onlyIcon, padding-inline 2px). */}
          <a
            aria-label="Download image"
            href={file.url.startsWith("/api/") ? `${file.url}?download=1` : file.url}
            download={
              file.url !== original.url
                ? file.name.replace(/\.[^.]+$/, "") + ".png"
                : !external
                  ? file.name
                  : undefined
            }
            target={external && file.url === original.url ? "_blank" : undefined}
            rel="noreferrer"
          >
            <Icon name="download" size={16} />
          </a>
          <IconButton
            label="Copy image"
            disabled={!editable}
            disabledReason={readReason}
            onClick={() => {
              void copyMediaImage(file.url)
                .then(() => notifyMedia("Image copied"))
                .catch(() => notifyMedia("Could not copy this image. Download it instead."));
            }}
          >
            <Icon name="copy" size={16} />
          </IconButton>
          <IconButton
            label="Copy link"
            disabled={!issueKey && original.url.startsWith("blob:")}
            disabledReason="Create the issue before copying its attachment link"
            onClick={() => {
              void navigator.clipboard
                .writeText(attachmentLink(original, location.href))
                .then(() => notifyMedia("Link copied"))
                .catch(() => notifyMedia("Could not copy the image link"));
            }}
          >
            <Icon name="link" size={16} />
          </IconButton>
          <IconButton label="Close" onClick={close}>
            <Icon name="close" size={18} />
          </IconButton>
        </div>
      </div>
      <div
        className="image-preview-stage"
        onWheel={(event) => {
          if (zoomed) move(pan.x - event.deltaX, pan.y - event.deltaY);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          root.current?.focus();
          if (zoomed) {
            drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          if (drag.current)
            move(
              drag.current.px + event.clientX - drag.current.x,
              drag.current.py + event.clientY - drag.current.y,
            );
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        {failed ? (
          <p role="alert">
            Could not display this image.{" "}
            <a href={file.url} target="_blank" rel="noreferrer">
              Open image
            </a>
          </p>
        ) : (
          <img
            alt={file.name}
            src={file.url}
            referrerPolicy="no-referrer"
            draggable={false}
            onLoad={(event) =>
              setSize({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
            onError={() => setFailedURL(file.url)}
            style={{
              width: size.width ? size.width * scale : undefined,
              height: size.height ? size.height * scale : undefined,
              transform: `translate(${pan.x}px,${pan.y}px)`,
            }}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
