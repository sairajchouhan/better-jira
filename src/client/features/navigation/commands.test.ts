import { expect, test } from "bun:test";
import { Glob } from "bun";
import { COMPOSER_REVEAL_DELAY, focusComposer, focusNode } from "./commands";
import { FOCUS_AT_EVENT } from "@/client/features/editor/title-flow";

const source = async (pattern: string) => {
  const files: Record<string, string> = {};
  const root = `${import.meta.dir}/../..`;
  for await (const path of new Glob(pattern).scan(root))
    if (!path.includes(".test.")) files[path] = await Bun.file(`${root}/${path}`).text();
  return files;
};
const names = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]!);

test("every command a shortcut sends has a handler some owner registers", async () => {
  const files = await source("**/*.{ts,tsx}");
  const shortcuts = files["features/navigation/shortcuts.tsx"]!;
  // shortcuts.tsx imports `run` as `command`.
  expect(shortcuts).toContain('run as command } from "./commands"');
  const sent = new Set([
    ...names(shortcuts, /(?<![\w.])command\(\s*"([\w-]+)"/g),
    ...names(shortcuts, /(?<![\w.])post\(\s*"([\w-]+)"/g),
    // `focus(...)` sends the command it is given.
    ...names(shortcuts, /(?<![\w.])focus\(\s*"([\w-]+)"/g),
  ]);
  const handled = new Set(
    Object.values(files).flatMap((text) => names(text, /useCommand\(\s*"([\w-]+)"/g)),
  );
  const declared = names(files["features/navigation/commands.ts"]!, /^ {2}"([\w-]+)": \{ arg/gm);
  expect(sent.size).toBeGreaterThan(5);
  for (const name of sent) expect({ name, declared: declared.includes(name) }).toEqual({ name, declared: true });
  for (const name of declared) expect({ name, handled: handled.has(name) }).toEqual({ name, handled: true });
});

test("a posted command waits for its owner; a run one reaches only a mounted owner", async () => {
  const { handle, kept, post, run } = await import("./commands");
  expect(run("focus-find")).toBeUndefined();
  post("issue-options-start", "due");
  expect(kept("issue-options-start")).toBe("due");
  // An owner that declines leaves it waiting for the next.
  const declines = handle("issue-options-start", (start) => (start === "link" ? true : undefined));
  expect(kept("issue-options-start")).toBe("due");
  let custom = false;
  const takes = handle("issue-options-start", (start) => (start === "due" ? (custom = true) : undefined));
  expect([custom, kept("issue-options-start")]).toEqual([true, undefined]);
  takes();
  declines();
  const stop = handle("hovered-sub-issue", () => "A-1");
  expect(run("hovered-sub-issue")).toBe("A-1");
  stop();
  expect(run("hovered-sub-issue")).toBeUndefined();
});

test("edit and expanded-create intents are delivered once when their owner mounts", async () => {
  const { handle, kept, post } = await import("./commands");
  for (const name of ["edit-description", "create-expanded"] as const) {
    post(name, "A-1" as never);
    let count = 0;
    const stop = handle(name, () => { count++; return true; });
    expect(count).toBe(1);
    expect(kept(name)).toBeUndefined();
    stop();
    const again = handle(name, () => { count++; return true; });
    expect(count).toBe(1);
    again();
  }
});

test("an issue intent lapses once its issue is left, so it never reaches another issue's owner", async () => {
  const { forgetIssueIntents, handle, kept, post } = await import("./commands");
  // Ctrl+M on A-1 while its details load: the comment box is not there yet.
  post("focus-comment", "A-1");
  forgetIssueIntents("A-1");
  expect(kept("focus-comment")).toBe("A-1");
  // Esc, then B-2 opens and its comment box mounts.
  forgetIssueIntents(null);
  forgetIssueIntents("B-2");
  let taken: string | undefined;
  const stop = handle("focus-comment", (key) => (key === "B-2" ? ((taken = key), true) : undefined));
  expect([taken, kept("focus-comment")]).toEqual([undefined, undefined]);
  stop();
  // Board intents are not issue intents.
  post("issue-options-start", "due");
  forgetIssueIntents(null);
  expect(kept("issue-options-start")).toBe("due");
  forgetIssueIntents(null);
});

test("focusNode takes a command only when focus lands in the element (R3 G10)", () => {
  const doc = { activeElement: null as object | null };
  const node = (takes: boolean) => {
    const el = {
      ownerDocument: doc,
      focus: () => {
        if (takes) doc.activeElement = el;
      },
      contains: (other: object) => other === el,
    };
    return el as unknown as HTMLElement;
  };
  expect(focusNode(undefined)).toBeUndefined();
  expect(focusNode(node(false))).toBeUndefined(); // hidden or disabled: focus didn't stick
  expect(focusNode(node(true))).toBe(true);
});

/** A stand-in composer: `editor` answers the caret event as the rich editor does (caret placed, focus without scrolling). */
const composer = ({ editor = true, takes = true } = {}) => {
  const doc = { activeElement: null as object | null };
  const calls: unknown[][] = [];
  const el = {
    ownerDocument: doc,
    isConnected: true,
    contains: (other: object) => other === el,
    dispatchEvent: (event: CustomEvent) => {
      calls.push(["event", event.type, event.detail]);
      if (!editor) return true;
      event.preventDefault();
      if (takes) doc.activeElement = el;
      return false;
    },
    focus: (options?: FocusOptions) => {
      calls.push(["focus", options]);
      if (takes) doc.activeElement = el;
    },
    scrollIntoView: (...args: unknown[]) => calls.push(["scrollIntoView", ...args]),
  };
  return { node: el as unknown as HTMLElement & { isConnected: boolean }, calls };
};

test("focusComposer is Linear's newComment: caret at the end, then the editor's own scrollIntoView() after 100ms", () => {
  const reveals: (() => void)[] = [];
  const { node, calls } = composer();
  expect(focusComposer(node, (reveal) => reveals.push(reveal))).toBe(true);
  // Focused now (the command is answered), not yet scrolled: the router's scroll to the top of a new issue comes first.
  expect(calls).toEqual([["event", FOCUS_AT_EVENT, "end"]]);
  expect(reveals).toHaveLength(1);
  reveals[0]!();
  // No options: block "start", which at the page's end is the scroller's end, so the whole composer shows (the browser's
  // own focus scroll showed only the caret's line, the box cut off at the bottom edge).
  expect(calls.at(-1)).toEqual(["scrollIntoView"]);
  expect(COMPOSER_REVEAL_DELAY).toBe(100);
});

test("focusComposer: an element that isn't the editor focuses without the browser's scroll; a refused focus scrolls nothing", () => {
  const plain = composer({ editor: false });
  const reveals: (() => void)[] = [];
  expect(focusComposer(plain.node, (reveal) => reveals.push(reveal))).toBe(true);
  expect(plain.calls[1]).toEqual(["focus", { preventScroll: true }]);
  // Gone by the time the reveal runs (the issue was left): nothing scrolls.
  plain.node.isConnected = false;
  reveals[0]!();
  expect(plain.calls.some(([name]) => name === "scrollIntoView")).toBe(false);

  const refused = composer({ takes: false });
  expect(focusComposer(refused.node, () => { throw new Error("no reveal for a refused focus"); })).toBeUndefined();
  expect(focusComposer(undefined)).toBeUndefined();
});

test("the issue's focus-comment owner (the card's comment badge and ⌃M) focuses through focusComposer on both paths", async () => {
  const view = await Bun.file(`${import.meta.dir}/../../routes/issue-view.tsx`).text();
  const handler = view.slice(view.indexOf('useCommand("focus-comment"'), view.indexOf("const followedAnchor"));
  expect(handler.match(/focusComposer\(commentRef\.current\??\.querySelector<HTMLElement>\("#comment"\)\)/g)).toHaveLength(2);
  expect(handler).not.toContain("focusNode(");
});
