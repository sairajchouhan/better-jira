import type { ComponentProps, ReactNode, Ref } from "react";
import { Button, IconButton, SendButton } from "@/client/components/button";
import { Icon } from "@/client/components/icons";
import { Shortcut } from "@/client/components/keycap";
import type { EditorPresentation, RichEditorProps } from "./rich-editor";

// Presentation policy stays private to the editor and its stand-in. Callers compose a named editor variant.
export const presentations = {
  framed: { inline: false, selectionToolbar: false, variant: undefined },
  inline: { inline: true, selectionToolbar: false, variant: undefined },
  document: { inline: true, selectionToolbar: true, variant: undefined },
  /** The create modal's description (Linear's fast-create editor, size regular): no box, formatting over a selection, and
   *  Escape left to the modal, which offers to save a draft. */
  composer: { inline: true, selectionToolbar: true, variant: "composer" },
  comment: { inline: false, selectionToolbar: false, variant: "comment" },
  /** A comment edited in place (Linear's EditComment form, `Cr`): the text where it was, no box, formatting over a
   *  selection, and below it the paperclip, then Cancel and Save. */
  edit: { inline: true, selectionToolbar: true, variant: "edit" },
} as const;

/** The editor's box. The editor and the loader's stand-in both draw it (with an `EditorArea` and `EditorActions` inside),
 *  so the editor takes over without moving anything (BJ-198). */
export function EditorFrame({
  presentation,
  expanded,
  children,
  ...rest
}: ComponentProps<"div"> & { presentation: EditorPresentation; expanded?: boolean }) {
  const { inline, variant } = presentations[presentation];
  return (
    <div
      {...rest}
      className={`rich-editor group/editor relative ${inline ? "" : "mb-3 rounded-lg border border-line-2 bg-card"}`}
      data-variant={variant}
      data-inline={inline || undefined}
      data-expanded={expanded || undefined}
    >
      {children}
    </div>
  );
}

/** The frame's text area: the content element, with the placeholder over it while it is empty. */
export function EditorArea({ placeholder, children, ref }: { placeholder?: ReactNode; children: ReactNode; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="relative">
      {placeholder && (
        <p aria-hidden className="rich-placeholder pointer-events-none absolute text-fg-4">
          {placeholder}
        </p>
      )}
      {children}
    </div>
  );
}

const BUSY = "Finish or discard attachments before sending";

/** The editor's action row: the ⌘↵/Esc hint or the comment's formatting, Cancel, the paperclip and Save (Linear's medium
 *  Save, or the comment's icon-only send). Nothing when the editor neither saves nor cancels. */
export function EditorActions({
  props,
  presentation,
  formatting,
  attach,
  save,
  busy,
  empty,
  inert,
}: {
  props: RichEditorProps;
  presentation: EditorPresentation;
  formatting?: ReactNode;
  attach: () => void;
  save: () => void;
  busy: boolean;
  empty: boolean;
  /** The stand-in's row: drawn, not yet working. */
  inert?: boolean;
}) {
  if (!props.onSave && !props.onCancel) return null;
  const { variant } = presentations[presentation];
  if (variant === "edit") return <EditActions props={props} attach={attach} save={save} busy={busy} empty={empty} inert={inert} />;
  const comment = variant === "comment";
  return (
    <div className="rich-editor-actions flex items-center justify-end gap-2 border-t border-line-2 p-2 text-[12px]" inert={inert}>
      {comment ? (
        formatting
      ) : (
        <span className="rich-editor-hint mr-auto text-fg-3">
          <Shortcut keys="Mod+Enter" size="small" /> {props.hint?.save ?? "save"} ·{" "}
          <Shortcut keys="Escape" size="small" /> {props.hint?.cancel ?? "cancel"}
        </span>
      )}
      {/* Linear's edit actions: a medium link Cancel beside a medium Save (Comment.*.js). */}
      {props.onCancel && (
        <Button variant="link" size="medium" aria-label={props.cancelLabel} onClick={props.onCancel}>
          {props.cancelLabel ?? "Cancel"}
        </Button>
      )}
      {props.onFiles && (
        <IconButton label="Attach images, files, or videos" size="small" onClick={attach}>
          <Icon name="paperclip" />
        </IconButton>
      )}
      {props.onSave &&
        (comment ? (
          <SendButton
            label={props.saveLabel ?? "Save description"}
            tooltip="Submit comment"
            disabled={busy || empty}
            disabledReason={busy ? BUSY : undefined}
            onClick={save}
          />
        ) : (
          // `rich-editor-submit` is the hook the sub-issue composer's ⌘↵ clicks. Passing `disabledReason` (even
          // undefined) keeps the reason's wrapper, so the button is not remounted when uploads start or finish.
          <Button
            size="medium"
            className="rich-editor-submit"
            aria-label={props.saveLabel ?? "Save description"}
            disabled={busy || (props.required && empty)}
            disabledReason={busy ? BUSY : undefined}
            onClick={save}
          >
            {props.saveLabel ?? "Save description"}
          </Button>
        ))}
    </div>
  );
}

/** Linear's comment edit footer (`Cr`): 16px below the text, the paperclip on the left; on the right a medium link
 *  Cancel and a medium secondary Save whose tooltip is "Save comment" with ⌘↵. */
function EditActions({
  props,
  attach,
  save,
  busy,
  empty,
  inert,
}: Omit<Parameters<typeof EditorActions>[0], "presentation" | "formatting">) {
  return (
    <div className="rich-editor-actions mt-4 flex items-center gap-2" inert={inert}>
      {props.onFiles && (
        <IconButton label="Attach images, files, or videos" size="small" onClick={attach}>
          <Icon name="paperclip" />
        </IconButton>
      )}
      <span className="ml-auto flex gap-2">
        {props.onCancel && (
          <Button variant="link" size="medium" onClick={props.onCancel}>
            {props.cancelLabel ?? "Cancel"}
          </Button>
        )}
        {props.onSave && (
          <Button
            variant="secondary"
            size="medium"
            className="rich-editor-submit"
            aria-label={props.saveLabel}
            tooltip={props.saveLabel}
            shortcut="Mod+Enter"
            disabled={busy || (props.required && empty)}
            disabledReason={busy ? BUSY : undefined}
            onClick={save}
          >
            Save
          </Button>
        )}
      </span>
    </div>
  );
}
