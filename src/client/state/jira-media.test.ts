import { type Issue } from "@/shared/issue-model";
import { test, expect } from "bun:test";
import { opsFor, mergeOps } from "@/shared/jira-ops";
import { rewriteDocuments } from "./jira-media";

const issue = {
  key: "KAN-1",
  boards: [1],
  summary: "Test",
  status: "1",
  labels: [],
  assignee: null,
  updated: "",
  comments: 0,
  resolved: null,
} as Issue;
test("watcher and attachment diffs reverse for undo and retain distinct operations", () => {
  const after = {
    ...issue,
    watchers: [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ],
    attachments: [{ id: "local", name: "image.png", url: "blob:test", type: "image/png", size: 1 }],
  };
  const ops = opsFor({ issue }, { issue: after }, new Map());
  expect(ops).toEqual([
    { op: "watcher", id: "a", add: true },
    { op: "watcher", id: "b", add: true },
    { op: "attachment.add", id: "local", name: "image.png" },
  ]);
  expect(opsFor({ issue: after }, { issue }, new Map())).toEqual([
    { op: "watcher", id: "a", add: false },
    { op: "watcher", id: "b", add: false },
    { op: "attachment.delete", id: "local" },
  ]);
  expect(mergeOps([], ops)).toEqual(ops);
  expect(mergeOps(ops, [{ op: "watcher", id: "a", add: false }])).toEqual([
    { op: "watcher", id: "a", add: false },
    ...ops.slice(1),
  ]);
  expect(
    mergeOps(
      [{ op: "attachment.delete", id: "local" }],
      [{ op: "attachment.add", id: "local", name: "image.png" }],
    ),
  ).toEqual([]);
});
test("rewrites documents nested anywhere in ops without mutating nodes or external media", async () => {
  const media = {
      type: "media",
      attrs: { id: "local", type: "file", collection: "local", width: 10 },
    },
    remote = { type: "media", attrs: { id: "remote", collection: "jira-1", type: "file" } };
  const doc = {
    type: "doc",
    version: 1,
    content: [{ type: "mediaSingle", attrs: { layout: "center" }, content: [media, remote] }],
  };
  const ops = [
    { op: "fields", fields: { description: doc } },
    { op: "comment.edit", id: "2", body: doc },
    { other: media },
  ];
  let calls = 0;
  const result = await rewriteDocuments(ops, async (id) => {
    expect(id).toBe("local");
    calls++;
    return { id: "uuid", collection: "jira-100" };
  });
  expect(calls).toBe(2);
  expect((result[0] as any).fields.description.content[0].content[0].attrs).toEqual({
    id: "uuid",
    collection: "jira-100",
    type: "file",
    width: 10,
  });
  expect((result[1] as any).body.content[0].content[1]).toEqual(remote);
  expect(result[2]).toEqual({ other: media });
  expect(media.attrs.id).toBe("local");
});

test("R1-D30: an issue gone from Jira takes its upload slots with it", async () => {
  const { settleUploads } = await import("./jira-media");
  const slots = new Map<string, string>([
    ["better-jira:upload:KAN-9:local-1", JSON.stringify({ attachment: { id: "10001" } })],
  ]);
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
    settleUploads("KAN-9", null);
    expect([...slots.keys()]).toEqual([]);
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete (globalThis as any).localStorage;
  }
});
