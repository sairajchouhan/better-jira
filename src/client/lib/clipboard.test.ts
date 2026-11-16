import { afterEach, expect, test } from "bun:test";
import {
  copyImageAsync,
  copyLinkedTexts,
  copyRichText,
  copyText,
  copyTextAsync,
  copyWithEvent,
  dragData,
  dragItem,
  formatLinkedText,
  linkedTextsHTML,
  linkedTextsMarkdown,
  stripMarkdownLinks,
} from "./clipboard";
import { trackModifiers } from "./modifier-keys";
import { deferred, fakeClipboard } from "@/client/test/fake-clipboard";

let fake: ReturnType<typeof fakeClipboard> | undefined;
afterEach(() => {
  fake?.restore();
  fake = undefined;
  delete (globalThis as { document?: unknown }).document;
});

test("a linked text is Linear's anchor closed by a zero-width space, escaped, with Markdown links stripped", () => {
  expect(formatLinkedText("Fix [the menu](https://x.test/a) <b>", "KAN-7")).toBe("KAN-7: Fix the menu <b>");
  expect(formatLinkedText("Plain")).toBe("Plain");
  expect(stripMarkdownLinks("see [docs](<https://x.test/a b>) and [x](y)")).toBe("see docs and x");
  expect(linkedTextsHTML(["KAN-7: a <b> [c](d)"], ["https://x.test/browse/KAN-7"])).toBe(
    '<a href="https://x.test/browse/KAN-7">KAN-7: a &lt;b&gt; c&#8203;</a>',
  );
  expect(linkedTextsMarkdown(["KAN-7: Fix [menu]"], ["https://x.test/browse/KAN-7"])).toBe(
    "[KAN-7: Fix \\[menu\\]](https://x.test/browse/KAN-7)",
  );
});

test("several linked texts are a list of links, and texts without links make nothing", () => {
  expect(linkedTextsHTML(["A-1", "A-2"], ["https://x/1", "https://x/2"])).toBe(
    '<ul><li><a href="https://x/1">A-1</a></li><li><a href="https://x/2">A-2</a></li></ul>',
  );
  expect(linkedTextsMarkdown(["A-1", "A-2"], ["https://x/1", "https://x/2"])).toBe("- [A-1](https://x/1)\n- [A-2](https://x/2)");
  expect(linkedTextsHTML([], [])).toBeUndefined();
  expect(linkedTextsMarkdown(["A-1"], [])).toBeUndefined();
});

test("a link goes on the clipboard as HTML and Markdown at once", async () => {
  fake = fakeClipboard();
  await copyLinkedTexts(["KAN-7: Fix"], ["https://x.test/browse/KAN-7"]);
  expect(fake.writes).toEqual([
    {
      "text/html": '<a href="https://x.test/browse/KAN-7">KAN-7: Fix&#8203;</a>',
      "text/plain": "[KAN-7: Fix](https://x.test/browse/KAN-7)",
    },
  ]);
});

test("without ClipboardItem a link falls back to its Markdown as plain text", async () => {
  fake = fakeClipboard({ rich: false });
  await copyLinkedTexts(["KAN-7: Fix"], ["https://x.test/browse/KAN-7"]);
  expect(fake.calls).toEqual(["writeText"]);
  expect(fake.writes).toEqual([{ "text/plain": "[KAN-7: Fix](https://x.test/browse/KAN-7)" }]);
});

/** A document whose execCommand("copy") fires `copy` at the listeners it was given, recording what they set. */
function copyEventDocument() {
  const set: Record<string, string> = {};
  const listeners = new Set<(e: Event) => void>();
  const doc = {
    addEventListener: (_: string, l: (e: Event) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: Event) => void) => listeners.delete(l),
    execCommand: () => {
      const event = Object.assign(new Event("copy"), { clipboardData: { setData: (t: string, v: string) => (set[t] = v) } });
      for (const l of listeners) l(event);
      return true;
    },
  };
  return { doc, set, listeners };
}

test("a refused clipboard write falls back to the copy event with every format", async () => {
  fake = fakeClipboard({ refuse: true });
  const { doc, set, listeners } = copyEventDocument();
  (globalThis as { document?: unknown }).document = doc;
  await copyRichText("<a>x</a>", "[x](y)");
  expect(set).toEqual({ "text/plain": "[x](y)", "text/html": "<a>x</a>" });
  await copyText("plain");
  expect(set["text/plain"]).toBe("plain");
  expect(listeners.size).toBe(0);
  expect(copyWithEvent({ ...doc, execCommand: () => { throw new Error("no"); } }, { "text/plain": "x" })).toBe(false);
});

