import { afterEach, expect, spyOn, test } from "bun:test";
import { FOCUS_AT_EVENT } from "@/client/features/editor/title-flow";
import { COMPOSER_REVEAL_DELAY, focusComposer, REVEAL_STOPS, revealHold, scrollComposer } from "./composer-reveal";

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
  };
  return { node: el as unknown as HTMLElement & { isConnected: boolean }, calls };
};

let timers: ReturnType<typeof spyOn> | undefined;
afterEach(() => timers?.mockRestore());

test("focusComposer is Linear's newComment: caret at the end now, the reveal 100ms later", () => {
  const delays: unknown[] = [];
  const waiting: (() => void)[] = [];
  timers = spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number) => {
    delays.push(ms);
    waiting.push(run);
    return 0;
  }) as unknown as typeof setTimeout);
  const shown: HTMLElement[] = [];
  const { node, calls } = composer();
  expect(focusComposer(node, undefined, (n) => shown.push(n))).toBe(true);
  // Focused now (the command is answered), not yet revealed: the router's scroll to the top of a new issue comes first.
  expect(calls).toEqual([["event", FOCUS_AT_EVENT, "end"]]);
  expect([delays, shown]).toEqual([[COMPOSER_REVEAL_DELAY], []]);
  expect(COMPOSER_REVEAL_DELAY).toBe(100);
  waiting[0]!();
  expect(shown).toEqual([node]);
});

test("focusComposer: a plain element focuses without the browser's scroll; a refused focus or a gone composer reveals nothing", () => {
  const plain = composer({ editor: false });
  const runs: (() => void)[] = [];
  const shown: HTMLElement[] = [];
  expect(focusComposer(plain.node, (run) => runs.push(run), (n) => shown.push(n))).toBe(true);
  expect(plain.calls[1]).toEqual(["focus", { preventScroll: true }]);
  // Gone by the time the reveal runs (the issue was left).
  plain.node.isConnected = false;
  runs[0]!();
  expect(shown).toEqual([]);

  const refused = composer({ takes: false });
  expect(focusComposer(refused.node, () => { throw new Error("no reveal for a refused focus"); })).toBeUndefined();
  expect(focusComposer(undefined)).toBeUndefined();
});

test("revealHold follows late content while the composer has focus, and stops for good at the person's input or a blur", () => {
  let reveals = 0,
    focused = true;
  const hold = revealHold(() => reveals++, () => focused);
  expect(reveals).toBe(1); // Linear's one scrollIntoView()
  // Jira's history lands among the last comments after the reveal: the composer is shown again.
  hold.grew();
  hold.grew();
  expect([reveals, hold.live]).toEqual([3, true]);
  // The person scrolls, presses or types: the page is theirs.
  hold.stop();
  hold.grew();
  expect([reveals, hold.live]).toEqual([3, false]);

  const blurred = revealHold(() => reveals++, () => focused);
  focused = false;
  blurred.grew();
  focused = true;
  blurred.grew();
  expect([reveals, blurred.live]).toEqual([4, false]);
  expect([...REVEAL_STOPS]).toEqual(["wheel", "touchstart", "pointerdown", "keydown"]);
});

test("the issue's focus-comment owner (⌃M, Comment on issue) focuses through focusComposer on both paths", async () => {
  const view = await Bun.file(`${import.meta.dir}/../../routes/issue-view.tsx`).text();
  const handler = view.slice(view.indexOf('useCommand("focus-comment"'), view.indexOf("const followedAnchor"));
  expect(handler.match(/focusComposer\(commentRef\.current\??\.querySelector<HTMLElement>\("#comment"\)\)/g)).toHaveLength(2);
  expect(handler).not.toContain("focusNode(");
});

test("the reveal is Linear's bare scrollIntoView(): block start, not the browser's caret-only nearest", () => {
  const calls: unknown[][] = [];
  scrollComposer({ scrollIntoView: (...args: unknown[]) => calls.push(args) } as unknown as HTMLElement);
  expect(calls).toEqual([[]]);
});
