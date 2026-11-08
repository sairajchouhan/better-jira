import { expect, test } from "bun:test";
import { parseHotkey } from "@tanstack/react-hotkeys";
import { shortcuts } from "./shortcuts";
import { editorBindings } from "./editor-bindings";
test("every advertised binding parses through TanStack; bindings are unique in each context", () => {
  for (const binding of shortcuts) {
    expect(() => parseHotkey(binding.hotkey, "mac")).not.toThrow();
  }
  for (const context of ["issue", "document"]) {
    const seen = new Set<string>();
    for (const binding of shortcuts.filter((binding) =>
      context === "document" ? !binding.issue : !binding.document,
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
  for (const invented of ["B", "D", "E", "H", "M", "N"])
    expect(shortcuts.some((s) => s.hotkey === invented)).toBe(false);
  expect(editorBindings.find((b) => b.id === "strike")?.hotkey).toBe("Mod+Shift+X");
});
