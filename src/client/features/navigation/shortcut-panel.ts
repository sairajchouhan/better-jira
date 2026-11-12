/**
 * The keyboard-shortcuts panel's order, from Linear's HelpCenter chunk (HelpCenter.RUjT1v_p.js): its sections in Linear's order,
 * General first, and General's rows in Linear's order (Open command menu, Save or submit, Send comment, Back, Open search,
 * Open help menu, View keyboard shortcuts, …). Groups Linear doesn't have (Documents, Views, Code block) follow its last one.
 */
export const LINEAR_SHORTCUT_GROUPS = [
  "General",
  "Navigation",
  "Issues",
  "Projects",
  "Initiatives",
  "List / Board",
  "Timeline",
  "Comments",
  "Reviews",
  "Inbox",
  "Filters",
  "Triage",
  "Editor",
  "Markdown formatting",
  "Tabs",
  "Find in page",
];
const GENERAL_ORDER = ["commands", "back", "search", "help", "shortcuts"];

const rankIn = (list: readonly string[], value: string) => {
  const i = list.indexOf(value);
  return i < 0 ? list.length : i;
};

/** The panel's sections: each group's rows in the order given (General's in Linear's), the groups in Linear's order. */
export function shortcutSections<T extends { id: string; group: string }>(rows: T[]): { group: string; rows: T[] }[] {
  const groups = [...new Set(rows.map((row) => row.group))];
  return groups
    .map((group, at) => ({ group, at, rows: rows.filter((row) => row.group === group) }))
    .sort((a, b) => rankIn(LINEAR_SHORTCUT_GROUPS, a.group) - rankIn(LINEAR_SHORTCUT_GROUPS, b.group) || a.at - b.at)
    .map(({ group, rows }) => ({
      group,
      rows:
        group === "General"
          ? rows
              .map((row, at) => ({ row, at }))
              .sort((a, b) => rankIn(GENERAL_ORDER, a.row.id) - rankIn(GENERAL_ORDER, b.row.id) || a.at - b.at)
              .map(({ row }) => row)
          : rows,
    }));
}
