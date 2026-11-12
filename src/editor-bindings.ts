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
  // Linear's second heading keys.
  ...[1, 2, 3, 4].map((level) => ({
    id: `heading-${level}-control`,
    name: `Heading ${level}`,
    hotkey: `Control+Shift+${level}` as Hotkey,
  })),
  { id: "bullet", name: "Bulleted list", hotkey: "Mod+Shift+8" },
  { id: "ordered", name: "Numbered list", hotkey: "Mod+Shift+9" },
  { id: "checklist", name: "Checklist", hotkey: "Mod+Shift+7" },
  { id: "divider", name: "Divider", hotkey: "Mod+Shift+-" },
  { id: "code-block", name: "Code block", hotkey: "Mod+Shift+\\" },
  { id: "expand", name: "Collapsible section", hotkey: "Mod+Shift+6" },
  { id: "move-up", name: "Move block up", hotkey: "Alt+ArrowUp" },
  { id: "move-down", name: "Move block down", hotkey: "Alt+ArrowDown" },
  { id: "issue-from-selection", name: "Create issue from selection", hotkey: "Mod+Shift+O" },
  { id: "attach", name: "Attach image/file", hotkey: "Mod+Shift+U" },
  { id: "undo", name: "Undo", hotkey: "Mod+Z" },
  { id: "redo", name: "Redo", hotkey: "Mod+Shift+Z" },
  { id: "save", name: "Save or submit / send comment (in a checklist item, tick it)", hotkey: "Mod+Enter" },
];
/** An editor binding's keys, for a control's tooltip or a menu row's caps. */
export const editorKey = (id: string) => editorBindings.find((b) => b.id === id)?.hotkey;
