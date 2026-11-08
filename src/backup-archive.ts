export type BackupFile = { id: string; blob: Blob };
const encoder = new TextEncoder();
function header(name: string, size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(512),
    text = (offset: number, value: string) => bytes.set(encoder.encode(value), offset);
  const octal = (offset: number, length: number, value: number) =>
    text(offset, value.toString(8).padStart(length - 1, "0") + "\0");
  text(0, name);
  octal(100, 8, 0o600);
  octal(108, 8, 0);
  octal(116, 8, 0);
  if (size < 8 ** 11) octal(124, 12, size);
  else {
    let remaining = BigInt(size);
    for (let i = 135; i >= 124; i--) {
      bytes[i] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    bytes[124]! |= 0x80;
  }
  octal(136, 12, Math.floor(Date.now() / 1000));
  bytes.fill(32, 148, 156);
  text(156, "0");
  text(257, "ustar\0");
  text(263, "00");
  const sum = bytes.reduce((total, byte) => total + byte, 0);
  text(148, sum.toString(8).padStart(6, "0") + "\0 ");
  return bytes;
}
/** Blob composition retains native file references; videos never become base64 strings or whole JS buffers. */
export function backupArchive(metadata: Record<string, unknown>, files: BackupFile[]): Blob {
  const entries = files.map(({ id, blob }) => {
    const prefix = `files/${encodeURIComponent(id)}`,
      name =
        typeof (blob as File).name === "string"
          ? (blob as File).name
              .split(/[\\/]/)
              .at(-1)!
              .replace(/[^a-zA-Z0-9._-]/g, "_")
              .replace(/^\.+/, "")
          : "";
    const limit = 100 - prefix.length - 1,
      extension = name.match(/\.[a-zA-Z0-9]{1,12}$/)?.[0] ?? "";
    const filename =
      name.length > limit ? name.slice(0, Math.max(0, limit - extension.length)) + extension : name;
    return { id, blob, path: name && limit > 16 ? `${prefix}/${filename}` : prefix };
  });
  if (
    entries.some((file) => [".", ".."].includes(file.id) || encoder.encode(file.path).length > 100)
  )
    throw new Error("An attachment identifier is too long to export");
  const manifest = new Blob(
    [
      JSON.stringify({
        ...metadata,
        files: entries.map(({ id, blob, path }) => ({
          id,
          type: blob.type,
          size: blob.size,
          path,
          ...(typeof (blob as File).name === "string" ? { name: (blob as File).name } : {}),
        })),
      }),
    ],
    { type: "application/json" },
  );
  const parts: BlobPart[] = [];
  for (const { path, blob } of [{ path: "manifest.json", blob: manifest }, ...entries]) {
    parts.push(header(path, blob.size), blob);
    const padding = (512 - (blob.size % 512)) % 512;
    if (padding) parts.push(new Uint8Array(padding));
  }
  parts.push(new Uint8Array(1024));
  return new Blob(parts, { type: "application/x-tar" });
}
