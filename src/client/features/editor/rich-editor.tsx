/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { useHotkeys, useHotkey } from "@tanstack/react-hotkeys";
import { adfToText } from "./adf";
import { discardLateMedia, documentHasMedia, lateMediaDiscarded } from "@/shared/document";
import { Button } from "@/client/components/button";
import { EditorActions, EditorArea, EditorFrame, presentations } from "./editor-frame";
import { Icon } from "@/client/components/icons";
import { Text } from "@/client/components/text";
import { mediaCaretPlugin } from "./media-caret";
import { mediaUploads, mergeLateMedia, type LateMedia } from "./editor-media-upload";
import { editorBindings, editorKey } from "./editor-bindings";
import {
  activeMention,
  dismissMention,
  insertIssueReference,
  insertMention,
  issueReferenceRules,
  mentionPlugin,
} from "./mentions";
import { CaretMenu, MentionMenu, searchPeople } from "./mention-menu";
import { activeEmoji, dismissEmoji, emojiPlugin, emojiRules, insertEmoji } from "./emoji";
import { EmojiMenu } from "./emoji-menu";
import { inlineRules } from "./editor-inline-rules";
import { linkPlugin, linkSelected } from "./editor-links";
import { LinkPopover } from "./link-popover";
import { activeSlash, dismissSlash, matchingSlashCommands, slashPlugin } from "./slash-commands";
import { setList, taskBackspace, taskEnter, taskItemView, toggleTask } from "./editor-checklist";
import { blockRules, dividerKey, headingBackspace, insertDivider, lineBreak, slashTipPlugin } from "./editor-blocks";
import { EditorIcon, type EditorGlyph } from "./editor-icons";
import { ActionMenu } from "@/client/components/action-menu";
import { activeLinkPaste, dismissLinkPaste, linkPasteActions, pastePlugin } from "./editor-paste";
import { get } from "@/client/state/store";
import { jiraIssueURL } from "@/client/features/issue/issue-urls";
import { rememberSelectionCreate } from "@/client/state/selection-create";
import { beginCreate } from "@/client/state/issue-actions";
import { usePlacement } from "@/client/components/menu-surface";
import { useCommand } from "@/client/features/navigation/commands";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import {
  EditorState,
  NodeSelection,
  Selection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import { mediaNodeView, type MediaNodeView } from "./media-node-view";
import { expandNodeView } from "./expand-node-view";
import { codeBlockNodeView } from "./code-block-view";
import { smartLinkNodeView } from "./smart-link-view";
import { codeBlockKeys, codeHighlightPlugin } from "./code-block-editing";
import type { Attachment } from "@/shared/attachment-media";
import { EditorView, type NodeViewConstructor } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { baseKeymap, chainCommands, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { history, redo, undo } from "prosemirror-history";
import { splitListItem } from "prosemirror-schema-list";
import { moveColumn, moveRow, tableResizing } from "./editor-table";
import { TableControls } from "./table-controls";
import { tableEditing } from "prosemirror-tables";
import {
  codeDown,
  codeEnter,
  floatingPlacement,
  issueFromText,
  referenceSelection,
  linkRanges,
  markdownRules,
  moveBlock,
  toggleExpand,
  pasteLink,
  setBlock,
  shiftTab,
  shiftTabInside,
  tabInside,
  tab,
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

/** The menus that open at the caret, each with its Esc. */
const caretMenus = [
  [activeMention, dismissMention],
  [activeSlash, dismissSlash],
  [activeEmoji, dismissEmoji],
  [activeLinkPaste, dismissLinkPaste],
] as const;

/** One look for every formatting and link control: Linear's borderless small Button, pressed while its mark or block is on. */
const ToolbarButton = (props: ComponentProps<typeof Button>) => <Button variant="borderless" size="small" {...props} />;
/** FormattingToolbar's divider between button groups: 1×16px in bgBorder. */
const ToolbarSeparator = () => <span role="separator" aria-orientation="vertical" className="rich-toolbar-separator" />;

type DropdownOption = { id: string; name: string; icon?: EditorGlyph; run: () => void };
/** Linear's toolbar dropdown (AAe), for text styles and lists alike: the current option (its icon or its name) over a chevron,
 * opening a menu of the options with their keys, the current one checked. */
function ToolbarDropdown({
  label,
  options,
  current,
  show,
  disabled,
  open,
  onOpenChange,
}: {
  label: string;
  options: DropdownOption[];
  current?: string;
  show: "icon" | "name";
  disabled?: boolean;
  /** Owned by the editor: its menu takes focus, and the selection toolbar stays up while one is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const button = useRef<HTMLButtonElement>(null),
    shown = options.find((o) => o.id === current) ?? options[0]!;
  return (
    <>
      <ToolbarButton
        ref={button}
        aria-label={label}
        tooltip={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        {show === "icon" && shown.icon ? <EditorIcon name={shown.icon} /> : shown.name}
        <span aria-hidden className="grid rotate-90 place-items-center">
          <Icon name="chevron" size={12} />
        </span>
      </ToolbarButton>
      {open && (
        <ActionMenu
          label={label}
          anchor={button.current}
          highlight="first"
          close={() => onOpenChange(false)}
          entries={options.map((option) => ({
            name: option.name,
            selected: option.id === current,
            shortcut: editorKey(option.id),
            image: option.icon && <EditorIcon name={option.icon} />,
            run: option.run,
          }))}
        />
      )}
    </>
  );
}

export type EditorPresentation = "framed" | "inline" | "document" | "comment";
export type EditorEngineProps = RichEditorProps & {
  presentation: EditorPresentation;
  /** Input the loader's stand-in took before this chunk arrived: text continues where the content ends, then ⌘↵ saves. */
  early?: { text: string; submit: boolean };
};
export function RichEditor(props: EditorEngineProps) {
  const presentation = presentations[props.presentation];
  const host = useRef<HTMLDivElement>(null),
    frame = useRef<HTMLDivElement>(null),
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
    [toolbarMenu, setToolbarMenu] = useState<"Text style" | "List" | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false),
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
  // Built before paint, so the editor replaces its stand-in (or an earlier revision) in one frame: the content never
  // collapses to an empty host, and a scroll made meanwhile is never clamped (BJ-193).
  useLayoutEffect(() => {
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
          // One menu at a caret at a time, so the three triggers share the menu's key forwarding.
          mentionPlugin((_view, event) => mentionKeys.current?.(event) ?? false),
          slashPlugin((_view, event) => mentionKeys.current?.(event) ?? false),
          emojiPlugin((_view, event) => mentionKeys.current?.(event) ?? false),
          pastePlugin({
            keys: (_view, event) => mentionKeys.current?.(event) ?? false,
            upload: () => (latest.current.onFiles ? uploads.enqueue : null),
            site: () => get().site,
          }),
          mediaCaretPlugin(),
          uploads.plugin,
          markdownRules,
          inlineRules,
          linkPlugin(),
          blockRules,
          ...(latest.current.presentation === "document" ? [slashTipPlugin] : []),
          emojiRules,
          issueReferenceRules((key) => (get().issues.has(key) ? jiraIssueURL(key) : null)),
          history(),
          codeHighlightPlugin(),
          keymap(codeBlockKeys),
          keymap({
            Enter: chainCommands(
              codeEnter,
              dividerKey(true),
              taskEnter,
              splitListItem(richSchema.nodes.listItem!),
              baseKeymap.Enter!,
            ),
            "Shift-Enter": lineBreak,
            // With no Save here (the description), ⌘↵ reaches the editor: it ticks a checklist item.
            "Mod-Enter": toggleTask,
            Backspace: chainCommands(taskBackspace, headingBackspace),
            ArrowDown: chainCommands(codeDown, dividerKey(false)),
            Tab: (...args) => (latest.current.tabLeaves ? tabInside(...args) : tab(...args)),
            "Shift-Tab": (...args) =>
              latest.current.tabLeaves ? shiftTabInside(...args) : shiftTab(...args),
          }),
          keymap(baseKeymap),
          tableResizing(),
          tableEditing(),
        ],
      }),
      nodeViews: {
        expand: expandNodeView,
        codeBlock: codeBlockNodeView,
        taskItem: taskItemView,
        inlineCard: smartLinkNodeView as NodeViewConstructor,
        blockCard: smartLinkNodeView as NodeViewConstructor,
        embedCard: smartLinkNodeView as NodeViewConstructor,
        ...Object.fromEntries(
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
              (raw) => {
                const pos = getPos();
                if (pos !== undefined)
                  editor.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { raw }));
              },
            );
            mediaViews.current.add(media);
            return media;
          },
        ]),
        ),
      },
      attributes: {
        ...(props.scope ? { "data-scope": props.scope } : {}),
        role: "textbox",
        "aria-label": props.label ?? "Issue description",
        "aria-multiline": "true",
        id: props.id ?? "",
        class: "rich-content rich-doc",
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
    // The first render had no view; render again before paint so the placeholder and toolbar reflect the loaded content.
    refresh((n) => n + 1);
    const mountedAt = performance.now();
    if (props.autoFocus) {
      // Continue where the content ends: a restored draft, or the @mention a reply starts with.
      editor.dispatch(editor.state.tr.setSelection(Selection.atEnd(editor.state.doc)));
      if (props.early?.text) editor.dispatch(editor.state.tr.insertText(props.early.text));
      editor.focus();
    }
    if (props.early?.submit) save();
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
  // The text "Create issue from selection" started from; the composer's create swaps it for a reference to the new issue.
  const fromSelection = useRef<{ id: string; from: number; to: number; text: string } | null>(null);
  useCommand("issue-from-selection", ({ id, key }) => {
    const pending = fromSelection.current,
      editor = view.current;
    if (!editor || pending?.id !== id) return;
    fromSelection.current = null;
    const tr = referenceSelection(editor.state, pending, jiraIssueURL(key));
    if (tr) {
      const fragment = editor.state.doc.slice(pending.from, pending.to).content;
      const content = fromEditorDocument(richSchema.nodes.doc!.create(null, fragment)).content ?? [];
      rememberSelectionCreate(key, props.issueKey!, jiraIssueURL(key), content);
      editor.dispatch(tr);
      latest.current.onBlur?.(fromEditorDocument(editor.state.doc));
    }
    return true;
  });
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
  const list = (name: "bulletList" | "orderedList" | "taskList") => run(setList(name));
  useHotkey(
    "Escape",
    (event) => {
      if (event.target instanceof Element && event.target.closest("[data-media-interactive]"))
        return;
      event.preventDefault();
      event.stopPropagation();
      const editor = view.current;
      const dismiss = editor && caretMenus.find(([active]) => active(editor.state))?.[1];
      if (editor && dismiss) editor.dispatch(dismiss(editor.state));
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
        // The paste keys stay the browser's; the paste plugin reads which one it was.
        if (binding.id.startsWith("paste-")) return;
        if (event.target instanceof Element && event.target.closest("[data-media-interactive]"))
          return;
        // An open caret menu takes ⌥↑/⌥↓ to jump between its groups, as Linear's suggestion menus do.
        const editor = view.current;
        if (binding.id.startsWith("move-") && editor && caretMenus.some(([active]) => active(editor.state))) return;
        event.preventDefault();
        event.stopPropagation();
        const id = binding.id;
        if (["strong", "em", "underline", "strike", "code"].includes(id))
          run(toggleMark(richSchema.marks[id]!));
        else if (id === "link") setLinkOpen(true);
        else if (id.startsWith("heading-")) {
          const level = Number(id.split("-")[1]);
          changeBlock(level ? "heading" : "paragraph", level ? { level } : {});
        } else if (id === "quote") run(toggleQuote);
        else if (id === "bullet" || id === "ordered" || id === "checklist")
          list(id === "bullet" ? "bulletList" : id === "ordered" ? "orderedList" : "taskList");
        else if (id === "code-block") changeBlock("codeBlock");
        else if (id === "expand") run(toggleExpand);
        else if (id === "divider") run(insertDivider);
        else if (id === "issue-from-selection") {
          if (subject === "description" && selectedText.trim()) createFromSelection();
        } else if (id === "move-up" || id === "move-down") run(moveBlock(id === "move-up" ? -1 : 1));
        else if (id === "table-move-up" || id === "table-move-down") run(moveRow(id === "table-move-up" ? "up" : "down"));
        else if (id === "table-move-left" || id === "table-move-right") run(moveColumn(id === "table-move-left" ? "left" : "right"));
        else if (id === "undo") run(undo);
        else if (id === "redo") run(redo);
        else if (id === "save") {
          // ⌘↵ in a checklist item ticks it; anywhere else it saves.
          const editor = view.current;
          if (!editor || !toggleTask(editor.state, editor.dispatch)) save();
        }
        else if (id === "attach") attach();
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
  // Linear's Insert media… picks images, video and audio; Attach files… any file.
  const attach = (accept = "") => {
    if (fileInput.current) {
      fileInput.current.accept = accept;
      fileInput.current.click();
      return;
    }
    const scope = host.current?.closest('[role="dialog"]') ?? document.querySelector("main");
    scope?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
  };
  // Linear's "Create issue from selection": the selected text starts a new issue related to this one.
  const selectedText =
    !!props.issueKey && view.current && !view.current.state.selection.empty
      ? view.current.state.doc.textBetween(view.current.state.selection.from, view.current.state.selection.to, "\n")
      : "";
  const createFromSelection = () => {
    const key = latest.current.issueKey!,
      issue = get().issues.get(key),
      { from, to } = view.current!.state.selection;
    fromSelection.current = { id: crypto.randomUUID(), from, to, text: selectedText };
    beginCreate({
      ...issueFromText(selectedText),
      fromSelection: fromSelection.current.id,
      ...(issue ? { related: { key, kind: "related" as const }, project: issue.project } : {}),
    });
  };
  const focused = view.current?.hasFocus() ? view.current.state : null;
  const mention = focused && activeMention(focused),
    slash = focused && activeSlash(focused),
    emoji = focused && activeEmoji(focused),
    linkPaste = focused && activeLinkPaste(focused);
  const caretAnchor = (from: number, dismiss: (state: EditorState) => Transaction) => ({
    at: () => view.current!.coordsAtPos(from),
    editor: view.current!.dom,
    keys: mentionKeys,
    dismiss: () => view.current?.dispatch(dismiss(view.current.state)),
  });
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
  // A selected link shows its link editor in place of the formatting toolbar, as Linear's does.
  const linkShown =
    !!view.current && (linkOpen || (view.current.hasFocus() && linkSelected(view.current.state)));
  // Above the selection; below it when the editor has too little room above, so it never covers the title or header. Either way both edges stay inside the viewport (a long selection can start above and end below it).
  const selecting =
    !!presentation.selectionToolbar &&
    (!!view.current?.hasFocus() || !!toolbarMenu) &&
    !!selection &&
    !selection.empty &&
    !(selection instanceof NodeSelection) &&
    !linkShown;
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
  // One toolbar menu open at a time; closing it hands focus back to the text, as Linear's does.
  const toolbarMenuProps = (label: "Text style" | "List") => ({
    label,
    open: toolbarMenu === label,
    onOpenChange: (open: boolean) => {
      setToolbarMenu(open ? label : null);
      if (!open) view.current?.focus();
    },
  });
  const formatting = (!presentation.selectionToolbar || selecting) && (
    <div
      ref={toolbar}
      role="toolbar"
      aria-label={`${subject === "comment" ? "Comment" : "Description"} formatting`}
      style={floating}
      className={`z-10 items-center gap-0.5 rounded-lg border border-line-2 bg-card p-1 shadow-[var(--menu-shadow)] ${selecting ? "fixed flex flex-nowrap overflow-x-auto" : "absolute right-0 bottom-full mb-1 hidden max-w-full flex-nowrap overflow-x-auto group-focus-within/editor:flex"}`}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
    >
      {/* Linear's order (LB): text style, marks, link, quote, collapse, inline code, code block, lists, then selection actions. */}
      <ToolbarDropdown
        {...toolbarMenuProps("Text style")}
        show="name"
        current={level >= 0 ? `heading-${level}` : undefined}
        disabled={within("listItem") || within("taskList")}
        options={[0, 1, 2, 3, 4].map((n) => ({
          id: `heading-${n}`,
          name: n ? `Heading ${n}` : "Regular text",
          run: () => changeBlock(n ? "heading" : "paragraph", n ? { level: n } : {}),
        }))}
      />
      {(
        [
          ["strong", "Bold", "bold"],
          ["em", "Italic", "italic"],
          ["strike", "Strikethrough", "strike"],
          ["underline", "Underline", "underline"],
        ] as const
      ).map(([name, label, icon]) => (
        <ToolbarButton
          key={name}
          aria-label={label}
          tooltip={label}
          shortcut={editorKey(name)}
          aria-pressed={marked(name)}
          onClick={() => run(toggleMark(richSchema.marks[name]!))}
        >
          <EditorIcon name={icon} />
        </ToolbarButton>
      ))}
      <ToolbarButton
        aria-label="Insert link"
        tooltip="Link"
        shortcut={editorKey("link")}
        aria-pressed={marked("link")}
        onClick={() => setLinkOpen(!linkOpen)}
      >
        <EditorIcon name="link" />
      </ToolbarButton>
      <ToolbarButton
        aria-label="Block quote"
        tooltip="Quote"
        shortcut={editorKey("quote")}
        aria-pressed={within("blockquote")}
        disabled={block === "heading"}
        onClick={() => run(toggleQuote)}
      >
        <EditorIcon name="quote" />
      </ToolbarButton>
      <ToolbarButton
        aria-label="Collapsible section"
        tooltip="Collapse"
        shortcut={editorKey("expand")}
        aria-pressed={within("expand")}
        onClick={() => run(toggleExpand)}
      >
        <EditorIcon name="collapse" />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        aria-label="Inline code"
        tooltip="Inline code"
        shortcut={editorKey("code")}
        aria-pressed={marked("code")}
        onClick={() => run(toggleMark(richSchema.marks.code!))}
      >
        <EditorIcon name="inline-code" />
      </ToolbarButton>
      <ToolbarButton
        aria-label="Code block"
        tooltip="Code block"
        shortcut={editorKey("code-block")}
        aria-pressed={block === "codeBlock"}
        disabled={block === "heading"}
        onClick={() => changeBlock("codeBlock")}
      >
        <EditorIcon name="code-block" />
      </ToolbarButton>
      <ToolbarDropdown
        {...toolbarMenuProps("List")}
        show="icon"
        current={within("taskList") ? "checklist" : within("orderedList") ? "ordered" : within("bulletList") ? "bullet" : undefined}
        disabled={block === "heading"}
        options={[
          { id: "bullet", name: "List", icon: "list", run: () => list("bulletList") },
          { id: "ordered", name: "Numbered list", icon: "numbered-list", run: () => list("orderedList") },
          { id: "checklist", name: "Checklist", icon: "checklist", run: () => list("taskList") },
        ]}
      />
      {subject === "description" && selectedText.trim() && (
        <ToolbarButton
          aria-label="Create issue from selection"
          tooltip="Create issue from selection"
          shortcut={editorKey("issue-from-selection")}
          onClick={createFromSelection}
        >
          Create issue
        </ToolbarButton>
      )}
    </div>
  );
  const preloadPeople = () =>
    void searchPeople("", props.mentionIssue ?? props.issueKey).catch(() => {});
  return (
    <EditorFrame
      presentation={props.presentation}
      expanded={props.expanded}
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
      {linkShown && (
        <LinkPopover
          key={`${selection!.from} ${selection!.to}`}
          view={view.current!}
          focus={linkOpen}
          edit={() => setLinkOpen(true)}
          close={(refocus) => {
            setLinkOpen(false);
            const editor = view.current;
            if (!refocus || !editor) return;
            editor.dispatch(editor.state.tr.setSelection(Selection.near(editor.state.selection.$to)));
            editor.focus();
          }}
        />
      )}
      <EditorArea ref={frame} placeholder={empty && props.placeholder}>
        <div ref={host} />
        {view.current && <TableControls view={view.current} frame={frame} />}
      </EditorArea>
      {slash && (
        <CaretMenu
          {...caretAnchor(slash.from, dismissSlash)}
          label="Insert block"
          width={240}
          query={slash.query}
          empty={null}
          items={matchingSlashCommands(slash.query, view.current!.state)
            .filter((item) => item.command || props.onFiles)
            .map((item) => ({
              id: item.id,
              label: item.label,
              icon: <EditorIcon name={item.icon} />,
              shortcut: editorKey(item.id),
              pick: () => {
                const editor = view.current!;
                editor.dispatch(editor.state.tr.delete(slash.from, slash.to));
                if (item.command) run(item.command);
                else attach(item.id === "media" ? "image/*,video/*,audio/*" : "");
              },
            }))}
        />
      )}
      {emoji && (
        <EmojiMenu
          {...caretAnchor(emoji.from, dismissEmoji)}
          query={emoji.query}
          pick={(item) => {
            const editor = view.current!;
            editor.dispatch(insertEmoji(editor.state, emoji, item));
            editor.focus();
          }}
        />
      )}
      {linkPaste && (
        <CaretMenu
          {...caretAnchor(linkPaste.to, dismissLinkPaste)}
          // Linear's width for this menu isn't in the bundle we have; the slash menu's 240.
          width={240}
          label="Pasted link"
          query={linkPaste.href}
          empty={null}
          items={linkPasteActions(linkPaste, view.current!).map((item) => ({
            ...item,
            icon: <Icon name={item.id === "keep" ? "link" : "expand"} />,
          }))}
        />
      )}
      {mention && (
        <MentionMenu
          {...caretAnchor(mention.from, dismissMention)}
          query={mention.query}
          issueKey={props.mentionIssue ?? props.issueKey}
          pickIssue={(issue) => {
            const editor = view.current!;
            editor.dispatch(insertIssueReference(editor.state, mention, jiraIssueURL(issue.key)));
            editor.focus();
          }}
          pick={(person) => {
            const editor = view.current!;
            editor.dispatch(insertMention(editor.state, mention, person));
            editor.focus();
          }}
        />
      )}
      {uploadNotice && (
        <Text as="p" role="status" variant="mini" color="muted">
          {uploadNotice}
        </Text>
      )}
      <EditorActions
        props={props}
        presentation={props.presentation}
        formatting={formatting}
        attach={() => fileInput.current?.click()}
        save={() => save()}
        busy={uploadBusy}
        empty={empty}
      />
    </EditorFrame>
  );
}
