import { expect, test } from "bun:test";
import { attachmentSplit, storedMediaIds } from "./issue-attachments";

const media = (id: string, type = "media") => ({ type, attrs: { id, type: "file" } });
const doc = (...nodes: unknown[]) => ({
  type: "doc",
  version: 1,
  content: [{ type: "paragraph", content: nodes }],
});
const file = (id: string, mediaId?: string) => ({
  id,
  name: `${id}.png`,
  type: "image/png",
  size: 1,
  url: `/a/${id}`,
  ...(mediaId ? { mediaId } : {}),
});

test("attachments the description, a comment or a document shows are embedded; the rest are listed", () => {
  const attachments = [
    file("1", "m-desc"),
    file("2"),
    file("3", "m-comment"),
    file("4", "m-doc"),
    file("5", "m-revision"),
    file("6", "m-inline"),
  ];
  const { visible, embedded } = attachmentSplit(
    {
      attachments,
      resources: [
        {
          id: "d",
          kind: "document",
          title: "Doc",
          updated: "",
          body: doc(media("m-doc")),
          history: [{ body: doc(media("m-revision")) }],
        } as any,
      ],
    },
    {
      description: doc(media("m-desc"), media("6", "mediaInline")),
      comment: { comments: [{ body: doc(media("m-comment")) }] },
    },
  );
  expect(visible.map((a) => a.id)).toEqual(["2"]);
  expect(embedded.map((a) => a.id)).toEqual(["1", "3", "4", "5", "6"]);
});

test("before the issue loads only documents embed attachments", () => {
  const split = attachmentSplit({ attachments: [file("1", "m")] }, undefined);
  expect(split).toEqual({ visible: [file("1", "m")], embedded: [] });
  expect(attachmentSplit({}, undefined)).toEqual({ visible: [], embedded: [] });
});

// The two traversals differ on purpose: Jira's ADF nests nodes under `content` only, while stored drafts wrap their
// documents in other keys. Reading ADF through every key would also pick up a media node under `attrs` or `marks`.
test("issue documents are read through content; stored drafts through every key", () => {
  const odd = { type: "doc", content: [], attrs: { cover: media("under-attrs") } };
  expect(
    attachmentSplit({ attachments: [file("under-attrs")] }, { description: odd }).visible,
  ).toEqual([file("under-attrs")]);
  expect([...storedMediaIds(odd)]).toEqual(["under-attrs"]);
  const drafts = [
    { doc: doc(media("description-draft")), base: JSON.stringify(doc(media("base-is-text"))) },
    { title: "t", body: doc(media("document-draft")) },
    doc(media("comment-draft")),
  ];
  expect([...storedMediaIds(drafts)]).toEqual([
    "description-draft",
    "document-draft",
    "comment-draft",
  ]);
  expect(
    attachmentSplit({ attachments: [file("description-draft")] }, { description: drafts[0] })
      .embedded,
  ).toEqual([]);
});
