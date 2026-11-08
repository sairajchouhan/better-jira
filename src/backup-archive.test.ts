import { expect, test } from "bun:test";
import { backupArchive } from "./backup-archive";
test("binary backups retain the manifest and file bytes without reading blobs into JS arrays", async () => {
  class NativeBlob extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> {
      throw new Error("Do not buffer the source file");
    }
  }
  const source = new NativeBlob([new Uint8Array(2 * 1024 * 1024).fill(37)], { type: "video/mp4" });
  const archive = backupArchive({ version: 2, state: { version: 1, changes: [] } }, [
    { id: "local-file", blob: source },
  ]);
  const bytes = new Uint8Array(await archive.arrayBuffer()),
    decoder = new TextDecoder();
  expect(decoder.decode(bytes.slice(0, 13))).toBe("manifest.json");
  const size = parseInt(decoder.decode(bytes.slice(124, 136)), 8),
    manifest = JSON.parse(decoder.decode(bytes.slice(512, 512 + size)));
  expect(manifest.files).toEqual([
    { id: "local-file", type: "video/mp4", size: source.size, path: "files/local-file" },
  ]);
  const next = 512 + Math.ceil(size / 512) * 512;
  expect(decoder.decode(bytes.slice(next, next + 16))).toBe("files/local-file");
  expect(bytes[next + 512]).toBe(37);
  expect(bytes[next + 512 + source.size - 1]).toBe(37);
  expect(archive.size).toBeLessThan(source.size + 4096);
  expect(bytes.slice(-1024)).toEqual(new Uint8Array(1024));
});

test("named files extract with a readable extension without allowing path traversal or overlong headers", async () => {
  const file = new File(["bytes"], "../../unsafe/very long " + "x".repeat(160) + ".mp4", {
    type: "video/mp4",
  });
  const archive = backupArchive({ version: 2 }, [{ id: "local-id", blob: file }]),
    bytes = new Uint8Array(await archive.arrayBuffer()),
    decoder = new TextDecoder();
  const size = parseInt(decoder.decode(bytes.slice(124, 136)), 8),
    manifest = JSON.parse(decoder.decode(bytes.slice(512, 512 + size)));
  expect(manifest.files[0].path).toStartWith("files/local-id/");
  expect(manifest.files[0].path).toEndWith(".mp4");
  expect(manifest.files[0].path).not.toContain("..");
  expect(manifest.files[0].path.length).toBeLessThanOrEqual(100);
});