test("an async copy starts its clipboard write before its text arrives", async () => {
  fake = fakeClipboard();
  const text = deferred<string>();
  const done = copyTextAsync(text.promise);
  // The write is under way inside the click, though the text hasn't arrived.
  expect(fake.calls).toEqual(["write"]);
  expect(fake.writes).toEqual([]);
  text.resolve("# KAN-7");
  expect(await done).toBe("copied");
  expect(fake.writes).toEqual([{ "text/plain": "# KAN-7" }]);
});

test("an older async copy that resolves after a newer copy writes nothing", async () => {
  fake = fakeClipboard();
  const slow = deferred<string>();
  const older = copyTextAsync(slow.promise);
  await copyText("newer");
  slow.resolve("older");
  expect(await older).toBe("cancelled");
  expect(fake.writes).toEqual([{ "text/plain": "newer" }]);
});

test("without ClipboardItem an async copy waits for its text, and a newer copy still wins", async () => {
  fake = fakeClipboard({ rich: false });
  expect(await copyTextAsync(Promise.resolve("first"))).toBe("copied");
  const slow = deferred<string>();
  const older = copyTextAsync(slow.promise);
  await copyText("newer");
  slow.resolve("older");
  expect(await older).toBe("cancelled");
  expect(fake.writes).toEqual([{ "text/plain": "first" }, { "text/plain": "newer" }]);
});

test("an async copy whose text fails rejects", async () => {
  fake = fakeClipboard();
  await expect(copyTextAsync(Promise.reject(new Error("load failed")))).rejects.toThrow("load failed");
});

test("an image copy starts at once and gives way to a newer copy", async () => {
  fake = fakeClipboard();
  const png = deferred<Blob>();
  const older = copyImageAsync(png.promise);
  expect(fake.calls).toEqual(["write"]);
  await copyText("newer");
  png.resolve(new Blob(["png"], { type: "image/png" }));
  await older;
  expect(fake.writes).toEqual([{ "text/plain": "newer" }]);
});

test("a dragged row carries its link as a URI list, plain text and an anchor, beside the app's own type", () => {
  expect(dragData("https://x.test/browse/KAN-7")).toEqual({
    "text/uri-list": "https://x.test/browse/KAN-7",
    "text/plain": "https://x.test/browse/KAN-7",
    "text/html": '<a href="https://x.test/browse/KAN-7">https://x.test/browse/KAN-7</a>',
  });
  expect(dragData("https://x.test/a b")["text/html"]).toBe('<a href="https://x.test/a%20b">https://x.test/a b</a>');
  expect(dragItem("application/x-test", "KAN-7", "https://x.test/browse/KAN-7")).toEqual({
    ...dragData("https://x.test/browse/KAN-7"),
    "application/x-test": "KAN-7",
  });
});

test("the modifier tracker follows keys and pointer presses, and forgets them on blur", () => {
  const target = new EventTarget();
  const state = trackModifiers(target);
  const key = (type: string, altKey: boolean) => Object.assign(new Event(type), { altKey, metaKey: false, ctrlKey: false, shiftKey: false });
  target.dispatchEvent(key("keydown", true));
  expect(state.altKey).toBe(true);
  target.dispatchEvent(key("keyup", false));
  expect(state.altKey).toBe(false);
  target.dispatchEvent(key("pointerdown", true));
  expect(state.altKey).toBe(true);
  target.dispatchEvent(new Event("blur"));
  expect(state.altKey).toBe(false);
});

test("BJ-379: the tracker tells its subscribers when ⌥ goes down or up, and only then, so ⌥ names redraw", () => {
  const target = new EventTarget();
  const state = trackModifiers(target);
  let calls = 0;
  const stop = state.subscribe(() => calls++);
  const key = (type: string, altKey: boolean, shiftKey = false) =>
    Object.assign(new Event(type), { altKey, metaKey: false, ctrlKey: false, shiftKey });
  target.dispatchEvent(key("keydown", true));
  target.dispatchEvent(key("keydown", true, true));
  expect(calls).toBe(1);
  target.dispatchEvent(new Event("blur"));
  expect(calls).toBe(2);
  stop();
  target.dispatchEvent(key("keydown", true));
  expect(calls).toBe(2);
});
