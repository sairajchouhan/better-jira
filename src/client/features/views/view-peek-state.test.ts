import { afterEach, expect, test } from "bun:test";
import { get, set } from "@/client/state/store";
import { registerActionMenu } from "@/client/components/open-action-menus";
import { navigate, ui } from "@/client/features/navigation/app-navigation";
import {
  PEEK_HOLD_MS,
  closePeek,
  escapeClosesPeek,
  followPeek,
  isPeekOpen,
  peekClosesFor,
  peekKeyDown,
  peekKeyOf,
  peekKeyUp,
  peekPlacement,
  togglePeek,
} from "./view-peek-state";
import { peekDueText } from "@/client/features/issue/issue-peek";

afterEach(closePeek);

test("B9: Space is Linear's sticky key: a press opens, the next closes; with nothing focused it opens nothing", () => {
  const open = peekKeyDown(null, "PK-1", 1000);
  expect(open).toEqual({ key: "PK-1", openedAt: 1000 });
  expect(peekKeyDown(open, "PK-2", 1100)).toBe(null);
  expect(peekKeyDown(null, undefined, 1000)).toBe(null);
});

test("B9: a tap leaves the peek open; a press held past 250ms closes it on release", () => {
  const open = peekKeyDown(null, "PK-1", 1000);
  expect(PEEK_HOLD_MS).toBe(250);
  expect(peekKeyUp(open, 1100)).toBe(open);
  // Linear closes only when the press began more than 250ms before the release (`i.current<Date.now()-250`).
  expect(peekKeyUp(open, 1250)).toBe(open);
  expect(peekKeyUp(open, 1251)).toBe(null);
  expect(peekKeyUp(null, 5000)).toBe(null);
});

test("B9: the peek sits 88px from the top and 24px from the right, and grows to the window's bottom", () => {
  expect(peekPlacement()).toEqual({ top: 88, right: 24, maxHeight: "calc(100dvh - 88px)" });
  // A desktop toolbar pushes it down and takes its height off the limit (`reservedHeight: 88 + toolbarHeight`).
  expect(peekPlacement(38)).toEqual({ top: 126, right: 24, maxHeight: "calc(100dvh - 126px)" });
});

test("B9: the peek closes when its item goes, a menu or toolbar opens, an issue or document opens, or the board changes", () => {
  const peek = { key: "PK-1", openedAt: 0 };
  const base = {
    ...get(),
    issues: new Map([["PK-1", {} as never]]),
    overlay: null,
    toolbar: null,
    panel: false,
    document: null,
    inbox: false,
    board: 1,
  };
  expect(peekClosesFor(peek, base, 1)).toBe(false);
  expect(peekClosesFor(peek, { ...base, issues: new Map() }, 1)).toBe(true);
  expect(peekClosesFor(peek, { ...base, overlay: "palette" }, 1)).toBe(true);
  expect(peekClosesFor(peek, { ...base, toolbar: "display" }, 1)).toBe(true);
  expect(peekClosesFor(peek, { ...base, panel: true }, 1)).toBe(true);
  expect(peekClosesFor(peek, { ...base, document: "doc-1" }, 1)).toBe(true);
  expect(peekClosesFor(peek, { ...base, inbox: true }, 1)).toBe(true);
  expect(peekClosesFor(peek, base, 2)).toBe(true);
});

const card = (key: string) => ({ key, boards: [1], summary: key, status: "todo", assignee: null, labels: [], updated: "", resolved: null, comments: 0 });
function seed() {
  set({ issues: new Map(["PK-1", "PK-2"].map((key) => [key, card(key)])) as never });
  ui.send({ type: "overlay.close" });
  navigate({ selected: null, panel: false, document: null, inbox: false, mine: false });
}

test("B9: an open peek follows focus; a closed one stays closed", () => {
  seed();
  followPeek("PK-2");
  expect(isPeekOpen()).toBe(false);
  togglePeek("PK-1");
  followPeek("PK-2");
  expect(peekKeyOf()).toBe("PK-2");
});

test("B9: an action menu opening closes the peek, as Linear's action manager `onOpen` does", () => {
  seed();
  togglePeek("PK-1");
  const unregister = registerActionMenu(() => {});
  try {
    expect(isPeekOpen()).toBe(false);
  } finally {
    unregister();
  }
});

test("B9: opening the command menu or the issue closes the peek", () => {
  seed();
  togglePeek("PK-1");
  ui.send({ type: "overlay.open", overlay: "palette", target: null });
  expect(isPeekOpen()).toBe(false);
  ui.send({ type: "overlay.close" });
  togglePeek("PK-1");
  navigate({ selected: "PK-1", panel: true });
  expect(isPeekOpen()).toBe(false);
});

test("B9: the peek's due line words the date as Linear's", () => {
  const now = new Date(2026, 10, 14, 15, 30);
  expect(peekDueText("2026-11-14", now)).toBe("Due today");
  expect(peekDueText("2026-11-15", now)).toBe("Due tomorrow");
  expect(peekDueText("2026-11-19", now)).toBe("in 5 days");
  expect(peekDueText("2026-11-13", now)).toBe("1 day overdue");
  expect(peekDueText("2026-11-09", now)).toBe("5 days overdue");
  expect(peekDueText("2027-01-03", now)).toBe("in about 2 months");
});

test("BJ-269: Escape in a text field leaves the peek open, as Linear's peek Escape doesn't run with an input focused", () => {
  const key = (target: unknown, more: Partial<KeyboardEvent> = {}) =>
    ({ key: "Escape", defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target, ...more }) as KeyboardEvent;
  const card = { tagName: "DIV", isContentEditable: false };
  expect(escapeClosesPeek(key(card))).toBe(true);
  expect(escapeClosesPeek(key(null))).toBe(true);
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(escapeClosesPeek(key({ tagName, isContentEditable: false }))).toBe(false);
  expect(escapeClosesPeek(key({ tagName: "P", isContentEditable: true }))).toBe(false);
  // Only a plain Escape no one took.
  expect(escapeClosesPeek(key(card, { shiftKey: true }))).toBe(false);
  expect(escapeClosesPeek(key(card, { defaultPrevented: true }))).toBe(false);
  expect(escapeClosesPeek(key(card, { key: "Enter" }))).toBe(false);
});

test("BJ-269: the peek's capture listener asks escapeClosesPeek before it closes and stops Escape", async () => {
  const source = await Bun.file(new URL("./view-peek-state.ts", import.meta.url)).text();
  expect(source).toMatch(/const keyDown = \(e: KeyboardEvent\) => \{\s*if \(!escapeClosesPeek\(e\)\) return;\s*e\.preventDefault\(\);/);
});
