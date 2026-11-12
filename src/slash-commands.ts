import type { Command } from "prosemirror-state";
import { caretTrigger } from "./caret-trigger";
import {
  insertRule,
  insertTable,
  setBlock,
  toggleExpand,
  toggleList,
  toggleQuote,
} from "./editor-commands";

/** A slash-menu entry: the toolbar's block commands, plus attaching a file (which the editor runs, so it has no command). */
export type SlashCommand = { id: string; label: string; keywords: string; command?: Command };
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "text", label: "Text", keywords: "paragraph regular", command: setBlock("paragraph") },
  ...[1, 2, 3, 4].map((level) => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    keywords: `h${level} title`,
    command: setBlock("heading", { level }),
  })),
  { id: "bullet", label: "Bulleted list", keywords: "ul unordered", command: toggleList("bulletList") },
  { id: "ordered", label: "Numbered list", keywords: "ol ordered", command: toggleList("orderedList") },
  { id: "quote", label: "Quote", keywords: "blockquote", command: toggleQuote },
  { id: "code-block", label: "Code block", keywords: "pre snippet", command: setBlock("codeBlock") },
  { id: "table", label: "Table", keywords: "grid", command: insertTable },
  { id: "divider", label: "Divider", keywords: "rule hr line separator", command: insertRule },
  { id: "expand", label: "Collapsible section", keywords: "expand toggle details", command: toggleExpand },
  { id: "attach", label: "Attach image/file", keywords: "upload media video" },
];

/** Entries a word of whose name or keywords starts with the query, or whose name does with spaces ignored ("heading2"). */
export function matchingSlashCommands(query: string, commands = SLASH_COMMANDS): SlashCommand[] {
  const q = query.toLowerCase().trim(),
    compact = q.replace(/\s+/g, "");
  return commands.filter(
    (c) =>
      c.label.toLowerCase().startsWith(q) ||
      c.label.toLowerCase().replace(/\s+/g, "").startsWith(compact) ||
      `${c.label} ${c.keywords}`.toLowerCase().split(/\s+/).some((word) => word.startsWith(compact)),
  );
}

// "/" at a line or word start (never in a URL or path), then a name of up to 20 characters with single spaces.
const trigger = caretTrigger("slash", /(?:^|\s)\/((?:[^\s/￼](?:[^\S\n]?[^\s/￼])*)?)$/, 20);
export const activeSlash = trigger.active;
export const dismissSlash = trigger.dismiss;
export const slashPlugin = trigger.plugin;
