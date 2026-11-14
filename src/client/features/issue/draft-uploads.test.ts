import { expect, test } from "bun:test";
import {
  cleanDraftUploads,
  noteDraftUploads,
  readDraftUploads,
  settleDraftUploads,
  SETTLE_MS,
  trackDraftUploads,
} from "./draft-uploads";
import { UploadRefused } from "@/client/state/jira-media";

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
    // cut: a reload cut its upload off, so only the server knows its id; lost: cut off before it reached Jira;
    // slow: still uploading when cleanup runs (sync review 8).
    const ids = noteDraftUploads("ns", "KAN-1", [
      file("dropped.png"),
      file("sent.png"),
      file("drafted.png"),
      file("cut.png"),
      file("lost.png"),
      file("slow.png"),
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
            // Someone else's file with the same name, size and time as the lost upload.
            { id: "105", filename: "lost.png", size: 8, created: new Date().toISOString() },
            ...(slowDone ? [{ id: "106", filename: "slow.png", size: 8 }] : []),
          ],
        },
      }),
      remove: async (_key: string, id: string) => void removed.push(id),
      // The server's record of what each upload made: the cut one reached Jira, the lost one didn't.
      uploaded: async (client: string) =>
        client === ids[3]
          ? { id: "104" }
          : client === ids[5]
            ? slowDone
              ? { id: "106" }
              : { pending: true }
            : undefined,
    };
    let slowDone = false;
    // Too new: another tab may still be placing these files.
    await cleanDraftUploads("ns", "[]", jira);
    expect(removed).toEqual([]);
    await cleanDraftUploads("ns", "[]", jira, Date.now() + SETTLE_MS);
    expect(removed.sort()).toEqual(["101", "104"]);
    expect([...slots.keys()].filter((k) => k.startsWith("better-jira:upload:"))).toEqual([
      "better-jira:upload:KAN-1:l-drafted",
    ]);
    expect(readDraftUploads("ns").map((e) => e.name)).toEqual(["drafted.png", "slow.png"]);
    // Once the slow upload lands, the next cleanup removes what it made.
    slowDone = true;
    await cleanDraftUploads("ns", "[]", jira, Date.now() + SETTLE_MS);
    expect(removed.sort()).toEqual(["101", "104", "106"]);
    expect(readDraftUploads("ns").map((e) => e.name)).toEqual(["drafted.png"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});

test("sync review 2-1: an upload matched by name and size after a lost answer is kept, never deleted", async () => {
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
    const ids = noteDraftUploads("ns2", "KAN-2", [
      new File(["ab"], "a.png"),
      new File(["cd"], "c.png"),
    ]);
    // a.png's answer arrived marked found; c.png's was cut off and only the server knows its found match.
    settleDraftUploads("ns2", ids.slice(0, 1), ["l-a"]);
    slots.set(
      "better-jira:upload:KAN-2:l-a",
      JSON.stringify({ attachment: { id: "201", mediaId: "m-201", found: true }, collection: "c" }),
    );
    const removed: string[] = [];
    const jira = {
      full: async () => ({
        fields: {
          comment: { comments: [] },
          attachment: [
            { id: "201", filename: "a.png", size: 2 },
            { id: "202", filename: "c.png", size: 2 },
          ],
        },
      }),
      remove: async (_key: string, id: string) => void removed.push(id),
      uploaded: async () => ({ id: "202", found: true }),
    };
    const { kept } = await cleanDraftUploads("ns2", "[]", jira, Date.now() + SETTLE_MS);
    expect(removed).toEqual([]);
    expect(kept.sort()).toEqual(["201", "202"]);
    expect(readDraftUploads("ns2")).toEqual([]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});

test("R3-comments-D1: an upload a reload cut off keeps its note, so the cleaner removes what the server made", async () => {
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
    const big = [new File(["x".repeat(8)], "big.bin")];
    // The reload aborts the send: fetch rejects with no answer, but the server still finishes the upload.
    const cut = trackDraftUploads("ns3", "KAN-3", big, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(cut).rejects.toThrow("Failed to fetch");
    const [entry] = readDraftUploads("ns3");
    expect(entry?.name).toBe("big.bin");
    const removed: string[] = [];
    await cleanDraftUploads(
      "ns3",
      "[]",
      {
        full: async () => ({ fields: { attachment: [{ id: "301", filename: "big.bin", size: 8 }] } }),
        remove: async (_key, id) => void removed.push(id),
        uploaded: async (client) => (client === entry?.id ? { id: "301" } : undefined),
      },
      Date.now() + SETTLE_MS,
    );
    expect(removed).toEqual(["301"]);
    expect(readDraftUploads("ns3")).toEqual([]);
    // A refusal answered by the server made nothing: its note goes at once.
    await expect(
      trackDraftUploads("ns3", "KAN-3", big, async () => {
        throw new UploadRefused("Too big");
      }),
    ).rejects.toThrow("Too big");
    expect(readDraftUploads("ns3")).toEqual([]);
    // A saved file keeps its note with its local id until the cleaner settles it.
    await trackDraftUploads("ns3", "KAN-3", big, async () => [{ id: "l-big" }]);
    expect(readDraftUploads("ns3").map((e) => e.local)).toEqual(["l-big"]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});
