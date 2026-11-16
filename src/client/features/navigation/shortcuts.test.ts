import { expect, test } from "bun:test";
import { parseHotkey } from "@tanstack/react-hotkeys";
import { shortcuts } from "./shortcuts";
import { editorBindings } from "@/client/features/editor/editor-bindings";
test("every advertised binding parses through TanStack; bindings are unique in each context", () => {
  for (const binding of shortcuts)
    if (binding.hotkey) expect(() => parseHotkey(binding.hotkey!, "mac")).not.toThrow();
  for (const context of ["issue", "document"]) {
    const seen = new Set<string>();
    for (const binding of shortcuts.filter(
      (binding) => binding.hotkey && !binding.id.startsWith("view-") && (context === "document" ? !binding.issue : !binding.document),
    )) {
      const key = JSON.stringify(binding.hotkey);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  }
  for (const binding of editorBindings)
    expect(() => parseHotkey(binding.hotkey, "mac")).not.toThrow();
});
test("Linear's observed bindings replace invented single-letter shortcuts", () => {
  const keys = Object.fromEntries(shortcuts.map((s) => [s.id, s.hotkey]));
  expect(keys.shortcuts).toBe("Mod+/");
  expect(keys.mine).toEqual(["G", "M"]);
  expect(keys.rename).toBe("Shift+R");
  expect(keys.description).toBe("Control+Shift+I");
  expect(keys["new-full"]).toBe("V");
  // E and H are Linear's own inbox keys (delete, snooze); elsewhere they stay unbound.
  for (const invented of ["B", "D", "E", "H", "M", "N"])
    expect(shortcuts.some((s) => s.hotkey === invented && s.group !== "Inbox")).toBe(false);
  expect(keys.inbox).toEqual(["G", "I"]);
  expect([keys["inbox-read"], keys["inbox-delete"], keys["inbox-snooze"]]).toEqual(["U", "E", "H"]);
  expect(editorBindings.find((b) => b.id === "strike")?.hotkey).toBe("Mod+Shift+X");
});
test("whether a shortcut applies is read from the state it is given, never the DOM or the live store", async () => {
  const { get } = await import("@/client/state/store");
  const { handle } = await import("./commands");
  const { shortcutApplies } = await import("./shortcuts");
  let domReads = 0;
  const stop = handle("hovered-sub-issue", () => void domReads++);
  const undo = shortcuts.find((s) => s.id === "inbox-undo")!;
  expect(get().inbox).toBeFalsy();
  expect(shortcutApplies(undo, { ...get(), inbox: true })).toBe(true);
  for (const entry of shortcuts) shortcutApplies(entry, { ...get(), inbox: true });
  expect(domReads).toBe(0);
  stop();
});
test("V leaves no full-screen intent behind when the composer refuses to open", async () => {
  const { get, set } = await import("@/client/state/store");
  const { handle } = await import("./commands");
  const { runShortcut } = await import("./shortcuts");
  set({ canEdit: false } as never);
  runShortcut("new-full");
  set({ canEdit: true } as never);
  // The next composer to mount (C, once storage recovers) must open as a dialog.
  let expanded = false;
  const stop = handle("create-expanded", () => (expanded = true));
  expect([get().overlay, expanded]).toEqual([null, false]);
  stop();
});
test("BJ-216: an open action menu keeps every global key, as Linear's isActionMenuOpen does; ⌘K and ⌘/ still pass", async () => {
  const { get } = await import("@/client/state/store");
  const { hotkeyEnabled } = await import("./shortcuts");
  const s = { ...get(), boards: [{}], overlay: null, toolbar: null, document: null } as never;
  const issue = { key: "TEST-2" } as never;
  const entry = (id: string) => shortcuts.find((e) => e.id === id)!;
  // The PR menu's "Copy branch name ⇧⌘." hint must not run the issue's Copy git branch name behind the menu.
  expect(hotkeyEnabled(entry("copy-branch"), s, issue, false)).toBe(true);
  expect(hotkeyEnabled(entry("copy-branch"), s, issue, true)).toBe(false);
  expect(hotkeyEnabled(entry("copy-id"), s, issue, true)).toBe(false);
  expect(hotkeyEnabled(entry("commands"), s, issue, true)).toBe(true);
  expect(hotkeyEnabled(entry("shortcuts"), s, issue, true)).toBe(true);
});
test("R3-create-D11: ⌘K names the full-screen create as Linear's CREATE_FULL_VIEW_ISSUE does", () => {
  expect(shortcuts.find((s) => s.id === "new-full")?.name).toBe("Create issue in fullscreen…");
});

test("R3-issue-fields-D5, B9: Space peeks the card under the pointer, the one S/A/P/L act on, without opening or selecting it", async () => {
  const { get, set } = await import("@/client/state/store");
  const { handle } = await import("./commands");
  const { navigate, ui } = await import("./app-navigation");
  const { runShortcut } = await import("./shortcuts");
  const card = (key: string) => ({ key, boards: [1], summary: key, status: "todo", assignee: null, labels: [], updated: "", resolved: null, comments: 0 });
  set({ issues: new Map(["PK-1", "PK-2"].map((key) => [key, card(key)])) });
  ui.send({ type: "overlay.close" });
  navigate({ selected: "PK-1", panel: false, document: null, inbox: false, mine: false });
  const { closePeek, isPeekOpen } = await import("@/client/features/views/view-peek-state");
  const peeked = await import("@/client/features/views/view-peek-state");
  const stop = handle("hovered-sub-issue", () => "PK-2");
  try {
    runShortcut("peek");
    // Linear's view peek floats over the view: no navigation, no side panel, the selection stays.
    expect([get().selected, get().panel, isPeekOpen()]).toEqual(["PK-1", false, true]);
    expect(peeked.peekKeyOf()).toBe("PK-2");
    // The next press closes it.
    runShortcut("peek");
    expect(isPeekOpen()).toBe(false);
  } finally {
    stop();
    closePeek();
  }
});


test("R3-palette-shortcuts-D2: G then a key Linear binds as a G-chord never falls through to that key's own shortcut", async () => {
  const { reservedChords } = await import("./shortcuts");
  const chords = [...shortcuts, ...reservedChords].filter((s) => Array.isArray(s.hotkey) && s.hotkey[0] === "G");
  // Linear's G-chords (startup-root.CnUSfl4j.js `keyboardShortcut:{key:["g", …]}`), including Preferences (G S) and views (G U).
  for (const key of "-ABCDEFIJLMNPQRSTUVWX") expect(chords.some((s) => (s.hotkey as string[])[1] === key)).toBe(true);
  // The single keys QA saw fire after G (S status, P priority, L labels, U read state) are all held by a chord.
  for (const id of ["status", "priority", "labels", "inbox-read"]) {
    const key = shortcuts.find((s) => s.id === id)!.hotkey;
    expect(chords.some((s) => (s.hotkey as string[])[1] === key)).toBe(true);
  }
  for (const chord of reservedChords) expect(() => parseHotkey(chord.hotkey!, "mac")).not.toThrow();
  // Reserved chords are inert: not commands, so ⌘K and the shortcut help never list them.
  expect(reservedChords.every((c) => !shortcuts.includes(c))).toBe(true);
});

test("R3-palette-shortcuts-D6: ⌥1/⌥2 and their ⌘K rows apply only in the priority inbox, as Linear gates on priorityInboxEnabled", async () => {
  const { get } = await import("@/client/state/store");
  const { changeView } = await import("@/client/features/inbox/inbox");
  const { shortcutApplies } = await import("./shortcuts");
  const tabs = shortcuts.filter((s) => s.id === "inbox-priority" || s.id === "inbox-other");
  const at = { ...get(), inbox: true };
  changeView({ priorityInbox: false });
  expect(tabs.map((s) => shortcutApplies(s, at))).toEqual([false, false]);
  changeView({ priorityInbox: true });
  expect(tabs.map((s) => shortcutApplies(s, at))).toEqual([true, true]);
  expect(tabs.map((s) => shortcutApplies(s, { ...at, inbox: false }))).toEqual([false, false]);
  changeView({ priorityInbox: false });
});
test("C12: ⌥⇧G Change grouping and ⌥⇧O View ordering… open their command pages on the list or board, filed under Display options", async () => {
  const { get } = await import("@/client/state/store");
  const { shortcutApplies, runShortcut } = await import("./shortcuts");
  const { paletteGroupOf } = await import("./palette-groups");
  const { isPalettePage } = await import("./palette");
  const grouping = shortcuts.find((s) => s.id === "grouping")!;
  const ordering = shortcuts.find((s) => s.id === "ordering")!;
  expect([grouping.name, grouping.hotkey, paletteGroupOf(grouping)]).toEqual(["Change grouping", "Alt+Shift+G", "Display options"]);
  expect([ordering.name, ordering.hotkey, paletteGroupOf(ordering)]).toEqual(["View ordering…", "Alt+Shift+O", "Display options"]);
  const board = { ...get(), document: null, panel: false, inbox: false };
  expect(shortcutApplies(grouping, board)).toBe(true);
  // Not over the Inbox's list, nor behind a full-page issue.
  expect(shortcutApplies(grouping, { ...board, inbox: true })).toBe(false);
  expect(shortcutApplies(ordering, { ...board, panel: true, view: "page" })).toBe(false);
  runShortcut("grouping");
  expect(get().overlay).toBe("grouping");
  expect(isPalettePage(get().overlay)).toBe(true);
  runShortcut("ordering");
  expect(get().overlay).toBe("ordering");
  expect(isPalettePage("ordering")).toBe(true);
  const { ui } = await import("./app-navigation");
  ui.send({ type: "overlay.close" });
});

test("BJ-382: after j/k an issue shortcut acts on the stepped issue, not the card under the resting pointer, until it moves", async () => {
  const { activeSourceAfter } = await import("@/client/components/pointer-intent");
  const still = { type: "pointermove", movementX: 0, movementY: 0, pointerType: "mouse" };
  // A key step takes the active item; a still move (a card scrolling under the pointer) leaves it; a real move hands it back.
  expect(activeSourceAfter("pointer", { type: "step" })).toBe("keys");
  expect(activeSourceAfter("keys", still)).toBe("keys");
  expect(activeSourceAfter("keys", { type: "keydown" })).toBe("keys");
  expect(activeSourceAfter("keys", { ...still, movementY: 3 })).toBe("pointer");
  // Any other key (S, A, Space) leaves the hovered row the active one.
  expect(activeSourceAfter("pointer", { type: "keydown" })).toBe("pointer");

  const { get, set } = await import("@/client/state/store");
  const { navigate, ui } = await import("./app-navigation");
  const { runShortcut } = await import("./shortcuts");
  const peeked = await import("@/client/features/views/view-peek-state");
  const card = (key: string) => ({ key, boards: [1], summary: key, status: "todo", assignee: null, labels: [], updated: "", resolved: null, comments: 0 });
  set({ issues: new Map(["PK-1", "PK-2"].map((key) => [key, card(key)])) });
  ui.send({ type: "overlay.close" });
  navigate({ selected: "PK-1", panel: false, document: null, inbox: false, mine: false });
  // The pointer rests on PK-2's card.
  const was = globalThis.document;
  globalThis.document = {
    querySelector: (selector: string) => (selector.includes(":hover") ? { dataset: { key: "PK-2" } } : null),
  } as never;
  try {
    runShortcut("peek");
    expect(peeked.peekKeyOf()).toBe("PK-2");
    peeked.closePeek();
    // j steps (here past the end of the list, so the selection stays PK-1): the resting pointer's card no longer answers.
    const { keyStepped } = await import("@/client/components/pointer-intent");
    keyStepped();
    runShortcut("peek");
    expect([get().selected, peeked.peekKeyOf()]).toEqual(["PK-1", "PK-1"]);
  } finally {
    globalThis.document = was;
    peeked.closePeek();
  }
});

test("BJ-382: j/k steps mark the keys as leading, and the sub-issue section's hovered row honours it", async () => {
  const source = await Bun.file(new URL("./shortcuts.tsx", import.meta.url)).text();
  expect(source).toMatch(/function move\(direction: number, horizontal = false\) \{\s*keyStepped\(\);/);
  expect(source).toMatch(/pointerLeads\(\)\s*\?\s*globalThis\.document\?\.querySelector<HTMLElement>\("\[data-key\]\[role=row\]:hover"\)/);
  const subIssues = await Bun.file(new URL("../issue/sub-issues.tsx", import.meta.url)).text();
  expect(subIssues).toContain('useCommand("hovered-sub-issue", () => activeSubIssue(section.current, pointerLeads()));');
});

test("BJ-382: the sub-issue shortcut row is the hovered one while the pointer leads, else the focused one, wherever each sits", async () => {
  const { activeSubIssue } = await import("@/client/features/issue/sub-issue-model");
  // A section whose focused row (C-1) comes before the hovered one (C-3): one `:hover, :focus-within` query would answer C-1.
  const rows: Record<string, string> = { "[data-sub-issue]:hover": "C-3", "[data-sub-issue]:focus-within": "C-1" };
  const section = (present: string[]) => ({
    querySelector: (selector: string) =>
      present.includes(selector) ? { dataset: { subIssue: rows[selector] } } : selector.includes(",") ? { dataset: { subIssue: "C-1" } } : null,
  }) as unknown as ParentNode;
  const both = section(Object.keys(rows));
  expect(activeSubIssue(both, true)).toBe("C-3");
  expect(activeSubIssue(both, false)).toBe("C-1");
  expect(activeSubIssue(section(["[data-sub-issue]:focus-within"]), true)).toBe("C-1");
  expect(activeSubIssue(section(["[data-sub-issue]:hover"]), false)).toBeUndefined();
  expect(activeSubIssue(null, true)).toBeUndefined();
});

test("BJ-374: arrows a focused card hands over (⇧→ Go to linked pull request, ↑/↓/←/→) reach the shortcuts past React Aria's grid", async () => {
  const { ignoreInputsFor } = await import("./shortcuts");
  // A stand-in element: `closest` answers from the selectors it sits inside.
  const inside = (...matches: string[]) => ({ closest: (selector: string) => (matches.includes(selector) ? {} : null) }) as unknown as Element;
  const row = inside("[role=row][data-key]");
  const field = inside("[role=row][data-key]", 'input, textarea, [contenteditable="true"], [role=dialog], [role=menu], [role=listbox]');
  const key = (key: string, mods: Partial<KeyboardEvent> = {}) => ({ key, metaKey: false, ctrlKey: false, ...mods }) as KeyboardEvent;
  const pr = { id: "go-pull-requests" };
  expect(ignoreInputsFor(pr)).toBe(true);
  expect(ignoreInputsFor(pr, key("ArrowRight", { shiftKey: true }), row)).toBe(false);
  expect(ignoreInputsFor({ id: "down" }, key("ArrowDown"), row)).toBe(false);
  // A field, menu or listbox inside the row keeps its arrows; a letter or a key off any row keeps the default.
  expect(ignoreInputsFor(pr, key("ArrowRight", { shiftKey: true }), field)).toBe(true);
  expect(ignoreInputsFor({ id: "status" }, key("s"), row)).toBe(true);
  expect(ignoreInputsFor({ id: "down" }, key("ArrowDown"), inside())).toBe(true);
  expect(ignoreInputsFor({ id: "down" }, key("ArrowDown"), null)).toBe(true);
  // ⌘K and ⌘/ still run from text fields.
  expect(ignoreInputsFor({ id: "commands" })).toBe(false);
  const source = await Bun.file(new URL("./shortcuts.tsx", import.meta.url)).text();
  expect(source).toContain("handle.setOptions({ enabled: hotkeyEnabled(entry, s, issue), ignoreInputs: ignoreInputsFor(entry, event, focused) });");
});
