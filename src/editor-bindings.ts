import type { Hotkey } from "@tanstack/react-hotkeys";
export const editorBindings: { id: string; name: string; hotkey: Hotkey }[] = [
  { id: "strong", name: "Bold", hotkey: "Mod+B" },
  { id: "em", name: "Italic", hotkey: "Mod+I" },
  { id: "underline", name: "Underline", hotkey: "Mod+U" },
  { id: "strike", name: "Strikethrough", hotkey: "Mod+Shift+X" },
  { id: "code", name: "Inline code", hotkey: "Mod+E" },
  { id: "link", name: "Turn text into link", hotkey: "Mod+K" },
  { id: "quote", name: "Blockquote", hotkey: "Alt+Shift+." },
  ...[0, 1, 2, 3, 4].map((level) => ({
    id: `heading-${level}`,
    name: level ? `Heading ${level}` : "Regular text",
    hotkey: `Mod+Alt+${level}` as Hotkey,
  })),
  { id: "bullet", name: "Bulleted list", hotkey: "Mod+Shift+8" },
  { id: "ordered", name: "Numbered list", hotkey: "Mod+Shift+9" },
  { id: "code-block", name: "Code block", hotkey: "Mod+Shift+\\" },
  { id: "attach", name: "Attach image/file", hotkey: "Mod+Shift+U" },
  { id: "undo", name: "Undo", hotkey: "Mod+Z" },
  { id: "redo", name: "Redo", hotkey: "Mod+Shift+Z" },
  { id: "save", name: "Save or submit / send comment", hotkey: "Mod+Enter" },
];
