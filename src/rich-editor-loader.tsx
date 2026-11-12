import { lazy, Suspense, useState } from "react";
import { Adf } from "./adf";
import type { EditorEngineProps, RichEditorProps } from "./rich-editor";

let loaded: typeof import("./rich-editor").RichEditor | undefined;
const load = () =>
  import("./rich-editor").then((module) => ({ default: (loaded = module.RichEditor) }));
const Editor = lazy(load);
// Kept out of the startup payload (BJ-110): the first pointer over an issue or the first key press fetches it,
// which is before any composer can open in practice.
if (typeof window !== "undefined") {
  const intents = ["pointerover", "keydown"] as const;
  const intent = (event: Event) => {
    if (event.type === "pointerover" && !(event.target as Element).closest?.("[data-key]")) return;
    for (const type of intents) removeEventListener(type, intent, true);
    void load();
  };
  for (const type of intents) addEventListener(type, intent, { capture: true, passive: true });
}

type Early = { focus: boolean; text: string; submit: boolean };
/** The document as read-only ADF while the chunk loads, under the editor's id so focus commands land on it. It keeps
 *  focus, the characters typed and ⌘↵ for the editor to continue from, so input that beats the chunk is never lost. */
function EditorStandIn({ props, early, setEarly }: { props: EditorEngineProps; early: Early; setEarly: (next: (early: Early) => Early) => void }) {
  return (
    <div
      id={props.id}
      className="rich-content"
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
      {props.initial ? (
        <Adf node={props.initial} issueKey={props.issueKey} attachments={props.attachments} />
      ) : (
        !early.text && <p className="text-fg-4">{props.placeholder}</p>
      )}
      {early.text && <p>{early.text}</p>}
    </div>
  );
}

function LoadedEditor(props: EditorEngineProps) {
  // Chosen once per editor, so a later load never swaps the component (and remounts it) mid-edit.
  const [Component] = useState(() => loaded ?? Editor);
  const [early, setEarly] = useState<Early>({ focus: false, text: "", submit: false });
  return (
    <Suspense fallback={<EditorStandIn props={props} early={early} setEarly={setEarly} />}>
      <Component {...props} autoFocus={props.autoFocus || early.focus} early={early} />
    </Suspense>
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
/** Persistent document content with formatting above a text selection. */
export function DocumentBodyEditor(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="document" />;
}
/** Comment/reply composer with footer formatting and a required, icon-only submit. */
export function CommentComposer(props: RichEditorProps) {
  return <LoadedEditor {...props} presentation="comment" />;
}
