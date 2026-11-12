import { expect, test } from "bun:test";
import { copyCommentDocument } from "./comment-copy";
import { normalizeDocument } from "@/shared/document";
test("copying remote media saves bytes once and preserves rich content, geometry and external images", async () => {
  const original = globalThis.fetch,
    reads: string[] = [],
    saved: File[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    reads.push(url);
    return url.includes("/media/")
      ? Response.json({
          id: "7",
          name: "test.mp4",
          url: "/api/issues/TEST-2/attachments/7",
          type: "video/mp4",
          size: 5,
        })
      : new Response("bytes", { headers: { "Content-Type": "video/mp4" } });
  }) as typeof fetch;
  try {
    const media = {
      type: "media",
      attrs: { id: "remote-uuid", type: "file", width: 480, height: 160 },
    };
    const body = normalizeDocument({
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Bold", marks: [{ type: "strong" }] }],
        },
        {
          type: "mediaSingle",
          attrs: { layout: "center", width: 80, widthType: "percentage" },
          content: [media],
        },
        { type: "mediaSingle", content: [media] },
        {
          type: "mediaSingle",
          content: [
            {
              type: "media",
              attrs: { id: "external-id", type: "external", url: "https://example.com/image.png" },
            },
          ],
        },
      ],
    });
    const result = await copyCommentDocument(body, "TEST-2", [], async (files) => {
      saved.push(...files);
      return files.map((file) => ({
        id: "local-id",
        name: file.name,
        type: file.type,
        size: file.size,
        url: "blob:local",
      }));
    });
    expect(reads).toEqual([
      "/api/issues/TEST-2/media/remote-uuid",
      "/api/issues/TEST-2/attachments/7",
    ]);
    expect(saved).toHaveLength(1);
    expect(await saved[0]!.text()).toBe("bytes");
    expect(result.attachments).toHaveLength(1);
    expect(result.body.content?.[1]?.content?.[0]?.attrs?.id).toBe("local-id");
    // R2-comments-D3: a copied file is local media, so the new issue uploads it and Jira gets its media id.
    expect(result.body.content?.[1]?.content?.[0]?.attrs?.collection).toBe("local");
    expect(result.body.content?.[1]?.attrs).toEqual({
      layout: "center",
      width: 80,
      widthType: "percentage",
    });
    expect(result.body.content?.[0]).toEqual(body.content?.[0]);
    expect(result.body.content?.[3]).toEqual(body.content?.[3]);
    expect(body.content?.[1]?.content?.[0]?.attrs?.id).toBe("remote-uuid");
  } finally {
    globalThis.fetch = original;
  }
});
test("comment copying rejects foreign attachment sources and missing local files", async () => {
  const original = globalThis.fetch,
    reads: string[] = [];
  const body = normalizeDocument({
    type: "doc",
    version: 1,
    content: [
      { type: "mediaSingle", content: [{ type: "media", attrs: { id: "file-id", type: "file" } }] },
    ],
  });
  globalThis.fetch = (async (input) => {
    reads.push(String(input));
    return Response.json({
      id: "7",
      name: "secret.txt",
      url: "/api/issues/OTHER-1/attachments/7",
      type: "text/plain",
      size: 5,
    });
  }) as typeof fetch;
  try {
    await expect(copyCommentDocument(body, "TEST-2", [], async () => [])).rejects.toThrow(
      "Invalid attachment source",
    );
    expect(reads).toHaveLength(1);
    await expect(
      copyCommentDocument(
        body,
        "TEST-2",
        [
          {
            id: "file-id",
            name: "missing.txt",
            url: "",
            type: "text/plain",
            size: 5,
            missing: true,
          },
        ],
        async () => [],
      ),
    ).rejects.toThrow("unavailable");
    expect(reads).toHaveLength(1);
  } finally {
    globalThis.fetch = original;
  }
});
