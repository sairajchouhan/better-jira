import { useState } from "react";
import {
  formatForDisplay,
  useHotkeys,
  type Hotkey,
  type UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import {
  actions,
  beginCreate,
  boardOf,
  changeDisplay,
  changePreferences,
  get,
  issueURL,
  loadFull,
  ME,
  navigate,
  preferencesFor,
  redoEdit,
  set,
  toggleFavorite,
  ui,
  undoEdit,
  useStore,
  type Issue,
  type Overlay,
} from "./store";
import { buckets, columnInScope, rankBetween } from "./view-model";
import { issueCopy, type CopyKind } from "./issue-copy";
import { editorBindings } from "./editor-bindings";
import { MenuSurface } from "./menu-surface";

type Shortcut = {
  id: string;
  name: string;
  group: string;
  hotkey: Hotkey;
  issue?: boolean;
  run: () => void;
  when?: () => boolean;
};
let columns: () => Issue[][] = () => [];
const selected = () =>
  get().selected ? get().issues.get(get().selected!) : undefined;
const issueAction = (fn: (issue: Issue) => void) => () => {
  const issue = selected();
  if (issue) fn(issue);
};
const overlay = (value: NonNullable<Overlay>) => () =>
  ui.send({ type: "overlay.open", overlay: value });
const focus = (id: string) =>
  issueAction((issue) => {
    navigate({ selected: issue.key, panel: true });
    let tries = 0;
    const attempt = () => {
      if (get().selected !== issue.key || !get().panel) return;
      const node = document.getElementById(id);
      if (node) node.focus();
      else if (tries++ < 100) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  });
function move(direction: number, horizontal = false) {
  const s = get(),
    cols = columns(),
    flat = [...new Map(cols.flat().map((i) => [i.key, i])).values()];
  if (s.panel && !horizontal) {
    const index = flat.findIndex((i) => i.key === s.selected);
    const next = flat[index < 0 ? 0 : index + direction];
    if (next) navigate({ selected: next.key });
    return;
  }
  const col = cols.findIndex((c) => c.some((i) => i.key === s.selected)),
    row = cols[col]?.findIndex((i) => i.key === s.selected) ?? 0;
  let next: Issue | undefined;
  if (col < 0) next = flat[0];
  else if (horizontal) {
    for (let c = col + direction; c >= 0 && c < cols.length; c += direction) {
      next =
        cols[c]!.filter((i) => i.key !== s.selected)[row] ??
        cols[c]!.find((i) => i.key !== s.selected);
      if (next) break;
    }
  } else next = cols[col]?.[row + direction];
  if (next) navigate({ selected: next.key });
}
function moveColumn(direction: number) {
  const issue = selected();
  if (!issue) return;
  const board = boardOf(issue.key)!,
    prefs = preferencesFor(issue.board);
  const choices = board.columns.filter((c) => columnInScope(c, prefs.scope));
  if (prefs.display.groupDescending) choices.reverse();
  const at = choices.findIndex((c) =>
    c.statuses.some((s) => s.id === issue.status),
  );
  const target = choices[at + direction]?.statuses[0];
  if (at >= 0 && target) actions.status(issue.key, target.id);
}
function reorder(direction: number, edge = false) {
  const issue = selected();
  if (!issue) return;
  const list = columns().find((c) => c.some((i) => i.key === issue.key));
  if (!list) return;
  const i = list.findIndex((x) => x.key === issue.key),
    rest = list.filter((x) => x.key !== issue.key),
    at = edge
      ? direction < 0
        ? 0
        : rest.length
      : Math.max(0, Math.min(rest.length, i + direction));
  if (at === i) return;
  const descending = preferencesFor(issue.board).display.descending;
  const a = rest[at - 1]?.rank,
    b = rest[at]?.rank;
  actions.drop(
    issue.key,
    issue.board,
    [],
    descending ? rankBetween(b, a) : rankBetween(a, b),
  );
}
const manual = () => preferencesFor(get().board).display.ordering === "manual";
function scope(value: "active" | "backlog" | "all", mine = false) {
  ui.send({ type: "mine.set", mine });
  navigate({ panel: false, selected: null });
  changePreferences(get().board, { scope: value });
}
async function copy(kind: CopyKind) {
  const issue = selected();
  if (!issue) return;
  try {
    if (kind === "everything as Markdown" && !get().full.has(issue.key)) {
      await loadFull(issue.key);
      if (!get().full.has(issue.key))
        throw new Error("Issue details unavailable");
    }
    const full = get().full.get(issue.key),
      status =
        boardOf(issue.key)
          ?.columns.flatMap((c) => c.statuses)
          .find((s) => s.id === issue.status)?.name ?? issue.status;
    await navigator.clipboard.writeText(
      issueCopy(kind, issue, full, issueURL(issue), status),
    );
    set({ perf: `Copied ${kind}` });
  } catch {
    set({ perf: "Could not access the clipboard" });
  }
}
function relation(kind: string) {
  set({ relationKind: kind });
  ui.send({ type: "overlay.open", overlay: "relations" });
}
function collapse(all = false) {
  const s = get(),
    board = s.boards.find((b) => b.id === s.board);
  if (!board) return;
  const prefs = preferencesFor(s.board),
    by = prefs.display.columns,
    groups = buckets(
      [...s.issues.values()].filter((i) => i.board === s.board),
      by,
      board,
      [...s.issues.values()],
    );
  const ids = all
    ? groups.map((g) => g.id)
    : groups
        .filter((g) => g.issues.some((i) => i.key === s.selected))
        .map((g) => g.id);
  const current = prefs.collapsed[by] ?? [],
    closed = ids.every((id) => current.includes(id));
  changePreferences(s.board, {
    collapsed: {
      ...prefs.collapsed,
      [by]: closed
        ? current.filter((id) => !ids.includes(id))
        : [...new Set([...current, ...ids])],
    },
  });
}

/** Live Linear Chrome reference, 6 Nov 2026. Only existing personal workflows are included. */
export const shortcuts: Shortcut[] = [
  {
    id: "commands",
    name: "Open command menu",
    group: "General",
    hotkey: "Mod+K",
    run: () => ui.send({ type: "palette.toggle" }),
  },
  {
    id: "help",
    name: "Open help menu",
    group: "General",
    hotkey: "Shift+?",
    run: overlay("help"),
  },
  {
    id: "shortcuts",
    name: "View keyboard shortcuts",
    group: "General",
    hotkey: "Mod+/",
    run: () =>
      get().overlay === "shortcuts"
        ? ui.send({ type: "overlay.close" })
        : overlay("shortcuts")(),
  },
  {
    id: "search",
    name: "Open search",
    group: "General",
    hotkey: "/",
    run: overlay("search"),
  },
  {
    id: "back",
    name: "Back / clear selection",
    group: "General",
    hotkey: "Escape",
    run: () => ui.send({ type: "escape" }),
  },
  {
    id: "undo",
    name: "Undo",
    group: "General",
    hotkey: "Mod+Z",
    run: undoEdit,
  },
  {
    id: "redo",
    name: "Redo",
    group: "General",
    hotkey: "Mod+Shift+Z",
    run: redoEdit,
  },
  {
    id: "sidebar",
    name: "Toggle left sidebar",
    group: "Navigation",
    hotkey: "[",
    run: () => ui.send({ type: "sidebar.toggle" }),
  },
  {
    id: "details",
    name: "Toggle right sidebar",
    group: "Navigation",
    hotkey: "]",
    run: () =>
      get().panel
        ? set({ issuePropertiesHidden: !get().issuePropertiesHidden })
        : set({ details: !get().details }),
  },
  {
    id: "open-issue",
    name: "Open issue",
    group: "Navigation",
    hotkey: ["O", "I"],
    run: overlay("search"),
  },
  {
    id: "active",
    name: "Go to active issues",
    group: "Navigation",
    hotkey: ["G", "A"],
    run: () => scope("active"),
  },
  {
    id: "backlog",
    name: "Go to backlog",
    group: "Navigation",
    hotkey: ["G", "B"],
    run: () => scope("backlog"),
  },
  {
    id: "all",
    name: "Go to all issues",
    group: "Navigation",
    hotkey: ["G", "E"],
    run: () => scope("all"),
  },
  {
    id: "mine",
    name: "Go to my issues",
    group: "Navigation",
    hotkey: ["G", "M"],
    run: () => scope("all", true),
  },
  {
    id: "favorite-open",
    name: "Open a favorite",
    group: "Navigation",
    hotkey: ["O", "F"],
    run: overlay("favorites"),
  },
  {
    id: "team-open",
    name: "Open a team / board",
    group: "Navigation",
    hotkey: ["O", "T"],
    run: overlay("boards"),
  },
  ...Array.from({ length: 9 }, (_, i): Shortcut => ({
    id: `team-${i + 1}`,
    name: `Go to team / board ${i + 1}`,
    group: "Navigation",
    hotkey: `Control+Shift+${i + 1}` as Hotkey,
    when: () => !!get().boards[i],
    run: () => {
      const board = get().boards[i];
      if (board) navigate({ board: board.id, selected: null, panel: false });
    },
  })),
  {
    id: "view-open",
    name: "Open view",
    group: "Navigation",
    hotkey: ["O", "V"],
    run: overlay("views"),
  },
  {
    id: "display",
    name: "Show display options",
    group: "Navigation",
    hotkey: "Shift+V",
    run: () => ui.send({ type: "toolbar.open", toolbar: "display" }),
    when: () => !get().panel || get().view !== "page",
  },
  {
    id: "toast-open",
    name: "Open link from last toast",
    group: "Navigation",
    hotkey: "Mod+Alt+O",
    when: () => !!get().toast?.key,
    run: () => {
      const issue = get().issues.get(get().toast?.key ?? "");
      if (issue)
        navigate({ board: issue.board, selected: issue.key, panel: true });
    },
  },
  {
    id: "dismiss-toast",
    name: "Dismiss all toasts",
    group: "Navigation",
    hotkey: "Mod+Alt+X",
    run: () => ui.send({ type: "toast.dismiss" }),
  },
  {
    id: "new",
    name: "New issue",
    group: "Issues",
    hotkey: "C",
    run: () => beginCreate(),
  },
  {
    id: "new-full",
    name: "New issue in full screen view",
    group: "Issues",
    hotkey: "V",
    run: () => {
      set({ createExpanded: true });
      beginCreate();
    },
  },
  ...(
    [
      ["assign", "Assign issue to user", "A", "assign"],
      ["status", "Change issue status", "S", "status"],
      ["priority", "Change priority", "P", "priority"],
      ["labels", "Change labels", "L", "labels"],
      ["due", "Set due date", "Shift+D", "due"],
      ["project", "Add to project", "Shift+P", "project"],
      ["milestone", "Add to project milestone", "Shift+M", "milestone"],
    ] as const
  ).map(([id, name, hotkey, value]) => ({
    id,
    name,
    hotkey,
    group: "Issues",
    issue: true,
    run: overlay(value),
  })),
  {
    id: "assign-me",
    name: "Assign to me",
    group: "Issues",
    hotkey: "I",
    issue: true,
    run: issueAction((i) => actions.assign(i.key, ME)),
  },
  {
    id: "remove-due",
    name: "Remove due date",
    group: "Issues",
    hotkey: "Mod+Shift+D",
    issue: true,
    run: issueAction((i) => actions.patch(i.key, { due: null })),
  },
  {
    id: "rename",
    name: "Rename",
    group: "Issues",
    hotkey: "Shift+R",
    issue: true,
    run: focus("summary"),
  },
  {
    id: "description",
    name: "Focus issue description input",
    group: "Issues",
    hotkey: "Control+Shift+I",
    issue: true,
    run: () => ui.send({ type: "description.edit" }),
  },
  {
    id: "favorite",
    name: "Mark as favorite",
    group: "Issues",
    hotkey: "Alt+F",
    issue: true,
    run: issueAction((i) => toggleFavorite(i.key)),
  },
  {
    id: "delete",
    name: "Delete issue locally",
    group: "Issues",
    hotkey: "Mod+Backspace",
    issue: true,
    run: issueAction((i) => actions.remove(i.key)),
  },
  {
    id: "subscribe",
    name: "Subscribe to issue",
    group: "Issues",
    hotkey: "Shift+S",
    issue: true,
    run: issueAction((i) =>
      actions.patch(i.key, {
        watchers: i.watchers?.some((w) => w.id === ME.id)
          ? i.watchers.filter((w) => w.id !== ME.id)
          : [...(i.watchers ?? []), ME],
      }),
    ),
  },
  ...(
    [
      ["blocked", "Mark as blocked", "B"],
      ["blocking", "Mark as blocking", "X"],
      ["related", "Reference related issue", "R"],
      ["duplicate", "Mark as duplicate", "M"],
    ] as const
  ).map(([id, name, last]) => ({
    id,
    name,
    group: "Issues",
    hotkey: ["M", last] as Hotkey,
    issue: true,
    run: () => relation(id),
  })),
  {
    id: "link",
    name: "Link any URL to issue",
    group: "Issues",
    hotkey: "Control+L",
    issue: true,
    run: () => {
      set({ issueOptionsStart: "link" });
      navigate({ panel: true });
      overlay("options")();
    },
  },
  {
    id: "sub-issue",
    name: "Create sub-issue",
    group: "Issues",
    hotkey: "Mod+Shift+O",
    issue: true,
    run: issueAction((i) => beginCreate({ parent: i.key, project: i.project })),
  },
  {
    id: "parent-set",
    name: "Set parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+P",
    issue: true,
    run: () => relation("parent"),
  },
  {
    id: "parent-open",
    name: "Open parent issue",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowUp",
    issue: true,
    run: issueAction((i) => {
      const parent = get().issues.get(i.parent ?? "");
      if (parent)
        navigate({ board: parent.board, selected: parent.key, panel: true });
    }),
  },
  {
    id: "child-open",
    name: "Open sub-issue",
    group: "Issues",
    hotkey: "Mod+Shift+ArrowDown",
    issue: true,
    run: issueAction((i) => {
      const child = [...get().issues.values()].find((c) => c.parent === i.key);
      if (child)
        navigate({ board: child.board, selected: child.key, panel: true });
    }),
  },
  ...(
    [
      ["copy-id", "Copy issue id", "Mod+.", "ID"],
      ["copy-branch", "Copy git branch name", "Mod+Shift+.", "git branch name"],
      ["copy-url", "Copy issue URL", "Mod+Shift+,", "URL"],
      ["copy-title", "Copy issue title", "Mod+Shift+'", "title"],
      [
        "copy-markdown",
        "Copy everything as Markdown",
        "Mod+Alt+C",
        "everything as Markdown",
      ],
    ] as const
  ).map(([id, name, hotkey, kind]) => ({
    id,
    name,
    hotkey,
    group: "Issues",
    issue: true,
    run: () => void copy(kind),
  })),
  {
    id: "comment",
    name: "Comment on issue",
    group: "Comments",
    hotkey: "Control+M",
    issue: true,
    run: focus("comment"),
  },
  {
    id: "peek",
    name: "Peek into item",
    group: "List / Board",
    hotkey: "Space",
    issue: true,
    run: () => navigate({ panel: true, view: "side" }),
  },
  {
    id: "open",
    name: "Open focused item",
    group: "List / Board",
    hotkey: "Enter",
    issue: true,
    run: () => navigate({ panel: true, view: "page" }),
  },
  {
    id: "layout",
    name: "Toggle layout view",
    group: "List / Board",
    hotkey: "Mod+B",
    run: () => {
      const d = preferencesFor(get().board).display;
      changeDisplay(get().board, {
        layout: d.layout === "board" ? "list" : "board",
      });
    },
  },
  {
    id: "copy-page",
    name: "Copy page URL",
    group: "List / Board",
    hotkey: "Mod+Shift+C",
    run: () => {
      void navigator.clipboard
        .writeText(location.href)
        .then(() => set({ perf: "Copied page URL" }))
        .catch(() => set({ perf: "Could not access the clipboard" }));
    },
  },
  ...(
    [
      ["up", "Move up", "ArrowUp", -1, false],
      ["up-vim", "Move up", "K", -1, false],
      ["down", "Move down", "ArrowDown", 1, false],
      ["down-vim", "Move down", "J", 1, false],
      ["left", "Move left", "ArrowLeft", -1, true],
      ["right", "Move right", "ArrowRight", 1, true],
    ] as const
  ).map(([id, name, hotkey, dir, horizontal]) => ({
    id,
    name,
    hotkey,
    group: "List / Board",
    run: () => move(dir, horizontal),
  })),
  ...(
    [
      ["reorder-up", "Move one position up", "Alt+ArrowUp", -1, false],
      ["reorder-down", "Move one position down", "Alt+ArrowDown", 1, false],
      ["reorder-top", "Move to top of group", "Alt+Shift+ArrowUp", -1, true],
      [
        "reorder-bottom",
        "Move to bottom of group",
        "Alt+Shift+ArrowDown",
        1,
        true,
      ],
    ] as const
  ).map(([id, name, hotkey, dir, edge]) => ({
    id,
    name,
    hotkey,
    group: "List / Board",
    issue: true,
    when: manual,
    run: () => reorder(dir, edge),
  })),
  {
    id: "column-left",
    name: "Move to left column",
    group: "List / Board",
    hotkey: "Alt+ArrowLeft",
    issue: true,
    when: () => preferencesFor(get().board).display.columns === "status",
    run: () => moveColumn(-1),
  },
  {
    id: "column-right",
    name: "Move to right column",
    group: "List / Board",
    hotkey: "Alt+ArrowRight",
    issue: true,
    when: () => preferencesFor(get().board).display.columns === "status",
    run: () => moveColumn(1),
  },
  {
    id: "collapse",
    name: "Collapse/expand group",
    group: "List / Board",
    hotkey: "T",
    issue: true,
    when: () => preferencesFor(get().board).display.layout === "list",
    run: () => collapse(),
  },
  {
    id: "collapse-all",
    name: "Collapse/expand all groups",
    group: "List / Board",
    hotkey: "Alt+T",
    when: () => preferencesFor(get().board).display.layout === "list",
    run: () => collapse(true),
  },
  {
    id: "find",
    name: "Find in view",
    group: "Filters",
    hotkey: "Mod+F",
    when: () => !get().panel || get().view !== "page",
    run: () => {
      set({ findInView: true });
      requestAnimationFrame(() =>
        document.getElementById("find-in-view")?.focus(),
      );
    },
  },
  {
    id: "filter",
    name: "Add filter",
    group: "Filters",
    hotkey: "F",
    run: () => ui.send({ type: "toolbar.open", toolbar: "filter" }),
  },
  {
    id: "filter-clear",
    name: "Clear all filters",
    group: "Filters",
    hotkey: "Alt+Shift+F",
    run: () => {
      const p = preferencesFor(get().board);
      changePreferences(get().board, {
        filters: { ...p.filters, children: [] },
      });
    },
  },
  {
    id: "filter-last",
    name: "Clear last issue filter",
    group: "Filters",
    hotkey: "Shift+F",
    run: () => {
      const p = preferencesFor(get().board);
      changePreferences(get().board, {
        filters: { ...p.filters, children: p.filters.children.slice(0, -1) },
      });
    },
  },
];
export function shortcutLabel(id: string) {
  const entry = shortcuts.find((s) => s.id === id);
  return entry
    ? formatForDisplay(id === "help" ? "?" : entry.hotkey, {
        sequenceSeparator: " then ",
      })
    : "";
}
export function runShortcut(id: string) {
  const entry = shortcuts.find((s) => s.id === id);
  if (entry && (!entry.issue || selected()) && (!entry.when || entry.when()))
    entry.run();
}
export function useLinearHotkeys(getColumns: () => Issue[][]) {
  columns = getColumns;
  const state = useStore((s) => s);
  useHotkeys(
    shortcuts.map(
      (entry) =>
        ({
          hotkey: entry.hotkey,
          callback: () => runShortcut(entry.id),
          options: {
            enabled:
              state.boards.length > 0 &&
              ((!state.overlay && !state.toolbar) ||
                (entry.id === "commands" && state.overlay === "palette") ||
                (entry.id === "shortcuts" && state.overlay === "shortcuts")) &&
              (!entry.issue || !!selected()) &&
              (!entry.when || entry.when()),
            ignoreInputs:
              entry.id === "shortcuts" || entry.id === "commands"
                ? false
                : true,
            meta: { name: entry.name, group: entry.group },
          },
        }) as UseHotkeyDefinition,
    ),
    { ignoreDefaultPrevented: true },
  );
}
export function ShortcutHelp() {
  const [query, setQuery] = useState("");
  const catalog = [
    ...shortcuts.filter(
      (s) =>
        !/^team-\d+$/.test(s.id) ||
        Number(s.id.slice(5)) <= get().boards.length,
    ),
    ...editorBindings.map((b) => ({
      ...b,
      id: `editor-${b.id}`,
      group: "Editor",
    })),
  ];
  const words = query
    .toLowerCase()
    .split(/[+\s]+/)
    .filter(Boolean);
  const matches = catalog.filter((s) => {
    const names = formatForDisplay(s.hotkey, { useSymbols: false });
    const raw = Array.isArray(s.hotkey) ? s.hotkey.join(" ") : s.hotkey;
    const text =
      `${s.name} ${s.group} ${names} ${raw} ${formatForDisplay(s.hotkey)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return (
    <MenuSurface
      label="Keyboard Shortcuts"
      width={720}
      close={() => ui.send({ type: "overlay.close" })}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-fg">Keyboard Shortcuts</h2>
        <button
          aria-label="Close dialog"
          onClick={() => ui.send({ type: "overlay.close" })}
        >
          ×
        </button>
      </div>
      <p className="mb-3 text-[12px] text-fg-3">
        Issue actions need a selected issue. Editor shortcuts apply while
        typing. Reordering requires Manual ordering.
      </p>
      <input
        aria-label="Search shortcuts"
        autoFocus
        placeholder="Search shortcuts…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-4 w-full rounded border border-line-2 bg-card px-3 py-2 outline-none focus:border-accent"
      />
      <div className="max-h-[60vh] overflow-y-auto">
        {[...new Set(matches.map((s) => s.group))].map((group) => (
          <section key={group} className="mb-5">
            <h3 className="mb-2 text-[12px] text-fg-3">{group}</h3>
            <dl>
              {matches
                .filter((s) => s.group === group)
                .map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 py-1.5 text-[12px]"
                  >
                    <dt className="flex-1">{s.name}</dt>
                    <dd>
                      <kbd className="rounded border border-line-2 px-1.5 py-0.5">
                        {formatForDisplay(s.id === "help" ? "?" : s.hotkey, {
                          sequenceSeparator: " then ",
                        })}
                      </kbd>
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
        {!matches.length && <p className="p-3 text-fg-3">No shortcuts found</p>}
      </div>
    </MenuSurface>
  );
}
export function HelpMenu() {
  return (
    <MenuSurface
      label="Help"
      anchorId="help-menu"
      width={280}
      close={() => ui.send({ type: "overlay.close" })}
    >
      <button
        aria-label="Keyboard shortcuts"
        className="flex w-full items-center gap-4 rounded px-3 py-2 text-left hover:bg-hover"
        onClick={overlay("shortcuts")}
      >
        <span className="flex-1">Keyboard shortcuts</span>
        <kbd>{shortcutLabel("shortcuts")}</kbd>
      </button>
    </MenuSurface>
  );
}
