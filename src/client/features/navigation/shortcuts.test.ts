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

test("R3-issue-fields-D5: Space peeks the card under the pointer, the one S/A/P/L act on, not the selection", async () => {
  const { get, set } = await import("@/client/state/store");
  const { handle } = await import("./commands");
  const { navigate, ui } = await import("./app-navigation");
  const { runShortcut } = await import("./shortcuts");
  const card = (key: string) => ({ key, board: 1, summary: key, status: "todo", assignee: null, labels: [], updated: "", resolved: null, comments: 0 });
  set({ issues: new Map(["PK-1", "PK-2"].map((key) => [key, card(key)])) });
  ui.send({ type: "overlay.close" });
  navigate({ selected: "PK-1", panel: false, document: null, inbox: false, mine: false });
  const stop = handle("hovered-sub-issue", () => "PK-2");
  try {
    runShortcut("peek");
  } finally {
    stop();
  }
  expect([get().selected, get().panel, get().view]).toEqual(["PK-2", true, "side"]);
});


test("R3-palette-shortcuts-D2: G then a key Linear binds as a G-chord never falls through to that key's own shortcut", async () => {
  const { reservedChords } = await import("./shortcuts");
  const chords = [...shortcuts, ...reservedChords].filter((s) => Array.isArray(s.hotkey) && s.hotkey[0] === "G");
  // Linear's G-chords (startup-root.CnUSfl4j.js `keyboardShortcut:{key:["g", …]}`), including Preferences (G S) and views (G U).
  for (const key of [..."-ABCDEFIJLMNPQRSTUVWX"]) expect(chords.some((s) => (s.hotkey as string[])[1] === key)).toBe(true);
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
