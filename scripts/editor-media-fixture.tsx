/** Isolated prop-update fixture. This entry is served only by the disposable browser test server. */
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { RichEditor } from "../src/rich-editor";
import type { Attachment } from "../src/attachment-media";
import "../src/index.css";
const document = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "mediaSingle",
      attrs: { layout: "center" },
      content: [
        {
          type: "media",
          attrs: {
            type: "file",
            id: "11111111-1111-4111-8111-111111111111",
            collection: "",
            width: 480,
            height: 160,
          },
        },
      ],
    },
    {
      type: "mediaSingle",
      attrs: { layout: "center", width: 160, widthType: "pixel" },
      content: [
        {
          type: "media",
          attrs: {
            type: "file",
            id: "local-context-file",
            collection: "better-jira",
            width: 320,
            height: 480,
          },
        },
      ],
    },
  ],
};
function Fixture() {
  const [issueKey, setIssueKey] = useState("TEST-1"),
    [attachments, setAttachments] = useState<Attachment[]>([]);
  return (
    <div data-key="editor-props" className="mx-auto max-w-[640px] p-5">
      <button
        onClick={async () => {
          const blob = await (await fetch("/api/issues/TEST-1/attachments/102")).blob();
          setAttachments([
            {
              id: "local-context-file",
              name: "Updated local image",
              type: "image/png",
              size: blob.size,
              url: URL.createObjectURL(blob),
            },
          ]);
        }}
      >
        Load local attachment
      </button>
      <button className="ml-4" onClick={() => setIssueKey("TEST-2")}>
        Switch issue context
      </button>
      <RichEditor
        id="context-editor"
        initial={document}
        issueKey={issueKey}
        attachments={attachments}
      />
    </div>
  );
}
createRoot(globalThis.document.getElementById("root")!).render(<Fixture />);
