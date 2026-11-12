/** Formats that can be rendered inline without creating an active HTML/SVG document. */
export const inlineMediaTypes =
  /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+)$/i;
export function localFileBlob(file: Blob): Blob {
  return inlineMediaTypes.test(file.type)
    ? file
    : new Blob([file], { type: "application/octet-stream" });
}
