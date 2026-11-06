import { expect, test } from "bun:test";
import { parseHotkey } from "@tanstack/react-hotkeys";
import { shortcuts } from "./shortcuts";
import { editorBindings } from "./editor-bindings";
test("every advertised binding parses through TanStack; app bindings are unique", () => {
  const seen = new Set<string>();
  for (const binding of shortcuts) {
    expect(() => parseHotkey(binding.hotkey, "mac")).not.toThrow();
    const key = JSON.stringify(binding.hotkey);
    expect(seen.has(key)).toBe(false);
    seen.add(key);
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
  expect(editorBindings.find((b) => b.id === "strike")?.hotkey).toBe(
    "Mod+Shift+X",
  );
});
