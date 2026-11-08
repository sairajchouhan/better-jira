import { lazy, Suspense } from "react";
import type { RichEditorProps } from "./rich-editor";
const Editor = lazy(() =>
  import("./rich-editor").then((module) => ({ default: module.RichEditor })),
);
export function RichEditor(props: RichEditorProps) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-3 text-fg-3">
          Loading editor…
        </p>
      }
    >
      <Editor {...props} />
    </Suspense>
  );
}
