import { lazy, Suspense, useState } from "react";
import { Adf } from "./adf";
import type { EditorEngineProps, RichEditorProps } from "./rich-editor";

let loaded: typeof import("./rich-editor").RichEditor | undefined;
const load = () =>
  import("./rich-editor").then((module) => ({ default: (loaded = module.RichEditor) }));
const Editor = lazy(load);
function LoadedEditor(props: EditorEngineProps) {
  // Chosen once per editor, so a later load never swaps the component (and remounts it) mid-edit.
  const [Component] = useState(() => loaded ?? Editor);
  return (
    <Suspense fallback={<div className="rich-content" aria-busy="true"><Adf node={props.initial || props.placeholder} issueKey={props.issueKey} attachments={props.attachments} /></div>}>
      <Component {...props} />
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
