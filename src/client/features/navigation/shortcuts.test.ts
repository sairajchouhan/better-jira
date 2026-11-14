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
