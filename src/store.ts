import { useSyncExternalStore } from "react";
import { textToAdf } from "./adf";

export type User = { id: string; name: string; avatar?: string };
export type Issue = {
  key: string;
  board: number;
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee: User | null;
  labels: string[];
  parent?: string;
  rank?: string;
  comments: number;
  updated: string;
  resolved: string | null;
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = { id: number; name: string; columns: Column[] };
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = { key: string; fields: any };
type Overlay = null | "palette" | "assign" | "status" | "create";
export type View = "side" | "page";

export const ME: User = { id: "63d764b982eeee78a4cd2b56", name: "Sairaj Chouhan" };

type State = {
  boards: Board[];
  issues: Map<string, Issue>;
  full: Map<string, Full>;
  board: number;
  selected: string | null;
  panel: boolean;
  /** Open issues in a side panel or as a full page. */
  view: View;
  mine: boolean;
  query: string;
  overlay: Overlay;
  editDesc: boolean;
  perf: string;
};

let state: State = {
  boards: [],
  issues: new Map(),
  full: new Map(),
  board: Number(localStorage.getItem("board")) || 4142,
  selected: null,
  panel: false,
  view: localStorage.getItem("view") === "page" ? "page" : "side",
  mine: false,
  query: "",
  overlay: null,
  editDesc: false,
  perf: "",
};

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const get = () => state;
export function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (patch.board) localStorage.setItem("board", String(patch.board));
  if (patch.view) localStorage.setItem("view", patch.view);
  listeners.forEach((l) => l());
}
/** Selector must return a stable reference (a state field or a Map entry), never a fresh object. */
export const useStore = <T>(sel: (s: State) => T) => useSyncExternalStore(subscribe, () => sel(state));

export async function load() {
  const [boards, issues]: [Board[], Issue[]] = await Promise.all([
    fetch("/api/boards").then((r) => r.json()),
    fetch("/api/issues").then((r) => r.json()),
  ]);
  ME.avatar = issues.find((i) => i.assignee?.id === ME.id)?.assignee?.avatar;
  set({ boards, issues: new Map(issues.map((i) => [i.key, i])) });
}

export async function loadFull(key: string) {
  if (state.full.has(key)) return;
  const res = await fetch(`/api/issues/${key}`);
  if (!res.ok) return;
  const full = await res.json(); // await before copying state.full, or parallel prefetches overwrite each other
  if (!state.full.has(key)) set({ full: new Map(state.full).set(key, full) });
}

/** Time from the action to the next painted frame, shown in the header. */
export function timed(label: string, fn: () => void) {
  const t0 = performance.now();
  fn();
  requestAnimationFrame(() => setTimeout(() => set({ perf: `${label} · ${(performance.now() - t0).toFixed(1)}ms` })));
}

const now = () => new Date().toISOString();

function patchIssue(key: string, patch: Partial<Issue>) {
  const i = state.issues.get(key);
  if (i) set({ issues: new Map(state.issues).set(key, { ...i, ...patch, updated: now() }) });
}

function patchFields(key: string, fn: (fields: any) => object) {
  const f = state.full.get(key);
  if (f) set({ full: new Map(state.full).set(key, { ...f, fields: { ...f.fields, ...fn(f.fields) } }) });
}

export const boardOf = (key: string) => state.boards.find((b) => b.id === state.issues.get(key)?.board);

let localSeq = 0;

// ponytail: writes are local only (lost on reload). Step 2 sends each one to Jira and reverts on failure.
export const actions = {
  /** Move to a column's first status; no-op if the issue is already in that column. */
  move(key: string, col: number) {
    const c = boardOf(key)?.columns[col];
    if (c?.statuses[0] && !c.statuses.some((x) => x.id === state.issues.get(key)?.status)) actions.status(key, c.statuses[0].id);
  },
  status(key: string, id: string) {
    const i = state.issues.get(key);
    const s = boardOf(key)?.columns.flatMap((c) => c.statuses).find((x) => x.id === id);
    set({ overlay: null });
    if (!i || !s || i.status === id) return;
    timed(`move ${key} → ${s.name}`, () =>
      patchIssue(key, { status: s.id, resolved: s.category === "done" ? (i.resolved ?? now()) : null }),
    );
  },
  assign(key: string, user: User | null) {
    timed(`assign ${key} → ${user?.name ?? "Unassigned"}`, () => {
      patchIssue(key, { assignee: user });
      set({ overlay: null });
    });
  },
  summary(key: string, summary: string) {
    if (summary.trim() && summary !== state.issues.get(key)?.summary)
      timed(`edit ${key} summary`, () => patchIssue(key, { summary: summary.trim() }));
  },
  description(key: string, text: string) {
    timed(`edit ${key} description`, () => {
      patchFields(key, () => ({ description: text.trim() ? textToAdf(text) : null }));
      set({ editDesc: false });
    });
  },
  comment(key: string, text: string) {
    if (!text.trim()) return;
    timed(`comment on ${key}`, () => {
      const c = {
        id: `local-${++localSeq}`,
        author: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        body: textToAdf(text),
        created: now(),
      };
      patchFields(key, (f) => ({ comment: { ...f.comment, comments: [...f.comment.comments, c], total: f.comment.total + 1 } }));
      patchIssue(key, { comments: (state.issues.get(key)?.comments ?? 0) + 1 });
    });
  },
  create(summary: string) {
    const board = state.boards.find((b) => b.id === state.board);
    const status = board?.columns[0]?.statuses[0];
    if (!board || !status || !summary.trim()) return;
    const prefix = [...state.issues.values()].find((i) => i.board === board.id)?.key.split("-")[0];
    const key = `${prefix}-NEW${++localSeq}`;
    timed(`create ${key}`, () => {
      const issue: Issue = {
        key, board: board.id, summary: summary.trim(), status: status.id, type: "Task", priority: "Normal",
        assignee: null, labels: [], rank: "0", comments: 0, updated: now(), resolved: null,
      };
      const full: Full = {
        key,
        fields: {
          description: null, created: now(), comment: { comments: [], total: 0 },
          reporter: { accountId: ME.id, displayName: ME.name, avatarUrls: { "24x24": ME.avatar } },
        },
      };
      set({
        issues: new Map(state.issues).set(key, issue),
        full: new Map(state.full).set(key, full),
        selected: key, panel: true, overlay: null,
      });
    });
  },
};
