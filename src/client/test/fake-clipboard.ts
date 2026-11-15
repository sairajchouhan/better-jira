/**
 * A stand-in for the async clipboard API: `navigator.clipboard` and, unless `rich` is false, `ClipboardItem`. `calls` records
 * each call as it is made (before any data resolves); `writes` holds what reached the clipboard, by format.
 */
export function fakeClipboard({ rich = true, refuse = false }: { rich?: boolean; refuse?: boolean } = {}) {
  const g = globalThis as { ClipboardItem?: unknown };
  const calls: string[] = [];
  const writes: Record<string, string>[] = [];
  class FakeItem {
    constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
  }
  const denied = () => Object.assign(new Error("Document is not focused."), { name: "NotAllowedError" });
  const clipboard = {
    async writeText(text: string) {
      calls.push("writeText");
      if (refuse) throw denied();
      writes.push({ "text/plain": text });
    },
    async write(items: FakeItem[]) {
      calls.push("write");
      if (refuse) throw denied();
      const out: Record<string, string> = {};
      for (const item of items) for (const [type, data] of Object.entries(item.data)) out[type] = await (await data).text();
      writes.push(out);
    },
  };
  const hadItem = "ClipboardItem" in g,
    item = g.ClipboardItem;
  Object.defineProperty(globalThis.navigator, "clipboard", { value: clipboard, configurable: true });
  if (rich) g.ClipboardItem = FakeItem;
  else delete g.ClipboardItem;
  return {
    calls,
    writes,
    restore() {
      Reflect.deleteProperty(globalThis.navigator, "clipboard");
      if (hadItem) g.ClipboardItem = item;
      else delete g.ClipboardItem;
    },
  };
}

/** A promise and the functions that settle it. */
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
