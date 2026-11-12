import { Button, IconButton } from "./button";
import "./media-primitives.css";
import { useEffect, useRef, useState } from "react";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { adjustCrop, type ImageCrop } from "./media-edits";
import type { Attachment } from "./attachment-media";
import { Icon } from "./icons";
const full: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };
const handles = [
  "top left",
  "top",
  "top right",
  "right",
  "bottom right",
  "bottom",
  "bottom left",
  "left",
];
export function ImageCropEditor({
  file,
  initial,
  save,
  cancel,
}: {
  file: Attachment;
  initial?: ImageCrop;
  save: (crop: ImageCrop) => void | Promise<void>;
  cancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    stage = useRef<HTMLDivElement>(null),
    drag = useRef<{ crop: ImageCrop; handle: string; x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[aria-label^="Crop selection"]')?.focus();
  }, []);
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [crop, setCrop] = useState(initial ?? full),
    [size, setSize] = useState({ width: 640, height: 360 });
  useHotkeys(
    [
      {
        hotkey: "Escape",
        callback: () => {
          if (!saving) cancel();
        },
      },
      ...(["Tab", "Shift+Tab"] as const).map((hotkey) => ({
        hotkey,
        callback: () => {
          const items = [
            ...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]'),
          ];
          const i = items.indexOf(document.activeElement as HTMLElement),
            step = hotkey === "Tab" ? 1 : -1;
          items[
            i < 0 ? (step < 0 ? items.length - 1 : 0) : (i + step + items.length) % items.length
          ]?.focus();
        },
      })),
      ...(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"] as const).flatMap((key) =>
        [key, `Shift+${key}`].map((hotkey) => ({
          hotkey,
          callback: (event: KeyboardEvent) => {
            if (saving) return;
            const handle = (event.target as HTMLElement).dataset.cropHandle ?? "move",
              step = event.shiftKey ? 10 : 1;
            setCrop((c) =>
              adjustCrop(
                c,
                handle,
                (key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0) / size.width,
                (key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0) / size.height,
              ),
            );
          },
        })),
      ),
    ] as UseHotkeyDefinition[],
    { target: root, capture: true, ignoreInputs: false },
  );
  // Crop selection and handles require the media shell and its spatial keyboard model.
  return (
    <div
      ref={root}
      className="image-crop-editor"
      data-media-interactive
      onKeyDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="Crop image"
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="image-crop-actions">
        {initial && (
          <Button variant="secondary" size="medium" disabled={saving} onClick={() => setCrop(full)}>
            Reset crop
          </Button>
        )}
        <Button variant="secondary" size="medium" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
        <Button
          size="medium"
          disabled={saving || JSON.stringify(crop) === JSON.stringify(initial ?? full)}
          onClick={() => {
            root.current?.focus();
            setSaving(true);
            setError("");
            void Promise.resolve(save(crop))
              .catch(() =>
                setError("Could not crop this image. Its source may not allow image editing."),
              )
              .finally(() => setSaving(false));
          }}
        >
          Save
        </Button>
        <IconButton label="Close" disabled={saving} onClick={cancel}>
          <Icon name="close" size={16} />
        </IconButton>
      </div>
      {error && (
        <p role="alert" className="image-preview-notice">
          {error}
        </p>
      )}
      <div
        ref={stage}
        className="image-crop-stage"
        style={{
          width: `min(${size.width}px, calc(100vw - 64px), calc((100vh - 100px) * ${size.width / size.height}))`,
          aspectRatio: `${size.width}/${size.height}`,
        }}
        onPointerMove={(event) => {
          if (drag.current) {
            const r = stage.current!.getBoundingClientRect(),
              d = drag.current;
            setCrop(
              adjustCrop(
                d.crop,
                d.handle,
                (event.clientX - d.x) / r.width,
                (event.clientY - d.y) / r.height,
              ),
            );
          }
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        <img
          src={file.url}
          alt={file.name}
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
        />
        <div
          aria-label="Crop selection. Use arrow keys to move it."
          tabIndex={0}
          className="image-crop-selection"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.width * 100}%`,
            height: `${crop.height * 100}%`,
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const handle = (event.target as HTMLElement).dataset.cropHandle ?? "move";
            (event.target as HTMLElement).focus();
            drag.current = { crop, handle, x: event.clientX, y: event.clientY };
            stage.current?.setPointerCapture(event.pointerId);
          }}
        >
          {handles.map((handle) => (
            <button
              key={handle}
              data-crop-handle={handle}
              aria-label={`Resize from ${handle}`}
              style={{
                left: handle.includes("left") ? "0" : handle.includes("right") ? "100%" : "50%",
                top: handle.includes("top") ? "0" : handle.includes("bottom") ? "100%" : "50%",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
