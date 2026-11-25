import { IconButton } from "@/client/components/button";
import { Toolbar } from "@/client/components/toolbar";
import { notifyMedia } from "./media-toast";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useHotkeys } from "@tanstack/react-hotkeys";
import type { Attachment } from "@/shared/attachment-media";
import { Icon } from "@/client/components/icons";
import { ME, useStore } from "@/client/state/store";
import { actions, saveCrop } from "@/client/state/issue-actions";
import { ImageThread, type ImageThreadDraft } from "./image-thread";
// In the same chunk, as Linear's preview (PBe) is in its startup bundle: a lazy one suspends, and React holds a suspended
// tree's fallback for its 300ms throttle before the preview can show (BJ-233).
import { ImageViewer } from "./image-viewer";
import { copyMediaImage, cropImage, croppedFile, imageBlob } from "./image-blob";

export function ImageMedia({
  file,
  external,
  issueKey,
  onSize,
  onError,
  onSelect,
}: {
  onSelect?: () => void;
  issueKey?: string;
  file: Attachment;
  external: boolean;
  onSize: (size: { width: number; height: number }) => void;
  onError: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    commentTrigger = useRef<HTMLButtonElement>(null),
    readProbe = useRef<AbortController | undefined>(undefined);
  const [readAccess, setReadAccess] = useState(external ? "unknown" : "allowed");
  useEffect(() => () => readProbe.current?.abort(), []);
  const checkReadAccess = () => {
    if (!external || readProbe.current) return;
    const controller = new AbortController();
    readProbe.current = controller;
    setReadAccess("checking");
    const timer = setTimeout(() => controller.abort(), 5000);
    void imageBlob(file.url, controller.signal)
      .then(() => setReadAccess("allowed"))
      .catch(() => {
        if (root.current) setReadAccess("denied");
      })
      .finally(() => clearTimeout(timer));
  };
  const editable = readAccess === "allowed",
    readReason =
      readAccess === "checking"
        ? "Checking image editing access…"
        : "This external source cannot be read for copying or cropping.";
  const id = file.mediaId ?? file.id,
    edit = useStore((state) => state.issues.get(issueKey ?? "")?.mediaEdits?.[id]);
  const [displayURL, setDisplayURL] = useState(file.url),
    [mode, setMode] = useState<"preview" | "crop">("preview"),
    [thread, setThread] = useState(false),
    [threadDraft, setThreadDraft] = useState<ImageThreadDraft>({ text: "" });
  const displayFile = { ...file, url: displayURL };
  useEffect(() => {
    let live = true,
      url: string | undefined;
    setDisplayURL(file.url);
    if (edit?.crop)
      void cropImage(file.url, edit.crop)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          if (live) setDisplayURL(url);
          else URL.revokeObjectURL(url);
        })
        .catch(() => notifyMedia("Could not load the cropped image"));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Crop values, rather than mirror object identity, control expensive image decoding.
  }, [file.url, JSON.stringify(edit?.crop)]);
  const [selected, setSelected] = useState(false),
    [open, setOpen] = useState(false);
  const previousThread = useRef(false);
  useLayoutEffect(() => {
    if (previousThread.current && !thread) commentTrigger.current?.focus();
    previousThread.current = thread;
  }, [thread]);
  useEffect(() => {
    const frame = root.current?.closest("[data-media-id]");
    const show = () => {
      setThread(true);
      setSelected(true);
      requestAnimationFrame(() => root.current?.querySelector("textarea")?.focus());
    };
    frame?.addEventListener("show-image-comments", show);
    return () => frame?.removeEventListener("show-image-comments", show);
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!open && !root.current?.contains(event.target as Node)) setSelected(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const owned = () =>
    !root.current?.querySelector("textarea:focus,input:focus,select:focus") &&
    selected &&
    (root.current?.contains(document.activeElement) ||
      (!!root.current?.closest(".ProseMirror-selectednode") &&
        document.activeElement === root.current.closest(".rich-content")));
  return (
    <div
      ref={root}
      className="image-media"
      data-image-selected={selected}
      onPointerEnter={checkReadAccess}
      onFocus={checkReadAccess}
    >
      {/* Only the selected image listens, so F and Space are registered once, not once per image. */}
      {selected && !open && (
        <PreviewKeys
          open={() => {
            if (!owned()) return false;
            setMode("preview");
            setOpen(true);
            return true;
          }}
        />
      )}
      <img
        data-attachment-id={file.id}
        alt={file.name}
        src={displayURL}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="media-visual block w-full rounded-md"
        onMouseDown={(event) => {
          if (onSelect) {
            event.preventDefault();
            onSelect();
          }
        }}
        onClick={() => setSelected(true)}
        onDoubleClick={() => {
          setMode("preview");
          setOpen(true);
        }}
        onLoad={(event) =>
          onSize({
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          })
        }
        onError={onError}
      />
      <Toolbar label="Image actions" className="image-actions">
        <IconButton
          label="Copy image"
          disabled={!editable}
          disabledReason={readReason}
          onClick={() => {
            void copyMediaImage(displayURL)
              .then(() => notifyMedia("Image copied"))
              .catch(() => notifyMedia("Could not copy this image. Download it instead."));
          }}
        >
          <Icon name="copy" />
        </IconButton>
        {issueKey && (
          <IconButton
            label="Crop image"
            disabled={!editable}
            disabledReason={readReason}
            onClick={() => {
              setMode("crop");
              setOpen(true);
            }}
          >
            <Icon name="crop" />
          </IconButton>
        )}
        <IconButton
          ref={trigger}
          label="Full screen"
          onClick={() => {
            setMode("preview");
            setOpen(true);
          }}
        >
          <Icon name="expand" />
        </IconButton>
        {issueKey && (
          <IconButton
            ref={commentTrigger}
            label={thread ? "Hide image comments" : "Add image comment"}
            onClick={() => {
              setSelected(true);
              setThread((value) => !value);
            }}
          >
            <Icon name="comment" />
          </IconButton>
        )}
      </Toolbar>
      {thread && issueKey && (
        <ImageThread
          draft={threadDraft}
          setDraft={setThreadDraft}
          comments={edit?.comments ?? []}
          author={ME.name}
          save={(comments) =>
            actions.mediaEdit(issueKey, id, {
              ...edit,
              comments,
              ...(file.url.startsWith("blob:") ? {} : { src: file.url }),
            })
          }
          close={() => {
            setSelected(true);
            setThread(false);
          }}
        />
      )}
      {open && (
        <ImageViewer
          issueKey={issueKey}
          editable={editable}
          readReason={readReason}
          file={displayFile}
          original={file}
          crop={edit?.crop}
          startCrop={mode === "crop"}
          onCrop={
            issueKey && editable
              ? async (crop) => {
                  await saveCrop(issueKey, id, crop, croppedFile(await cropImage(file.url, crop), file.name));
                }
              : undefined
          }
          external={external}
          close={() => {
            setSelected(true);
            setOpen(false);
            requestAnimationFrame(() => {
              if (!document.querySelector(".menu-input input")) trigger.current?.focus();
            });
          }}
        />
      )}
    </div>
  );
}

function PreviewKeys({ open }: { open: () => boolean }) {
  useHotkeys(
    (["F", "Space"] as const).map((hotkey) => ({
      hotkey,
      callback: (event: KeyboardEvent) => {
        if (open()) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    })),
    // The board's own F and Space stay registered: this capture-phase handler runs first and acts only for the selected image.
    {
      capture: true,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
      conflictBehavior: "allow",
    },
  );
  return null;
}
