import { type ImageCrop } from "@/shared/issue-model";
import { copyImageAsync } from "@/client/lib/clipboard";

/** An image's bytes, read the way its URL allows: our own API with the session cookie, anything else anonymously. */
async function read(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    credentials: url.startsWith("/api/") ? "same-origin" : "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new Error("Could not read the image");
  return response.blob();
}

/** The image at `url` as PNG, for the clipboard (which only takes PNG) and for checking that an external source can be read. */
export async function imageBlob(url: string, signal?: AbortSignal) {
  const bitmap = await createImageBitmap(await read(url, signal));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

export async function copyMediaImage(url: string) {
  await copyImageAsync(imageBlob(url));
}

type Decoded = { bitmap: ImageBitmap; type: string };
let decoded: { url: string; image: Promise<Decoded> } | undefined;

/**
 * The image at `url`, fetched and decoded once, as Linear's crop editor does when it opens (XVe.load), so Save only cuts
 * and encodes. Holds the last image asked for.
 */
export function decodeImage(url: string): Promise<Decoded> {
  if (decoded?.url === url) return decoded.image;
  const image = read(url).then(async (blob) => ({ bitmap: await createImageBitmap(blob), type: blob.type }));
  const entry = { url, image };
  decoded = entry;
  // A failed read is tried again next time.
  image.catch(() => {
    if (decoded === entry) decoded = undefined;
  });
  return image;
}

/** Lets go of the decoded image at `url` once nothing will cut it (the crop editor closed); a crop under way keeps its copy. */
export function forgetImage(url: string) {
  if (decoded?.url === url) decoded = undefined;
}

/** Linear's QVe: a cropped image's longer side is at most 4096px. */
export const CROP_MAX_SIDE = 4096;

/** Where `crop` (fractions of the image) falls in a `width`×`height` image, and the size it is saved at (Linear's toPixels and $Ve). */
export function cropRect(width: number, height: number, crop: ImageCrop) {
  const source = {
      x: Math.round(crop.x * width),
      y: Math.round(crop.y * height),
      width: Math.max(1, Math.round(crop.width * width)),
      height: Math.max(1, Math.round(crop.height * height)),
    },
    scale = Math.min(1, CROP_MAX_SIDE / Math.max(source.width, source.height));
  return {
    source,
    size: {
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
    },
  };
}

/** Linear's nHe and rHe: a crop keeps a JPEG or WebP source's type, at quality 0.92; anything else becomes PNG. */
export function cropType(sourceType: string) {
  const type = sourceType === "image/jpeg" || sourceType === "image/webp" ? sourceType : "image/png";
  return { type, extension: type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png" };
}

/**
 * The part of the image at `url` inside `crop`, encoded, without holding the main thread (Linear's ZVe.createFile): the
 * cut and resize run in createImageBitmap, the encode in OffscreenCanvas.convertToBlob.
 */
export async function cropImage(url: string, crop: ImageCrop) {
  const { bitmap, type: sourceType } = await decodeImage(url),
    { source, size } = cropRect(bitmap.width, bitmap.height, crop),
    { type } = cropType(sourceType),
    piece = await createImageBitmap(bitmap, source.x, source.y, source.width, source.height, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
  try {
    const canvas = new OffscreenCanvas(size.width, size.height);
    canvas.getContext("2d")!.drawImage(piece, 0, 0);
    return await canvas.convertToBlob({ type, quality: type === "image/png" ? undefined : 0.92 });
  } finally {
    piece.close();
  }
}

/** The file a crop of `name` saves as: its name with "-cropped" and the extension of what it was encoded as. */
export function croppedFile(blob: Blob, name: string) {
  const { extension } = cropType(blob.type);
  return new File([blob], `${name.replace(/\.[^.]+$/, "")}-cropped.${extension}`, { type: blob.type });
}
