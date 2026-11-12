import { expect, test } from "bun:test";
import { parseHotkey } from "@tanstack/react-hotkeys";
import { shortcuts } from "./shortcuts";
import { editorBindings } from "./editor-bindings";
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
  const { get } = await import("./store");
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
  const { get, set } = await import("./store");
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
