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
  { id: "expand", name: "Collapsible section", hotkey: "Mod+Shift+6" },
  { id: "move-up", name: "Move block up", hotkey: "Alt+ArrowUp" },
  { id: "move-down", name: "Move block down", hotkey: "Alt+ArrowDown" },
  { id: "block-menu", name: "Open block menu", hotkey: "Shift+F10" },
  { id: "block-controls", name: "Focus block controls", hotkey: "Alt+F10" },
  { id: "attach", name: "Attach image/file", hotkey: "Mod+Shift+U" },
  { id: "undo", name: "Undo", hotkey: "Mod+Z" },
  { id: "redo", name: "Redo", hotkey: "Mod+Shift+Z" },
  { id: "save", name: "Save or submit / send comment", hotkey: "Mod+Enter" },
];
/** An editor binding's keys, for a control's tooltip or a menu row's caps. */
export const editorKey = (id: string) => editorBindings.find((b) => b.id === id)?.hotkey;
/** Keys inside a code block (Linear's `code_block` keys), bound by the editor's code keymap and listed in Help. */
export const codeBlockBindings: { id: string; name: string; hotkey: Hotkey }[] = [
  { id: "code-indent", name: "Indent code lines", hotkey: "Tab" },
  { id: "code-outdent", name: "Outdent code lines", hotkey: "Shift+Tab" },
  { id: "code-indent-item", name: "Indent the list item holding the code block", hotkey: "Alt+Tab" },
  { id: "code-outdent-item", name: "Outdent the list item holding the code block", hotkey: "Alt+Shift+Tab" },
  { id: "code-select", name: "Select the code block", hotkey: "Mod+A" },
  { id: "code-comment", name: "Toggle line comment", hotkey: "Mod+/" },
  { id: "code-backspace", name: "Turn an emptied code block back into text", hotkey: "Backspace" },
];
