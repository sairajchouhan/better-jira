import { lazy, Suspense, useState } from "react";
import type { RichEditorProps } from "./rich-editor";

let loaded: typeof import("./rich-editor").RichEditor | undefined;
const load = () =>
  import("./rich-editor").then((module) => ({ default: (loaded = module.RichEditor) }));
const Editor = lazy(load);
// Fetched once the page is idle, so the first composer opens without "Loading editor…".
if (typeof window !== "undefined")
  (window.requestIdleCallback ?? ((run: () => void) => setTimeout(run, 200)))(() => void load());
export function RichEditor(props: RichEditorProps) {
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
