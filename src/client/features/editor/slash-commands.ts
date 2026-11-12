import type { EditorState, Command } from "prosemirror-state";
import { caretTrigger } from "./caret-trigger";
import { insertTable, setBlock, toggleExpand, toggleQuote } from "./editor-commands";
import { insertDate, insertDivider, insertText, toggleCallout } from "./editor-blocks";
import { setList } from "./editor-checklist";
import { deleteColumn, deleteRow, insertColumnRight, insertRowBelow, isInTable, removeTable } from "./editor-table";
import type { EditorGlyph } from "./editor-icons";

/** A slash-menu entry (Linear's EC `ho()` items). `when` is Linear's isApplicable; an entry whose command cannot run at the
 * caret is left out too. Media and Attach have no command: the editor opens its file picker for them. */
export type SlashCommand = {
  id: string;
  label: string;
  keywords: string;
  icon: EditorGlyph;
  command?: Command;
  /** Scored against this instead of the label (Date matches as "Insert Date"). */
  matchLabel?: string;
  when?: (state: EditorState, query: string) => boolean;
};
const within = (state: EditorState, ...names: string[]) => {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) if (names.includes($from.node(depth).type.name)) return true;
  return false;
};
const inList = (state: EditorState) => within(state, "bulletList", "orderedList", "taskList");
const inHeading = (state: EditorState) => state.selection.$from.parent.type.name === "heading";

const table = { insertRow: insertRowBelow, deleteRow, insertColumn: insertColumnRight, deleteColumn, deleteTable: removeTable };

/** The slash Table takes the empty line it was typed on, as Linear's does; on a line with text it goes after it. */
const tableHere: Command = (state, dispatch) => {
  const { $from, empty } = state.selection,
    line = $from.parent,
    index = $from.index(-1);
  const takesLine =
    empty &&
    line.type.name === "paragraph" &&
    !line.content.size &&
    $from.node(-1).canReplaceWith(index, index + 1, state.schema.nodes.table!);
  if (!takesLine) return insertTable(state, dispatch);
  return insertTable(state, dispatch && ((tr) => dispatch(tr.delete($from.before(), $from.after()))));
};

/** Linear's slash items, in its order, less the ones Jira cannot store (screenshot, gif, documents, diagram, LaTeX, insight). */
export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "insert-row", label: "Insert row", keywords: "", icon: "insert-row", command: table.insertRow, when: isInTable },
  { id: "delete-row", label: "Delete row", keywords: "", icon: "delete-row", command: table.deleteRow, when: isInTable },
  { id: "insert-column", label: "Insert column", keywords: "", icon: "insert-column", command: table.insertColumn, when: isInTable },
  { id: "delete-column", label: "Delete column", keywords: "", icon: "delete-column", command: table.deleteColumn, when: isInTable },
  { id: "delete-table", label: "Delete table", keywords: "rm", icon: "delete-table", command: table.deleteTable, when: isInTable },
  ...([1, 2, 3, 4] as const).map((level) => ({
    id: `heading-${level}`,
    label: `Heading ${level}`,
    keywords: `h${level}`,
    icon: `h${level}` as const,
    command: setBlock("heading", { level }),
    when: (state: EditorState, query: string) => !inList(state) && (level < 4 || !!query),
  })),
  { id: "bullet", label: "Bulleted list", keywords: "", icon: "list", command: setList("bulletList"), when: (s) => !inHeading(s) },
  { id: "ordered", label: "Numbered list", keywords: "", icon: "numbered-list", command: setList("orderedList"), when: (s) => !inHeading(s) },
  { id: "checklist", label: "Checklist", keywords: "check todo task", icon: "checklist", command: setList("taskList"), when: (s) => !inHeading(s) },
  { id: "media", label: "Insert media…", keywords: "image video upload audio", icon: "image" },
  { id: "attach", label: "Attach files…", keywords: "upload", icon: "attach" },
  { id: "date", label: "Date", matchLabel: "Insert Date", keywords: "date today", icon: "date", command: insertDate, when: (_s, q) => q.length > 1 },
  { id: "shrug", label: "¯\\_(ツ)_/¯", keywords: "shrug", icon: "text", command: insertText("¯\\_(ツ)_/¯"), when: (_s, q) => q.includes("shrug") },
  { id: "code-block", label: "Code block", keywords: "", icon: "code-block", command: setBlock("codeBlock") },
  {
    id: "expand",
    label: "Collapsible section",
    keywords: "toggle collapse expand details",
    icon: "collapsible",
    command: toggleExpand,
    when: (s) => !isInTable(s),
  },
  { id: "quote", label: "Blockquote", keywords: "quote", icon: "quote", command: toggleQuote },
  {
    id: "callout",
    label: "Callout",
    keywords: "callout alert admonition info note tip important warning caution",
    icon: "light-bulb",
    command: toggleCallout(),
    when: (s) => !within(s, "panel"),
  },
  { id: "table", label: "Table", keywords: "", icon: "table", command: tableHere, when: (s) => !isInTable(s) },
  {
    id: "divider",
    label: "Divider",
    keywords: "horizontal rule line hr separator",
    icon: "divider",
    command: insertDivider,
    when: (s) => !isInTable(s) && !inList(s),
  },
];

// ponytail: tiers approximating Linear's command-score (prefix, word start, spaced-out, then substring for 4+ characters; keywords
// count half). Port command-score itself if its ordering is ever needed exactly.
function score(text: string, query: string) {
  const t = text.toLowerCase();
  if (t.startsWith(query)) return 1;
  if (t.split(/\s+/).some((word) => word.startsWith(query))) return 0.9;
  if (t.replace(/\s+/g, "").startsWith(query.replace(/\s+/g, ""))) return 0.8;
  return query.length > 3 && t.includes(query) ? 0.2 : 0;
}

/** The entries for the query at this caret: Linear's order with no query, best match first otherwise. */
export function matchingSlashCommands(query: string, state: EditorState, commands = SLASH_COMMANDS): SlashCommand[] {
  const q = query.toLowerCase().trim();
  const shown = commands.filter((c) => (!c.when || c.when(state, q)) && (!c.command || c.command(state)));
  if (!q) return shown;
  return shown
    .map((c) => ({ c, s: Math.max(score(c.matchLabel ?? c.label, q), c.keywords ? score(c.keywords, q) / 2 : 0) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.c);
}

// "/" at a line or word start (never in a URL or path), then a name of up to 20 characters with single spaces.
const trigger = caretTrigger("slash", /(?:^|\s)\/((?:[^\s/￼](?:[^\S\n]?[^\s/￼])*)?)$/, 20);
export const activeSlash = trigger.active;
export const dismissSlash = trigger.dismiss;
export const slashPlugin = trigger.plugin;
