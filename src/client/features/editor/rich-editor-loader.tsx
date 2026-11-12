import { createElement, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { normalizeDocument } from "@/shared/document";
import { Adf, adfToText, withTaskToggled } from "./adf";
import { EditorActions, EditorArea, EditorFrame } from "./editor-frame";
import { editorShaped, type AdfNode } from "./editor-shape";
import type { EditorEngineProps, RichEditorProps } from "./rich-editor";

// One signal for every editor on screen: when the chunk arrives they all take over in the same commit. (Each behind its own
// Suspense boundary, React's 300ms reveal throttle held the description back after the composer, BJ-198.)
let loaded: typeof import("./rich-editor").RichEditor | undefined;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
/** Fetches the editor chunk once; every editor on screen takes over when it arrives. */
export const loadEditor = () =>
  (loading ??= import("./rich-editor").then(
    (module) => {
      loaded = module.RichEditor;
      for (const listener of listeners) listener();
    },
    () => {
      loading = undefined; // The next editor shown asks again.
    },
  ));
const subscribe = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
// Kept out of the board's startup payload (BJ-110). A first screen with an issue (or the inbox's) needs it at once;
// elsewhere the first pointer over an issue or the first key press fetches it, before any composer can open in practice.
if (typeof window !== "undefined" && (/^\/(issue|inbox)\b/.test(location.pathname) || /[?&]issue=/.test(location.search))) void loadEditor();
else if (typeof window !== "undefined") {
  const intents = ["pointerover", "keydown"] as const;
  const intent = (event: Event) => {
    if (event.type === "pointerover" && !(event.target as Element).closest?.("[data-key]")) return;
    for (const type of intents) removeEventListener(type, intent, true);
    void loadEditor();
  };
  for (const type of intents) addEventListener(type, intent, { capture: true, passive: true });
}

type Early = { focus: boolean; text: string; submit: boolean };
/** The editor as it will look, read-only, while the chunk loads: the same frame, text area and actions, and the document
 *  shaped as the editor will hold it, so the editor takes over without moving anything (BJ-198). It keeps focus, the
 *  characters typed and ⌘↵ for the editor to continue from, so input that beats the chunk is never lost. No id: focus
 *  commands and anchors wait for the editor. */
function EditorStandIn({ props, early, setEarly }: { props: EditorEngineProps; early: Early; setEarly: (next: (early: Early) => Early) => void }) {
  // Jira's own document when it is one (not normalizeDocument's copy), so a ticked checklist item is found in it.
  const doc = useMemo(() => {
    const initial = props.initial as AdfNode | undefined;
    return editorShaped(initial?.type === "doc" && Array.isArray(initial.content) ? initial : normalizeDocument(props.initial));
  }, [props.initial]);
  const empty = !early.text && !adfToText(doc).trim();
  return (
    <EditorFrame presentation={props.presentation} expanded={props.expanded}>
      <EditorArea placeholder={empty && props.placeholder}>
        <div
          className="rich-content rich-doc rich-stand-in"
          role="textbox"
          aria-label={props.label ?? "Issue description"}
          aria-multiline="true"
          aria-busy="true"
          tabIndex={0}
          onFocus={() => setEarly((e) => ({ ...e, focus: true }))}
          onBlur={() => setEarly((e) => ({ ...e, focus: false }))}
          onKeyDown={(event) => {
            const key = event.key;
            if (key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              setEarly((e) => ({ ...e, submit: true }));
              return;
            }
            if (event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return;
            if (key !== "Backspace" && key.length !== 1) return;
            event.preventDefault();
            setEarly((e) => ({ ...e, text: key === "Backspace" ? e.text.slice(0, -1) : e.text + key }));
          }}
        >
          {doc.content!.map((node, i) => (
            <Adf
              key={i}
              node={node}
              issueKey={props.issueKey}
              attachments={props.attachments}
              // A checklist item ticks before the editor arrives, saved the way an edit is.
              onTask={
                props.onChange &&
                ((task) => {
                  const next = withTaskToggled(props.initial, task);
                  props.onChange?.(next);
                  props.onBlur?.(next);
                })
              }
            />
          ))}
          {early.text && <p>{early.text}</p>}
        </div>
      </EditorArea>
      <EditorActions props={props} presentation={props.presentation} attach={() => {}} save={() => {}} busy={false} empty={empty} inert />
    </EditorFrame>
  );
}

const isLoaded = () => !!loaded;
function LoadedEditor(props: EditorEngineProps) {
  const ready = useSyncExternalStore(subscribe, isLoaded, isLoaded);
  const [early, setEarly] = useState<Early>({ focus: false, text: "", submit: false });
  useEffect(() => {
    if (!ready) void loadEditor();
  }, [ready]);
  // The chunk's one RichEditor, the same component for the page's life: it is never swapped (and remounted) mid-edit.
  return ready ? (
    createElement(loaded!, { ...props, autoFocus: props.autoFocus || early.focus, early })
  ) : (
    <EditorStandIn props={props} early={early} setEarly={setEarly} />
  );
}

/** Framed editor with a focus toolbar and optional Save/Cancel actions. */
export function FramedEditor(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="framed" />;
}
/** Frameless composer with a focus toolbar (for sub-issue creation). */
export function InlineEditor(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="inline" />;
}
/** The create modal's frameless description: formatting over a selection; Escape is the modal's. */
export function ComposerEditor(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="composer" />;
}
/** Persistent document content with formatting above a text selection. */
export function DocumentBodyEditor(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="document" />;
}
/** Comment/reply composer with footer formatting and a required, icon-only submit. */
export function CommentComposer(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="comment" />;
}
