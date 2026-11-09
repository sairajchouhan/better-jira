import { expect, test } from "bun:test";
import {
  cleanDraftUploads,
  noteDraftUploads,
  readDraftUploads,
  settleDraftUploads,
  SETTLE_MS,
} from "./draft-uploads";

const media = (id: string) => ({
  type: "doc",
  version: 1,
  content: [{ type: "mediaSingle", content: [{ type: "media", attrs: { id, type: "file" } }] }],
});

test("R2-comments-D5: orphaned composer uploads leave Jira on a later load, and their slots go", async () => {
  const slots = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return slots.size;
      },
      key: (i: number) => [...slots.keys()][i] ?? null,
      getItem: (key: string) => slots.get(key) ?? null,
      setItem: (key: string, value: string) => slots.set(key, value),
      removeItem: (key: string) => slots.delete(key),
    },
  });
  try {
    const file = (name: string) => new File(["x".repeat(name.length)], name);
    // dropped: uploaded, then the draft dropped it; sent: a comment shows it; drafted: a saved draft still holds it;
    // cut: a reload cut its upload off, so only Jira knows its id.
    const ids = noteDraftUploads("ns", "KAN-1", [
      file("dropped.png"),
      file("sent.png"),
      file("drafted.png"),
      file("cut.png"),
    ]);
    settleDraftUploads("ns", ids.slice(0, 3), ["l-dropped", "l-sent", "l-drafted"]);
    for (const [local, id] of [
      ["l-dropped", "101"],
      ["l-sent", "102"],
      ["l-drafted", "103"],
    ])
      slots.set(
        `better-jira:upload:KAN-1:${local}`,
        JSON.stringify({ attachment: { id, mediaId: `m-${id}` }, collection: "c" }),
      );
    slots.set("better-jira:comment-draft:ns:KAN-1", JSON.stringify(media("l-drafted")));
    const removed: string[] = [];
    const jira = {
      full: async () => ({
        fields: {
          comment: { comments: [{ id: "1", body: media("m-102") }] },
          attachment: [
            { id: "101", filename: "dropped.png", size: 11 },
            { id: "102", filename: "sent.png", size: 8 },
            { id: "103", filename: "drafted.png", size: 11 },
            { id: "104", filename: "cut.png", size: 7, created: new Date().toISOString() },
          ],
        },
      }),
      remove: async (_key: string, id: string) => void removed.push(id),
    };
    // Too new: another tab may still be placing these files.
    await cleanDraftUploads("ns", "[]", jira);
    expect(removed).toEqual([]);
    await cleanDraftUploads("ns", "[]", jira, Date.now() + SETTLE_MS);
    expect(removed.sort()).toEqual(["101", "104"]);
    expect([...slots.keys()].filter((k) => k.startsWith("better-jira:upload:"))).toEqual([
      "better-jira:upload:KAN-1:l-drafted",
    ]);
    expect(readDraftUploads("ns").map((e) => e.name)).toEqual(["drafted.png"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});
