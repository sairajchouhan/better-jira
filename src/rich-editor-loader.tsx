import { lazy, Suspense, useState } from "react";
import type { EditorEngineProps, RichEditorProps } from "./rich-editor";

let loaded: typeof import("./rich-editor").RichEditor | undefined;
const load = () =>
  import("./rich-editor").then((module) => ({ default: (loaded = module.RichEditor) }));
const Editor = lazy(load);
// Fetched once the page is idle, so the first composer opens without "Loading editor…".
if (typeof window !== "undefined")
  (window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(() => void load());
function LoadedEditor(props: EditorEngineProps) {
  // Chosen once per editor, so a later load never swaps the component (and remounts it) mid-edit.
  const [Component] = useState(() => loaded ?? Editor);
  return (
    <Suspense
      fallback={
        <p role="status" className="p-3 text-fg-3">
          Loading editor…
        </p>
      }
    >
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
