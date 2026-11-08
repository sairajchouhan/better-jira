import { expect, test } from "bun:test";
import { safeExternalImage, mediaDimensions } from "./media-layout";

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
