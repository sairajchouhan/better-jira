import { expect, test } from "bun:test";
import { downloadURL, safeExternalImage, mediaDimensions } from "./media-layout";

test("external media only accepts HTTPS images without URL credentials", () => {
  expect(safeExternalImage("https://images.example.test/image.png")).toBe(
    "https://images.example.test/image.png",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "http://example.test/image.png",
    "https://user:password@example.test/image.png",
    "//example.test/image.png",
  ])
    expect(safeExternalImage(url)).toBeUndefined();
});
test("invalid dimensions cannot create infinite or negative media frames", () => {
  for (const attrs of [
    { width: 0, height: 10 },
    { width: -1, height: 10 },
    { width: "bad", height: 10 },
    { width: 10, height: Infinity },
  ])
    expect(mediaDimensions({ type: "media", attrs })).toBeUndefined();
  expect(
    mediaDimensions({
      type: "mediaSingle",
      content: [{ type: "media", attrs: { width: 480, height: 160 } }],
    }),
  ).toEqual({ width: 480, height: 160 });
});

test("local media links address the issue attachment rather than a transient blob URL", async () => {
  const { attachmentLink } = await import("./media-layout");
  expect(
    attachmentLink(
      { id: "local-file", url: "blob:http://localhost/ephemeral" },
      "http://localhost/?board=1&issue=TEST-2",
    ),
  ).toBe("http://localhost/?board=1&issue=TEST-2#attachment-local-file");
  expect(
    attachmentLink(
      { id: "102", url: "/api/issues/TEST-2/attachments/102" },
      "http://localhost/?issue=TEST-2",
    ),
  ).toBe("http://localhost/api/issues/TEST-2/attachments/102");
});

test("download URLs preserve existing API query parameters and external URLs", () => {
  expect(downloadURL("/api/issues/TEST-2/attachments/101?version=2")).toBe("/api/issues/TEST-2/attachments/101?version=2&download=1");
  expect(downloadURL("/api/issues/TEST-2/attachments/101")).toBe("/api/issues/TEST-2/attachments/101?download=1");
  expect(downloadURL("https://example.com/file?version=2")).toBe("https://example.com/file?version=2");
  expect(downloadURL("blob:local-file")).toBe("blob:local-file");
});

test("BJ-54: dragging an image's width handle gives Jira's percentage width", async () => {
  const { dragWidth, resizedMedia } = await import("./media-layout");
  // A centred 400px image in an 800px column grows on both sides: 50px right makes it 500px.
  expect(dragWidth(400, 50, "right", "center", 800)).toBe(63);
  expect(dragWidth(400, 50, "left", undefined, 800)).toBe(38);
  expect(dragWidth(400, 50, "right", "align-start", 800)).toBe(56);
  expect(dragWidth(400, -1000, "right", "center", 800)).toBe(10);
  expect(dragWidth(400, 1000, "right", "center", 800)).toBe(100);
  const media = { type: "mediaSingle", attrs: { layout: "wide", widthType: "pixel", width: 900 }, content: [] };
  expect(resizedMedia(media, 60)).toEqual({ type: "mediaSingle", attrs: { layout: "center", width: 60 }, content: [] });
  expect(resizedMedia({ type: "mediaSingle", content: [] }, 40).attrs).toEqual({ layout: "center", width: 40 });
});
