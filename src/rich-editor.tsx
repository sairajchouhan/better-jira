/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { useHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import { adfToText } from "./adf";
import { discardLateMedia, documentHasMedia, lateMediaDiscarded } from "./document";
import { Button, IconButton, SendButton } from "./button";
import { Shortcut } from "./keycap";
import { TextInput } from "./field";
import { Icon } from "./icons";
import { Text } from "./text";
import { mediaCaretPlugin } from "./media-caret";
import { mediaUploads, mergeLateMedia, type LateMedia } from "./editor-media-upload";
import { editorBindings } from "./editor-bindings";
import { activeMention, dismissMention, insertMention, mentionPlugin } from "./mentions";
import { MentionMenu, searchPeople } from "./mention-menu";
import { usePlacement } from "./menu-surface";
import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { EditorState, NodeSelection, Selection, type Command } from "prosemirror-state";
import { mediaNodeView, type MediaNodeView } from "./media-node-view";
import type { Attachment } from "./attachment-media";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { baseKeymap, chainCommands, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { splitListItem } from "prosemirror-schema-list";
import {
  addColumnAfter,
  addRowAfter,
  deleteTable,
  isInTable,
  tableEditing,
} from "prosemirror-tables";
import {
  codeDown,
  codeEnter,
  floatingPlacement,
  insertLink,
  insertTable,
  linkHref,
  linkRanges,
  linkTarget,
  markdownRules,
  pasteLink,
  removeLink,
  setBlock,
  shiftTab,
  shiftTabInside,
  tabInside,
  tab,
  toggleList,
  toggleQuote,
} from "./editor-commands";
import {
  fromEditorDocument,
  richSchema,
  toEditorDocument,
  type AdfDocument,
} from "./rich-document";

/** Shared content, persistence and interaction contract for every editor presentation. */
export type RichEditorProps = {
  initial: unknown;
  onFiles?: (files: File[]) => Promise<Attachment[]>;
  issueKey?: string;
  /** The issue whose people @mentions suggest, when it differs from `issueKey` (a sub-issue draft suggests its parent's). */
  mentionIssue?: string;
  attachments?: Attachment[];
  label?: string;
  id?: string;
  autoFocus?: boolean;
  expanded?: boolean;
  placeholder?: string;
  saveLabel?: string;
  /** Save stays off while the content is empty (comment composers always are). */
  required?: boolean;
  cancelLabel?: string;
  /** The verbs in the "⌘↵ save · Esc cancel" hint. */
  hint?: { save: string; cancel: string };
  onChange?: (doc: AdfDocument) => void;
  onBlur?: (doc: AdfDocument) => void;
  onSave?: (doc: AdfDocument) => void;
  onCancel?: () => void;
  /** Identifies the content (issue description, a document) so media that finishes uploading after this editor closed reaches the editor showing it now, or onLateMedia when none is open. */ scope?: string;
  /** Receives a function that applies the late media to the content as it is now. */ onLateMedia?: (
    merge: (current: unknown) => AdfDocument,
  ) => void;
  /** Tab outside a list, table or code block moves focus on (Linear's create composer) instead of staying in the editor. */ tabLeaves?: boolean;
};

/** One look for every formatting and link control: Linear's borderless small Button, pressed while its mark or block is on. */
const ToolbarButton = (props: ComponentProps<typeof Button>) => <Button variant="borderless" size="small" {...props} />;

export type EditorPresentation = "framed" | "inline" | "document" | "comment";
export type EditorEngineProps = RichEditorProps & { presentation: EditorPresentation };
// Presentation policy stays private to the engine. Callers compose a named editor variant.
const BUSY = "Finish or discard attachments before sending";
const presentations = {
  framed: { inline: false, selectionToolbar: false, variant: undefined },
  inline: { inline: true, selectionToolbar: false, variant: undefined },
  document: { inline: true, selectionToolbar: true, variant: undefined },
  comment: { inline: false, selectionToolbar: false, variant: "comment" },
} as const;

export function RichEditor(props: EditorEngineProps) {
  const presentation = presentations[props.presentation];
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    latest = useRef(props);
  latest.current = props;
  const mediaViews = useRef(new Set<MediaNodeView>()),
    fileInput = useRef<HTMLInputElement>(null),
    staged = useRef<Attachment[]>([]);
  const upload = useRef<ReturnType<typeof mediaUploads> | null>(null),
    toolbar = useRef<HTMLDivElement>(null),
    mentionKeys = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const mediaContext = () => ({
    issueKey: latest.current.issueKey,
    attachments: [
      ...new Map(
        [...(latest.current.attachments ?? []), ...staged.current].map((file) => [file.id, file]),
      ).values(),
    ],
  });
  const [, refresh] = useState(0),
    [linkOpen, setLinkOpen] = useState(false),
    [url, setURL] = useState("");
  const [linkError, setLinkError] = useState(""),
    [uploadBusy, setUploadBusy] = useState(false),
    [uploadNotice, setUploadNotice] = useState("");
  // Linear sends while a pasted file is still uploading; locally we send once the save finishes. A failed file still blocks until Retry.
  // A deferred send consumes this editor's late media (Opus review 4): its files went out with the post, so they never return to a draft.
  const save = (deferred = false): void => {
    const uploads = upload.current;
    if (uploads?.busy()) {
      void uploads.idle().then(() => {
        if (!uploads.busy()) save(true);
      });
      return;
    }
    if (view.current) {
      const doc = fromEditorDocument(view.current.state.doc);
      if (
        (latest.current.required || latest.current.presentation === "comment") &&
        !adfToText(doc).trim() &&
        !documentHasMedia(doc)
      )
        return;
      if (deferred && latest.current.scope) discardLateMedia(latest.current.scope);
      latest.current.onSave?.(doc);
    }
  };
  useEffect(() => {
    let mine: EditorView | null = null,
      detached = false;
    const uploads = mediaUploads(
      () => mine,
      async (files) => {
        if (!latest.current.onFiles) throw new Error("File uploads are unavailable here");
        const saved = await latest.current.onFiles(files);
        staged.current.push(...saved);
        return saved;
      },
      setUploadBusy,
      setUploadNotice,
    );
    upload.current = uploads;
    const editor = new EditorView(host.current!, {
      state: EditorState.create({
        schema: richSchema,
        doc: toEditorDocument(latest.current.initial),
        plugins: [
          mentionPlugin((_view, event) => mentionKeys.current?.(event) ?? false),
          mediaCaretPlugin(),
          uploads.plugin,
          markdownRules,
          history(),
          keymap({
            Enter: chainCommands(
              codeEnter,
              splitListItem(richSchema.nodes.listItem!),
              baseKeymap.Enter!,
            ),
            ArrowDown: codeDown,
            Tab: (...args) => (latest.current.tabLeaves ? tabInside(...args) : tab(...args)),
            "Shift-Tab": (...args) =>
              latest.current.tabLeaves ? shiftTabInside(...args) : shiftTab(...args),
          }),
          keymap(baseKeymap),
          tableEditing(),
        ],
      }),
      nodeViews: Object.fromEntries(
        ["mediaSingle", "mediaGroup", "media", "mediaInline"].map((type) => [
          type,
          (node, editor, getPos) => {
            const media = mediaNodeView(
              node,
              () => ({
                ...mediaContext(),
                onSelect: () => {
                  const pos = getPos();
                  if (pos !== undefined) {
                    editor.dispatch(
                      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)),
                    );
                    editor.focus();
                  }
                },
              }),
              () => mediaViews.current.delete(media),
            );
            mediaViews.current.add(media);
            return media;
          },
        ]),
      ),
      attributes: {
        ...(props.scope ? { "data-scope": props.scope } : {}),
        role: "textbox",
        "aria-label": props.label ?? "Issue description",
        "aria-multiline": "true",
        id: props.id ?? "",
        class: "rich-content",
      },
      handlePaste(editor, event) {
        const files = [...(event.clipboardData?.files ?? [])];
        if (!files.length && pasteLink(event.clipboardData?.getData("text/plain") ?? "")(editor.state, editor.dispatch)) {
          event.preventDefault();
          return true;
        }
        if (!files.length || !latest.current.onFiles) return false;
        event.preventDefault();
        uploads.enqueue(files);
        return true;
      },
      handleDrop(editor, event) {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (!files.length || !latest.current.onFiles) return false;
        event.preventDefault();
        uploads.enqueue(
          files,
          editor.posAtCoords({ left: event.clientX, top: event.clientY })?.pos,
        );
        return true;
      },
      handleDOMEvents: {
        blur: (editor) => {
          latest.current.onBlur?.(fromEditorDocument(editor.state.doc));
          refresh((n) => n + 1);
          return false;
        },
        focus: () => {
          refresh((n) => n + 1);
          return false;
        },
      },
      dispatchTransaction(tr) {
        const next = editor.state.apply(tr);
        editor.updateState(next);
        refresh((n) => n + 1);
        if (tr.docChanged && !detached) latest.current.onChange?.(fromEditorDocument(next.doc));
      },
    });
    view.current = mine = editor;
    // The first render had no view and showed the empty placeholder; render again so it reflects the loaded content.
    refresh((n) => n + 1);
    const mountedAt = performance.now();
    if (props.autoFocus) {
      // Continue where the content ends: a restored draft, or the @mention a reply starts with.
      editor.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
      editor.focus();
    }
    const input = (event: Event) => uploads.enqueue((event as CustomEvent<File[]>).detail);
    const late = (event: Event) => {
      const merged = mergeLateMedia(
          fromEditorDocument(editor.state.doc),
          (event as CustomEvent<LateMedia>).detail,
        ),
        doc = toEditorDocument(merged);
      if (!doc.eq(editor.state.doc))
        editor.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content));
    };
    editor.dom.addEventListener("attach-files", input);
    editor.dom.addEventListener("late-media", late);
    // A file still saving when the editor unmounts (paste, then Back) is placed in the detached editor. Its old copy of the content is never saved wholesale:
    // only the new media goes to the editor now showing this content (reopened and maybe edited), or to onLateMedia. Unscoped editors keep reporting through onBlur.
    return () => {
      detached = true;
      editor.dom.removeEventListener("attach-files", input);
      editor.dom.removeEventListener("late-media", late);
      const left = editor.state.doc;
      void uploads.idle().then(() => {
        if (!editor.state.doc.eq(left) && !lateMediaDiscarded(latest.current.scope, mountedAt)) {
          const detail = {
              before: fromEditorDocument(left),
              after: fromEditorDocument(editor.state.doc),
            },
            scope = latest.current.scope,
            live = scope
              ? [...document.querySelectorAll<HTMLElement>("[data-scope]")].find(
                  (node) => node.dataset.scope === scope && node !== editor.dom,
                )
              : undefined;
          if (live) live.dispatchEvent(new CustomEvent("late-media", { detail }));
          else if (scope)
            latest.current.onLateMedia?.((current) => mergeLateMedia(current, detail));
          else {
            latest.current.onChange?.(detail.after);
            latest.current.onBlur?.(detail.after);
          }
        }
        uploads.dispose();
        editor.destroy();
        if (view.current === editor) view.current = null;
      });
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- The editor mounts once with initial props.
  }, []);
  useEffect(() => {
    for (const media of mediaViews.current) media.updateContext();
  }, [props.issueKey, props.attachments]);
  const run = (command: Command) => {
    const editor = view.current;
    if (editor) {
      command(editor.state, editor.dispatch, editor);
      editor.focus();
    }
  };
  const marked = (name: string) => {
    const state = view.current?.state;
    if (state && name === "link") return linkRanges(state).length > 0;
    if (!state) return false;
    const { empty, from, to, $from } = state.selection;
    // A selection starting at the marked text: $from.marks() would read the marks before it (R2-D7).
    return empty
      ? (state.storedMarks ?? $from.marks()).some((m) => m.type.name === name)
      : state.doc.rangeHasMark(from, to, richSchema.marks[name]!);
  };
  const changeBlock = (type: string, attributes: Record<string, unknown> = {}) =>
    run(setBlock(type, attributes));
  const list = (name: "bulletList" | "orderedList") => run(toggleList(name));
  useHotkey(
    "Escape",
    (event) => {
      if (event.target instanceof Element && event.target.closest("[data-media-interactive]"))
        return;
      event.preventDefault();
      event.stopPropagation();
      const editor = view.current;
      if (editor && activeMention(editor.state)) editor.dispatch(dismissMention(editor.state));
      else if (latest.current.onCancel) latest.current.onCancel();
      else view.current?.dom.blur();
    },
    {
      target: host,
      capture: true,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
      enabled: !!presentation.inline || !!props.onCancel || presentation.variant === "comment",
    },
  );
  useHotkeys(
    editorBindings.map((binding) => ({
      hotkey: binding.hotkey,
      callback: (event: KeyboardEvent) => {
        if (event.target instanceof Element && event.target.closest("[data-media-interactive]"))
          return;
        event.preventDefault();
        event.stopPropagation();
        const id = binding.id;
        if (["strong", "em", "underline", "strike", "code"].includes(id))
          run(toggleMark(richSchema.marks[id]!));
        else if (id === "link") {
          setURL(view.current ? linkHref(view.current.state) : "");
          setLinkOpen(true);
        } else if (id.startsWith("heading-")) {
          const level = Number(id.split("-")[1]);
          changeBlock(level ? "heading" : "paragraph", level ? { level } : {});
        } else if (id === "quote") run(toggleQuote);
        else if (id === "bullet" || id === "ordered")
          list(id === "bullet" ? "bulletList" : "orderedList");
        else if (id === "code-block") changeBlock("codeBlock");
        else if (id === "undo") run(undo);
        else if (id === "redo") run(redo);
        else if (id === "save") save();
        else if (id === "attach") {
          if (fileInput.current) {
            fileInput.current.click();
            return;
          }
          const scope = host.current?.closest('[role="dialog"]') ?? document.querySelector("main");
          scope?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
        }
      },
      options: {
        enabled: binding.id !== "save" || !!props.onSave,
        meta: { name: binding.name, group: "Editor" },
      },
    })),
    {
      target: host,
      capture: true,
      ignoreInputs: false,
      ignoreDefaultPrevented: true,
      preventDefault: false,
      stopPropagation: false,
    },
  );
  const addLink = () => {
    const href = linkTarget(url);
    if (!href) {
      setLinkError("Enter an http, https, or mailto link.");
      return;
    }
    run(insertLink(href));
    setLinkOpen(false);
    setURL("");
    setLinkError("");
  };
  const inTable = !!view.current && isInTable(view.current.state);
  const mention = view.current?.hasFocus() ? activeMention(view.current.state) : null;
  const doc = view.current?.state.doc;
  const empty = useMemo(() => {
    if (!doc) return true;
    const value = fromEditorDocument(doc);
    return !adfToText(value).trim() && !documentHasMedia(value);
  }, [doc]);
  const $from = view.current?.state.selection.$from,
    block = $from?.parent.type.name;
  const level =
    block === "heading" ? Number($from!.parent.attrs.level) : block === "paragraph" ? 0 : -1;
  const within = (name: string) =>
    !!$from &&
    Array.from({ length: $from.depth }, (_, d) => $from.node(d + 1)).some(
      (n) => n.type.name === name,
    );
  // Comment composers name their own toolbar and undo, not the description's.
  const subject =
    presentation.variant === "comment" || /comment/i.test(props.label ?? "") ? "comment" : "description";
  const selection = view.current?.state.selection;
  // Above the selection; below it when the editor has too little room above, so it never covers the title or header. Either way both edges stay inside the viewport (a long selection can start above and end below it).
  const selecting =
    !!presentation.selectionToolbar &&
    !!view.current?.hasFocus() &&
    !!selection &&
    !selection.empty &&
    !(selection instanceof NodeSelection);
  const floating = usePlacement(
    toolbar,
    view.current?.dom,
    (area, node) => {
      const editor = view.current!,
        { from, to } = editor.state.selection;
      return floatingPlacement(
        editor.coordsAtPos(from),
        editor.coordsAtPos(to),
        area!,
        { width: node.offsetWidth, height: node.offsetHeight },
        { width: innerWidth, height: innerHeight },
      );
    },
    selecting && `${selection!.from} ${selection!.to}`,
  );
  const formatting = (!presentation.selectionToolbar || selecting) && (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label={`${subject === "comment" ? "Comment" : "Description"} formatting`}
      style={floating}
      className={`z-10 items-center gap-0.5 rounded-lg border border-line-2 bg-card p-1 shadow-lg ${selecting ? "fixed flex flex-nowrap overflow-x-auto" : "absolute right-0 bottom-full mb-1 hidden max-w-full flex-nowrap overflow-x-auto group-focus-within/editor:flex"}`}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {[
        ["strong", "Bold", "B"],
        ["em", "Italic", "I"],
        ["underline", "Underline", "U"],
        ["strike", "Strikethrough", "S"],
        ["code", "Inline code", "<>"],
      ].map(([name, label, text]) => (
        <ToolbarButton
          key={name}
          aria-label={label}
          tooltip={label}
          shortcut={editorBindings.find((b) => b.id === name)!.hotkey}
          aria-pressed={marked(name!)}
          onClick={() => run(toggleMark(richSchema.marks[name!]!))}
        >
          {text}
        </ToolbarButton>
      ))}
      {[0, 1, 2, 3, 4].map((n) => (
        <ToolbarButton
          key={n}
          aria-label={n ? `Heading ${n}` : "Text"}
          title={n ? `Heading ${n}` : "Text"}
          aria-pressed={level === n}
          onClick={() => changeBlock(n ? "heading" : "paragraph", n ? { level: n } : {})}
        >
          {n ? `H${n}` : "T"}
        </ToolbarButton>
      ))}
      <ToolbarButton
        aria-label="Bulleted list"
        aria-pressed={within("bulletList")}
        onClick={() => list("bulletList")}
      >
        • List
      </ToolbarButton>
      <ToolbarButton
        aria-label="Numbered list"
        aria-pressed={within("orderedList")}
        onClick={() => list("orderedList")}
      >
        1. List
      </ToolbarButton>
      <ToolbarButton
        aria-label="Block quote"
        aria-pressed={within("blockquote")}
        onClick={() => run(toggleQuote)}
      >
        Quote
      </ToolbarButton>
      <ToolbarButton
        aria-label="Code block"
        aria-pressed={block === "codeBlock"}
        onClick={() => changeBlock("codeBlock")}
      >
        Code
      </ToolbarButton>
      <ToolbarButton
        aria-label="Insert link"
        onClick={() => {
          setURL(view.current ? linkHref(view.current.state) : "");
          setLinkOpen(!linkOpen);
        }}
      >
        Link
      </ToolbarButton>
      {marked("link") && (
        <ToolbarButton
          aria-label="Remove text link"
          onClick={() => run(removeLink)}
        >
          Unlink
        </ToolbarButton>
      )}
      <ToolbarButton
        aria-label="Insert table"
        onClick={() => run(insertTable)}
      >
        Table
      </ToolbarButton>
      {inTable && (
        <>
          <ToolbarButton
            aria-label="Add table row"
            onClick={() => run(addRowAfter)}
          >
            + Row
          </ToolbarButton>
          <ToolbarButton
            aria-label="Add table column"
            onClick={() => run(addColumnAfter)}
          >
            + Column
          </ToolbarButton>
          <ToolbarButton
            aria-label="Remove table"
            onClick={() => run(deleteTable)}
          >
            Remove table
          </ToolbarButton>
        </>
      )}
      <ToolbarButton
        aria-label={`Undo ${subject} edit`}
        onClick={() => run(undo)}
      >
        Undo
      </ToolbarButton>
      <ToolbarButton
        aria-label={`Redo ${subject} edit`}
        onClick={() => run(redo)}
      >
        Redo
      </ToolbarButton>
    </div>
  );
  const preloadPeople = () =>
    void searchPeople("", props.mentionIssue ?? props.issueKey).catch(() => {});
  return (
    <div
      className={`rich-editor group/editor relative ${presentation.inline ? "" : "mb-3 rounded-lg border border-line-2 bg-card"}`}
      data-variant={presentation.variant}
      data-inline={presentation.inline || undefined}
      data-expanded={props.expanded || undefined}
      // The first @ lists people at once: Jira is asked when the editor is approached, not on the @ (R2-comments-D6).
      onPointerEnter={props.onSave ? preloadPeople : undefined}
      onFocusCapture={preloadPeople}
    >
      {props.onFiles && (
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          aria-label={`Attach files to ${props.label ?? "description"}`}
          onChange={(event) => {
            upload.current?.enqueue([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
      )}
      {presentation.variant !== "comment" && formatting}
      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line-2 p-2">
          <TextInput
            size="small"
            autoFocus
            aria-label="Text link URL"
            value={url}
            onChange={(e) => setURL(e.target.value)}
            className="min-w-0 flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                addLink();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setLinkOpen(false);
                view.current?.focus();
              }
            }}
          />
          <ToolbarButton onClick={addLink}>
            Apply link
          </ToolbarButton>
          {marked("link") && (
            <ToolbarButton
              onClick={() => {
                run(removeLink);
                setLinkOpen(false);
                setURL("");
              }}
            >
              Remove link
            </ToolbarButton>
          )}
          {linkError && (
            <Text role="alert" variant="mini" color="muted" className="w-full">
              {linkError}
            </Text>
          )}
        </div>
      )}
      <div className="relative">
        {empty && props.placeholder && (
          <p aria-hidden className="rich-placeholder pointer-events-none absolute text-fg-4">
            {props.placeholder}
          </p>
        )}
        <div ref={host} />
      </div>
      {mention && (
        <MentionMenu
          query={mention.query}
          issueKey={props.mentionIssue ?? props.issueKey}
          at={() => view.current!.coordsAtPos(mention.from)}
          editor={view.current!.dom}
          keys={mentionKeys}
          pick={(person) => {
            const editor = view.current!;
            editor.dispatch(insertMention(editor.state, mention, person));
            editor.focus();
          }}
          dismiss={() => view.current?.dispatch(dismissMention(view.current.state))}
        />
      )}
      {uploadNotice && (
        <Text as="p" role="status" variant="mini" color="muted">
          {uploadNotice}
        </Text>
      )}
      {(props.onSave || props.onCancel) && (
        <div className="rich-editor-actions flex items-center justify-end gap-2 border-t border-line-2 p-2 text-[12px]">
          {presentation.variant === "comment" && formatting}
          {presentation.variant !== "comment" && (
            <span className="rich-editor-hint mr-auto text-fg-3"><Shortcut keys="Mod+Enter" size="small" /> {props.hint?.save ?? "save"} ·{" "}
              <Shortcut keys="Escape" size="small" /> {props.hint?.cancel ?? "cancel"}</span>
          )}
          {/* Linear's edit actions: a medium link Cancel beside a medium Save (Comment.*.js). */}
          {props.onCancel && (
            <Button variant="link" size="medium" aria-label={props.cancelLabel} onClick={props.onCancel}>
              {props.cancelLabel ?? "Cancel"}
            </Button>
          )}
          {props.onFiles && (
            <IconButton label="Attach images, files, or videos" size="small" onClick={() => fileInput.current?.click()}>
              <Icon name="paperclip" />
            </IconButton>
          )}
          {props.onSave &&
            (presentation.variant === "comment" ? (
              <SendButton
                label={props.saveLabel ?? "Save description"}
                tooltip="Submit comment"
                disabled={uploadBusy || empty}
                disabledReason={uploadBusy ? BUSY : undefined}
                onClick={() => save()}
              />
            ) : (
              // `rich-editor-submit` is the hook the sub-issue composer's ⌘↵ clicks. Passing `disabledReason` (even
              // undefined) keeps the reason's wrapper, so the button is not remounted when uploads start or finish.
              <Button
                size="medium"
                className="rich-editor-submit"
                aria-label={props.saveLabel ?? "Save description"}
                disabled={uploadBusy || (props.required && empty)}
                disabledReason={uploadBusy ? BUSY : undefined}
                onClick={() => save()}
              >
                {props.saveLabel ?? "Save description"}
              </Button>
            ))}
        </div>
      )}
    </div>
  );
}
