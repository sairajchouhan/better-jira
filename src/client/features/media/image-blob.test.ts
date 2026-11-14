import { afterEach, beforeEach, expect, test } from "bun:test";
import { Glob } from "bun";
import { cropImage, cropRect, cropType, croppedFile, decodeImage, forgetImage } from "./image-blob";

const globals = globalThis as Record<string, unknown>,
  saved = { fetch: globals.fetch, createImageBitmap: globals.createImageBitmap, OffscreenCanvas: globals.OffscreenCanvas };
let calls: { fetch: string[]; bitmaps: unknown[][]; encodes: unknown[]; draws: number };

beforeEach(() => {
  calls = { fetch: [], bitmaps: [], encodes: [], draws: 0 };
  globals.fetch = async (url: string) => {
    calls.fetch.push(url);
    return new Response(new Blob(["bytes"], { type: url.endsWith(".jpg") ? "image/jpeg" : "image/png" }));
  };
  globals.createImageBitmap = async (...args: unknown[]) => {
    calls.bitmaps.push(args);
    return { width: 6000, height: 3000, close() {} };
  };
  globals.OffscreenCanvas = class {
    constructor(
      public width: number,
      public height: number,
    ) {}
    getContext() {
      return { drawImage: () => calls.draws++ };
    }
    async convertToBlob(options: { type: string; quality?: number }) {
      calls.encodes.push({ width: this.width, height: this.height, ...options });
      return new Blob(["out"], { type: options.type });
    }
  };
});
afterEach(() => {
  Object.assign(globals, saved);
  forgetImage("/api/a.png");
  forgetImage("/api/b.jpg");
});

test("a crop is cut and resized by createImageBitmap and encoded by OffscreenCanvas, off the main thread, as Linear's createFile", async () => {
  const blob = await cropImage("/api/a.png", { x: 0.5, y: 0, width: 0.5, height: 1 });
  // The second bitmap is the cut: the source's right half, 3000×3000, within Linear's 4096px.
  expect(calls.bitmaps[1]!.slice(1)).toEqual([
    3000,
    0,
    3000,
    3000,
    { resizeWidth: 3000, resizeHeight: 3000, resizeQuality: "high" },
  ]);
  expect(calls.encodes).toEqual([{ width: 3000, height: 3000, type: "image/png", quality: undefined }]);
  expect(blob.type).toBe("image/png");
});

test("the crop editor's early decode is the one Save uses: the image is read once", async () => {
  await decodeImage("/api/a.png");
  await cropImage("/api/a.png", { x: 0, y: 0, width: 0.5, height: 0.5 });
  await cropImage("/api/a.png", { x: 0, y: 0, width: 0.25, height: 0.25 });
  expect(calls.fetch).toEqual(["/api/a.png"]);
  forgetImage("/api/a.png");
  await cropImage("/api/a.png", { x: 0, y: 0, width: 0.5, height: 0.5 });
  expect(calls.fetch).toHaveLength(2);
});

test("a JPEG keeps its type at quality 0.92, as Linear's nHe", async () => {
  const blob = await cropImage("/api/b.jpg", { x: 0, y: 0, width: 1, height: 1 });
  expect(calls.encodes).toEqual([{ width: 4096, height: 2048, type: "image/jpeg", quality: 0.92 }]);
  expect(croppedFile(blob, "photo.jpeg").name).toBe("photo-cropped.jpg");
});

test("a crop's longer side is capped at 4096px and never collapses below a pixel", () => {
  expect(cropRect(8000, 4000, { x: 0, y: 0, width: 1, height: 1 }).size).toEqual({ width: 4096, height: 2048 });
  expect(cropRect(100, 100, { x: 0.25, y: 0.5, width: 0.001, height: 0.5 })).toEqual({
    source: { x: 25, y: 50, width: 1, height: 50 },
    size: { width: 1, height: 50 },
  });
});

test("only JPEG and WebP keep their type; anything else is saved as PNG", () => {
  expect(cropType("image/webp")).toEqual({ type: "image/webp", extension: "webp" });
  expect(cropType("image/gif")).toEqual({ type: "image/png", extension: "png" });
  expect(cropType("")).toEqual({ type: "image/png", extension: "png" });
});

test("the image viewer loads with the page: a lazy one waits out React's Suspense throttle before it shows", async () => {
  const lazyViewer = /import\(\s*["'][^"']*image-viewer["']\s*\)/;
  const offenders: string[] = [];
  for (const file of new Glob("src/client/**/*.{ts,tsx}").scanSync("."))
    if (lazyViewer.test(await Bun.file(file).text())) offenders.push(file);
  expect(offenders).toEqual([]);
});
