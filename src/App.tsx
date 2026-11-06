import "@fontsource-variable/inter";
import "./index.css";
import { Command } from "cmdk";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Adf, adfToText } from "./adf";
import { Icon, Label, PriorityIcon, StatusIcon, TypeDot } from "./icons";
import {
  ME, actions, boardOf, get, load, loadFull, set, timed, useStore,
  type Board, type Column, type Issue, type User,
} from "./store";

const JIRA = "https://contentstack.atlassian.net";
const WEEK = 7 * 864e5;

/** The active board's visible columns, for keyboard navigation and the issue page's ↑ ↓ stepping. */
const nav = { cols: [] as Issue[][] };

const statusOf = (i: Issue) => boardOf(i.key)?.columns.flatMap((c) => c.statuses).find((s) => s.id === i.status);
const colLook = (c: Column) => ({ name: c.name, category: c.statuses[0]?.category ?? "new" });

/** The visible cards per column, like Jira's Kanban: done issues only for 7 days after resolution. */
function useColumns(board: Board | undefined): Issue[][] {
  const issues = useStore((s) => s.issues);
  const mine = useStore((s) => s.mine);
  const query = useStore((s) => s.query);
  return useMemo(() => {
    if (!board) return [];
    const colOf = new Map<string, [number, string]>();
    board.columns.forEach((c, i) => c.statuses.forEach((s) => colOf.set(s.id, [i, s.category])));
    const cutoff = Date.now() - WEEK;
    const q = query.trim().toLowerCase();
    const cols: Issue[][] = board.columns.map(() => []);
    for (const i of issues.values()) {
      if (i.board !== board.id) continue;
      const c = colOf.get(i.status);
      if (!c) continue;
      if (c[1] === "done" && !(i.resolved && Date.parse(i.resolved) >= cutoff)) continue;
      if (mine && i.assignee?.id !== ME.id) continue;
      if (q && !`${i.key} ${i.summary}`.toLowerCase().includes(q)) continue;
      cols[c[0]]!.push(i);
    }
    for (const c of cols) c.sort((a, b) => ((a.rank ?? "") < (b.rank ?? "") ? -1 : 1));
    return cols;
  }, [issues, board, mine, query]);
}

export function App() {
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const selected = useStore((s) => s.selected);
  const view = useStore((s) => s.view);
  const overlay = useStore((s) => s.overlay);
  const open = useStore((s) => (s.panel && s.selected ? s.issues.get(s.selected) : undefined));

  useEffect(() => void load(), []);
  useEffect(() => (window.addEventListener("keydown", onKey), () => window.removeEventListener("keydown", onKey)), []);

  if (!boards.length) return <div className="p-6 text-fg-3">Loading…</div>;
  const page = !!open && view === "page";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1">
      <Sidebar boards={boards} />
      <main className="my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[0.5px] border-frame bg-panel shadow-(--frame-shadow)">
        {!page && <BoardHeader />}
        <div className="flex min-h-0 flex-1">
          {/* Both boards stay mounted (hidden behind the issue page too), so switching back is a display toggle. */}
          {boards.map((b) => (
            <BoardView key={b.id} board={b} active={b.id === boardId} shown={!page && b.id === boardId} selected={selected} />
          ))}
          {open && <IssueView key={open.key} issue={open} page={page} />}
        </div>
      </main>
      </div>
      <StatusBar />
      {overlay === "palette" && <Palette />}
      {overlay === "assign" && selected && <AssignPicker issueKey={selected} />}
      {overlay === "status" && selected && <StatusPicker issueKey={selected} />}
      {overlay === "create" && <CreateDialog />}
    </div>
  );
}

function BoardView({ board, active, shown, selected }: { board: Board; active: boolean; shown: boolean; selected: string | null }) {
  const columns = useColumns(board);
  if (active) nav.cols = columns;

  // Prefetch the selected issue and the two on each side, so opening or stepping to them is instant.
  useEffect(() => {
    if (!active || !selected) return;
    loadFull(selected);
    const flat = columns.flat();
    const i = flat.findIndex((x) => x.key === selected);
    if (i >= 0) for (const d of [-2, -1, 1, 2]) flat[i + d] && loadFull(flat[i + d]!.key);
  }, [active, selected, columns]);

  return (
    <div className={`${shown ? "flex" : "hidden"} min-w-0 flex-1 gap-4 overflow-x-auto px-2 pt-1`}>
      {board.columns.map((col, i) => (
        <ColumnView key={col.name} col={col} index={i} issues={columns[i] ?? []} selected={selected} />
      ))}
    </div>
  );
}

// --- keyboard ---

function onKey(e: KeyboardEvent) {
  const s = get();
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    return set({ overlay: s.overlay === "palette" ? null : "palette" });
  }
  if (s.overlay) return e.key === "Escape" && set({ overlay: null });
  const t = e.target as HTMLElement;
  if (t.matches("input, textarea")) return e.key === "Escape" && t.blur();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (press(e.key)) e.preventDefault();
}

/** Runs one shortcut. The palette calls this too, so each command's hint is the real key. */
function press(key: string): boolean {
  const s = get();
  const sel = s.selected;
  const cols = nav.cols;
  const page = s.panel && s.view === "page" && !!sel;
  const select = (k?: string) => k && timed(`select ${k}`, () => set({ selected: k }));
  const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const down = key === "j" || key === "ArrowDown";
  const up = key === "k" || key === "ArrowUp";
  const side = key === "h" || key === "l" || key === "ArrowLeft" || key === "ArrowRight";

  if (page && (down || up)) {
    const flat = cols.flat();
    const i = flat.findIndex((x) => x.key === sel);
    select(flat[i < 0 ? 0 : i + (down ? 1 : -1)]?.key);
    return true;
  }
  if (page && side) return false;
  const ci = cols.findIndex((c) => c.some((i) => i.key === sel));
  const ii = ci >= 0 ? cols[ci]!.findIndex((i) => i.key === sel) : -1;
  if (ci < 0 && (down || up || side)) return select(cols.find((c) => c.length)?.[0]?.key), true;
  const sideways = (dir: number) => {
    for (let c = ci + dir; c >= 0 && c < cols.length; c += dir)
      if (cols[c]!.length) return select(cols[c]![Math.min(ii, cols[c]!.length - 1)]!.key);
  };

  switch (key) {
    case "j": case "ArrowDown": select(cols[ci]![ii + 1]?.key); break;
    case "k": case "ArrowUp": select(cols[ci]![ii - 1]?.key); break;
    case "h": case "ArrowLeft": sideways(-1); break;
    case "l": case "ArrowRight": sideways(1); break;
    case "Enter": case "o":
      if (!sel) return false;
      timed(s.panel ? "close issue" : `open ${sel}`, () => set({ panel: !s.panel }));
      break;
    case "Escape": s.panel ? set({ panel: false }) : s.query ? set({ query: "" }) : set({ selected: null }); break;
    case "/": focus("search"); break;
    case "m": timed("only mine", () => set({ mine: !s.mine })); break;
    case "v": timed("issue view", () => set({ view: s.view === "page" ? "side" : "page" })); break;
    case "b": {
      const i = s.boards.findIndex((b) => b.id === s.board);
      timed("switch board", () => set({ board: s.boards[(i + 1) % s.boards.length]!.id, selected: null, panel: false }));
      break;
    }
    case "n": set({ overlay: "create" }); break;
    case "s": if (!sel) return false; set({ overlay: "status" }); break;
    case "a": if (!sel) return false; set({ overlay: "assign" }); break;
    case "i": if (!sel) return false; actions.assign(sel, s.issues.get(sel)?.assignee?.id === ME.id ? null : ME); break;
    case "c": if (!sel) return false; set({ panel: true }); focus("comment"); break;
    case "e": if (!sel) return false; set({ panel: true }); focus("summary"); break;
    case "d": if (!sel) return false; set({ panel: true, editDesc: true }); break;
    default:
      if (/^[1-9]$/.test(key) && sel) actions.move(sel, Number(key) - 1);
      else return false;
  }
  return true;
}

// --- chrome ---

function Sidebar({ boards }: { boards: Board[] }) {
  const boardId = useStore((s) => s.board);
  const view = useStore((s) => s.view);
  return (
    <nav className="flex w-[244px] shrink-0 flex-col gap-px p-2 font-medium">
      <div className="mb-1 flex h-11 items-center gap-2 px-2 text-fg">
        <span className="grid size-[18px] place-items-center rounded-[5px] bg-accent text-[10px] font-semibold text-white">bj</span>
        better-jira
      </div>
      <SideItem onClick={() => set({ overlay: "palette" })}>
        <Icon name="search" /> Search <kbd className="ml-auto">⌘K</kbd>
      </SideItem>
      <SideItem onClick={() => set({ overlay: "create" })}>
        <Icon name="plus" /> New issue <kbd className="ml-auto">N</kbd>
      </SideItem>

      <div className="mt-5 mb-1 px-2 text-[12px] text-fg-3">Boards</div>
      {boards.map((b) => (
        <SideItem key={b.id} active={b.id === boardId} onClick={() => timed("switch board", () => set({ board: b.id, selected: null, panel: false }))}>
          <span className="grid size-4 shrink-0 place-items-center rounded-[4px] bg-sel text-[9px] font-semibold text-fg-2">{b.name[0]}</span>
          <span className="truncate">{b.name}</span>
        </SideItem>
      ))}

      <div className="mt-5 mb-1.5 flex items-center px-2 text-[12px] text-fg-3">Open issues in <kbd className="ml-auto">V</kbd></div>
      <div className="mx-1 grid grid-cols-2 rounded-lg border border-line-2 p-0.5 text-[12px]">
        {(["side", "page"] as const).map((v) => (
          <button key={v} onClick={() => set({ view: v })} className={`h-6 rounded-md ${view === v ? "bg-sel text-fg" : "text-fg-3 hover:text-fg-2"}`}>
            {v === "side" ? "Side panel" : "Full page"}
          </button>
        ))}
      </div>

    </nav>
  );
}

/** Linear's 28px bottom bar under the sidebar and panel; ours carries the perf readout and the local-only note. */
function StatusBar() {
  const perf = useStore((s) => s.perf);
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 px-4 text-[11px]">
      <span className="flex items-center gap-1.5 text-amber-500"><span className="size-1.5 rounded-full bg-amber-500" />Local only: nothing is sent to Jira</span>
      <span className="ml-auto truncate font-mono text-emerald-500">{perf}</span>
    </footer>
  );
}

const SideItem = ({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick} className={`flex h-7 items-center gap-2 rounded-lg pr-[9px] pl-2 text-left ${active ? "bg-sel text-fg" : "text-fg-2 hover:bg-hover"}`}>
    {children}
  </button>
);

// Linear's pill button: 28px, 0.5px ring drawn as a shadow, 12px/500.
const PILL = "flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium";
const CIRCLE = "flex h-7 min-w-7 shrink-0 items-center rounded-full bg-btn text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2";

function BoardHeader() {
  const board = useStore((s) => s.boards.find((b) => b.id === s.board));
  const query = useStore((s) => s.query);
  const mine = useStore((s) => s.mine);
  const view = useStore((s) => s.view);
  const tab = (on: boolean, label: ReactNode, title?: string) => (
    <button
      title={title}
      onClick={() => mine !== on && timed("only mine", () => set({ mine: on }))}
      className={`${PILL} ${mine === on ? "bg-tab-on text-fg shadow-(--tab-on-shadow)" : "bg-tab text-fg-3 shadow-(--tab-shadow) hover:bg-hover hover:text-fg-2"}`}
    >
      {label}
    </button>
  );
  return (
    <header className="shrink-0">
      <div className="flex h-11 items-center justify-between border-b-[0.5px] border-frame px-2">
        <div className="flex items-center px-2 text-[13px] font-medium text-fg-2">
          <span className="mr-2.5 grid size-4 place-items-center rounded-[4px] bg-accent text-[9px] font-semibold text-white">{board?.name[0]}</span>
          <span className="truncate">{board?.name}</span>
          <span className="mx-2 -mt-0.5 text-fg-3">›</span>
          <span>Issues</span>
        </div>
        <button onClick={() => set({ overlay: "create" })} className={`${PILL} pr-2.5 pl-2 text-fg-3 hover:bg-hover hover:text-fg-2`}>
          <Icon name="plus" /> New issue
        </button>
      </div>
      <div className="flex h-[43.5px] items-center gap-1 px-2">
        {tab(false, "All issues")}
        {tab(true, "My issues", "My issues (m)")}
        {/* Linear's 28px icon circles; the filter one opens into an input on focus (/) or while filtering. */}
        <label title="Filter (/)" className={`${CIRCLE} ml-auto cursor-text overflow-hidden ${query ? "w-56" : "w-7 focus-within:w-56"}`}>
          <span className="grid size-7 shrink-0 place-items-center"><Icon name="filter" /></span>
          <input
            id="search"
            value={query}
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && (set({ query: "" }), e.currentTarget.blur())}
            placeholder="Filter…"
            className="min-w-0 flex-1 bg-transparent pr-2.5 text-[12px] font-medium text-fg-2 outline-none placeholder:text-fg-3"
          />
        </label>
        <button title={`Open issues in ${view === "side" ? "full page" : "side panel"} (v)`} onClick={() => set({ view: view === "side" ? "page" : "side" })} className={`${CIRCLE} justify-center`}>
          <Icon name={view === "side" ? "side" : "expand"} />
        </button>
      </div>
    </header>
  );
}

// --- board ---

const COL_BTN = "grid size-6 place-items-center rounded-full text-fg-3 hover:bg-hover hover:text-fg";

function ColumnView({ col, index, issues, selected }: { col: Column; index: number; issues: Issue[]; selected: string | null }) {
  const [over, setOver] = useState(false);
  return (
    <section
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={(e) => (setOver(false), actions.move(e.dataTransfer.getData("text/plain"), index))}
      // Linear: a 340px strip, solid sidebar-color/0.4 behind the header, fading to /0.1 down the column
      className={`flex w-[340px] shrink-0 flex-col rounded-t-[5px] bg-[linear-gradient(var(--col-top),var(--col-top)_46px,var(--col-bottom))] ${over ? "ring-1 ring-accent" : ""}`}
    >
      <h2 className="flex h-[46px] shrink-0 items-center gap-2 pr-2 pl-3.5 text-[13px]">
        <StatusIcon status={colLook(col)} />
        <span className="ml-0.5 truncate font-medium text-fg-2">{col.name}</span>
        <span className="font-[450] text-fg-3">{issues.length}</span>
        <button title={`Commands (⌘K) · press ${index + 1} to move the selected issue here`} onClick={() => set({ overlay: "palette" })} className={`ml-auto ${COL_BTN}`}>
          <Icon name="dots" />
        </button>
        <button title="New issue (n)" onClick={() => set({ overlay: "create" })} className={`-ml-1.5 ${COL_BTN}`}>
          <Icon name="plus" />
        </button>
      </h2>
      <div className="flex-1 overflow-y-auto px-[9px] pt-[9px]">
        {issues.map((i) => <Card key={i.key} issue={i} selected={i.key === selected} />)}
      </div>
    </section>
  );
}

const MONTH = new Intl.DateTimeFormat("en", { month: "short", year: "numeric" });
// Linear's card chip: 24px pill, 0.5px border, 12px/450 muted text after a 14px icon.
const CHIP = "flex h-6 max-w-[224px] shrink-0 items-center rounded-full border-[0.5px] border-chip-line bg-card px-2 text-[12px] font-[450] text-card-fg-3";

const Card = memo(function Card({ issue, selected }: { issue: Issue; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => void (selected && ref.current?.scrollIntoView({ block: "nearest" })), [selected]);
  const status = statusOf(issue);
  return (
    <div className="pb-2 [contain-intrinsic-size:auto_124px] [content-visibility:auto] [overflow-clip-margin:4px]">
      <div
        ref={ref}
        data-key={issue.key}
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.key)}
        onClick={() => timed(`open ${issue.key}`, () => set({ selected: issue.key, panel: true }))}
        className={`relative flex min-h-[42px] cursor-pointer flex-col rounded-lg p-2 shadow-(--card-shadow) ${selected ? "bg-card-hover" : "bg-card hover:bg-card-hover"}`}
      >
        <div className="flex flex-col gap-1.5 pr-[34px] pl-1">
          <span className="truncate text-[12px] leading-[normal] font-[450] tracking-[-0.24px] text-card-fg-3 tabular-nums">{issue.key}</span>
          <div className="flex items-start gap-1.5">
            {status && <span className="mt-px"><StatusIcon status={status} /></span>}
            <span className="line-clamp-2 text-[13px] leading-4 font-medium [overflow-wrap:anywhere] text-fg">{issue.summary}</span>
          </div>
        </div>
        <span className="absolute top-2 right-2"><Avatar user={issue.assignee} size={18} /></span>
        <div className="mt-2.5 flex flex-wrap items-center gap-1 overflow-hidden">
          <span title={issue.priority} className={`${CHIP} px-[4.5px]`}><PriorityIcon name={issue.priority} /></span>
          {issue.type && <span className={CHIP}><span className="grid size-3.5 place-items-center"><TypeDot type={issue.type} /></span><span className="mr-px ml-1.5 truncate">{issue.type}</span></span>}
          {issue.labels.slice(0, 2).map((l) => <Label key={l} name={l} />)}
          {issue.labels.length > 2 && <span className={CHIP}>+{issue.labels.length - 2}</span>}
          {issue.comments > 0 && <span className={CHIP}><Icon name="comment" /><span className="mr-px ml-1.5">{issue.comments}</span></span>}
        </div>
        <div className="mt-1.5 flex h-6 items-center pl-px text-[12px] font-[450] text-card-fg-3">Updated {MONTH.format(new Date(issue.updated))}</div>
      </div>
    </div>
  );
});

function Avatar({ user, size = 20 }: { user: User | null; size?: number }) {
  const [broken, setBroken] = useState(false); // Jira's default avatars need a Jira login, so they fail here
  const box = { width: size, height: size };
  if (!user) return <span title="Unassigned" className="inline-block shrink-0 rounded-full border border-dashed border-fg-4" style={box} />;
  if (!user.avatar || broken)
    return <span title={user.name} className="inline-grid shrink-0 place-items-center rounded-full bg-sel text-[10px] text-fg-2" style={box}>{user.name[0]}</span>;
  return <img src={user.avatar} onError={() => setBroken(true)} title={user.name} alt="" width={size} height={size} className="inline-block shrink-0 rounded-full" />;
}

const ago = (iso: string) => {
  const m = (Date.parse(iso) - Date.now()) / 60_000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (m > -60) return rtf.format(Math.round(m), "minute");
  if (m > -1440) return rtf.format(Math.round(m / 60), "hour");
  if (m > -43200) return rtf.format(Math.round(m / 1440), "day");
  return new Date(iso).toLocaleDateString();
};

const author = (a: any): User | null => a && { id: a.accountId, name: a.displayName, avatar: a.avatarUrls?.["24x24"] };

// --- issue view: side panel or full page ---

const ICON_BTN = "grid size-7 shrink-0 place-items-center rounded-md text-fg-3 hover:bg-hover hover:text-fg";

function IssueView({ issue, page }: { issue: Issue; page: boolean }) {
  const f = useStore((s) => s.full.get(issue.key))?.fields;
  const bar = (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3 text-[12px] text-fg-3">
      <TypeDot type={issue.type} />
      {page && <span className="truncate">{boardOf(issue.key)?.name} ›</span>}
      <a className="tracking-[-0.24px] text-fg-2 hover:text-fg" href={`${JIRA}/browse/${issue.key}`} target="_blank">{issue.key}</a>
      {issue.parent && <span className="truncate">· parent {issue.parent}</span>}
      <span className="flex-1" />
      {page && <Stepper issueKey={issue.key} />}
      <button title={page ? "Open in side panel (v)" : "Open as full page (v)"} onClick={() => set({ view: page ? "side" : "page" })} className={ICON_BTN}>
        <Icon name={page ? "side" : "expand"} />
      </button>
      <button title="Close (esc)" onClick={() => set({ panel: false })} className={ICON_BTN}><Icon name="close" /></button>
    </div>
  );

  if (!page)
    return (
      <aside className="flex w-[520px] shrink-0 flex-col border-l border-line">
        {bar}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Title issue={issue} className="text-[17px]" />
          <div className="mt-3 rounded-lg border border-line-2 p-1"><Properties issue={issue} f={f} /></div>
          <Description issue={issue} f={f} />
          <Activity issue={issue} f={f} />
        </div>
      </aside>
    );
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {bar}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-10 py-8">
            <Title issue={issue} className="text-[22px]" />
            <Description issue={issue} f={f} />
            <Activity issue={issue} f={f} />
          </div>
        </div>
        <div className="w-[300px] shrink-0 overflow-y-auto border-l border-line p-3"><Properties issue={issue} f={f} /></div>
      </div>
    </div>
  );
}

/** "n / total" over the board's visible issues, with ↑ ↓ (or j / k) to step without leaving the page. */
function Stepper({ issueKey }: { issueKey: string }) {
  useStore((s) => s.issues); // re-render when the list changes; nav.cols is rebuilt by the board in the same render
  useStore((s) => s.mine);
  useStore((s) => s.query);
  const flat = nav.cols.flat();
  const i = flat.findIndex((x) => x.key === issueKey);
  return (
    <div className="mr-1 flex items-center gap-0.5">
      <span className="mr-1 tabular-nums">{i < 0 ? "–" : i + 1} / {flat.length}</span>
      <button title="Previous (k)" onClick={() => press("k")} className={ICON_BTN}><Icon name="up" /></button>
      <button title="Next (j)" onClick={() => press("j")} className={ICON_BTN}><Icon name="down" /></button>
    </div>
  );
}

function Title({ issue, className }: { issue: Issue; className: string }) {
  return (
    <textarea
      id="summary"
      key={issue.summary}
      defaultValue={issue.summary}
      rows={1}
      onBlur={(e) => actions.summary(issue.key, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.preventDefault(), e.currentTarget.blur());
        if (e.key === "Escape") e.currentTarget.value = issue.summary;
      }}
      className={`w-full resize-none rounded-md bg-transparent font-semibold leading-snug text-fg outline-none [field-sizing:content] focus:bg-hover ${className}`}
    />
  );
}

function Properties({ issue, f }: { issue: Issue; f: any }) {
  const status = statusOf(issue);
  const row = (label: string, value: ReactNode) => (
    <>
      <dt className="flex h-8 items-center px-2 text-fg-3">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </>
  );
  const btn = (id: string, hint: string, overlay: "status" | "assign", body: ReactNode) => (
    <button id={id} onClick={() => set({ overlay })} className="group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-fg-2 hover:bg-hover hover:text-fg">
      {body}
      <kbd className="ml-auto opacity-0 group-hover:opacity-100">{hint}</kbd>
    </button>
  );
  const plain = (body: ReactNode) => <div className="flex h-8 items-center gap-2 px-2 text-fg-2">{body}</div>;
  return (
    <dl className="grid grid-cols-[84px_1fr] text-[12px] font-[450]">
      {row("Status", btn("prop-status", "S", "status", <>{status && <StatusIcon status={status} />}<span className="truncate">{status?.name}</span></>))}
      {row("Assignee", btn("prop-assignee", "A", "assign", <><Avatar user={issue.assignee} size={18} /><span className="truncate">{issue.assignee?.name ?? "Unassigned"}</span></>))}
      {row("Priority", plain(<><PriorityIcon name={issue.priority} />{issue.priority ?? "None"}</>))}
      {issue.labels.length > 0 && row("Labels", <div className="flex flex-wrap gap-1 px-2 py-1.5">{issue.labels.map((l) => <Label key={l} name={l} />)}</div>)}
      {row("Reporter", plain(f && <><Avatar user={author(f.reporter)} size={18} /><span className="truncate">{f.reporter?.displayName}</span></>))}
      {row("Created", plain(f && ago(f.created)))}
      {row("Updated", plain(ago(issue.updated)))}
    </dl>
  );
}

function Description({ issue, f }: { issue: Issue; f: any }) {
  const editDesc = useStore((s) => s.editDesc);
  return (
    <section className="mt-5">
      {!f ? (
        <p className="text-fg-4">Loading…</p>
      ) : editDesc ? (
        <TextBox
          id="description"
          initial={adfToText(f.description)}
          rows={12}
          autoFocus
          onSubmit={(t) => actions.description(issue.key, t)}
          onCancel={() => set({ editDesc: false })}
          hint="⌘↵ save · esc cancel"
        />
      ) : (
        <div className="group relative leading-[1.6] text-fg-2">
          {f.description ? <Adf node={f.description} /> : <p className="text-fg-4">No description</p>}
          <button title="Edit description (d)" onClick={() => set({ editDesc: true })} className={`absolute -top-1 right-0 opacity-0 group-hover:opacity-100 ${ICON_BTN}`}>
            <Icon name="pencil" />
          </button>
        </div>
      )}
    </section>
  );
}

function Activity({ issue, f }: { issue: Issue; f: any }) {
  if (!f) return null;
  return (
    <section className="mt-8 border-t border-line pt-5">
      <h3 className="mb-3 font-medium text-fg">Activity</h3>
      <ol className="space-y-3">
        <li className="flex items-center gap-2 px-1 text-[12px] text-fg-3">
          <Avatar user={author(f.reporter)} size={16} />
          <span className="text-fg-2">{f.reporter?.displayName}</span> created the issue · {ago(f.created)}
        </li>
        {f.comment.comments.map((c: any) => (
          <li key={c.id} className="rounded-lg border border-line-2 bg-card px-3 py-2.5">
            <div className="flex items-center gap-2 text-[12px]">
              <Avatar user={author(c.author)} size={18} />
              <span className="font-medium text-fg">{c.author?.displayName}</span>
              <span className="text-fg-3">{ago(c.created)}</span>
            </div>
            <div className="mt-1.5 leading-[1.6] text-fg-2"><Adf node={c.body} /></div>
          </li>
        ))}
      </ol>
      <div className="mt-3">
        <TextBox key={f.comment.total} id="comment" rows={3} placeholder="Leave a comment…" onSubmit={(t) => actions.comment(issue.key, t)} hint="⌘↵ send · C to focus" />
      </div>
    </section>
  );
}

function TextBox(props: {
  id: string; initial?: string; rows: number; placeholder?: string; autoFocus?: boolean; hint: string;
  onSubmit: (text: string) => void; onCancel?: () => void;
}) {
  return (
    <div>
      <textarea
        id={props.id}
        defaultValue={props.initial}
        rows={props.rows}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) props.onSubmit(e.currentTarget.value);
          if (e.key === "Escape") props.onCancel?.();
        }}
        className="w-full resize-y rounded-lg border border-line-2 bg-card px-3 py-2.5 leading-[1.6] outline-none placeholder:text-fg-4 focus:border-line-3"
      />
      <div className="mt-0.5 text-right text-[11px] text-fg-4">{props.hint}</div>
    </div>
  );
}

// --- overlays: palette, pickers next to their property, create ---

const MENU =
  "overflow-hidden rounded-xl border border-line-2 bg-card text-fg-2 shadow-[0_12px_40px_rgb(0_0_0/0.35)] " +
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-fg-3 " +
  "[&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-pointer [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-md [&_[cmdk-item]]:px-2 " +
  "[&_[cmdk-item][data-selected=true]]:bg-sel [&_[cmdk-item][data-selected=true]]:text-fg";
const MENU_INPUT = "h-11 w-full border-b border-line bg-transparent px-3.5 text-fg outline-none placeholder:text-fg-4";
const close = (e: React.MouseEvent) => e.target === e.currentTarget && set({ overlay: null });

function Overlay({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[14vh]" onMouseDown={close}>
      {children}
    </div>
  );
}

/** Opens under the property in the issue view, else under the selected card, else centered. */
function Popover({ issueKey, prop, children }: { issueKey: string; prop: string; children: ReactNode }) {
  const el = document.getElementById(`prop-${prop}`) ?? document.querySelector(`[data-key="${issueKey}"]`);
  const r = el?.getBoundingClientRect();
  const style = r?.width
    ? { left: Math.max(8, Math.min(r.left, innerWidth - 328)), top: Math.max(8, Math.min(r.bottom + 4, innerHeight - 400)) }
    : { left: "50%", top: "14vh", translate: "-50% 0" };
  return (
    <div className="fixed inset-0 z-50" onMouseDown={close}>
      <div className="absolute w-[320px]" style={style}>{children}</div>
    </div>
  );
}

function StatusPicker({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(issueKey));
  const board = boardOf(issueKey);
  if (!issue || !board) return null;
  return (
    <Popover issueKey={issueKey} prop="status">
      <Command
        loop
        defaultValue={statusOf(issue)?.name}
        className={MENU}
        onKeyDown={(e) => {
          if (!/^[1-9]$/.test(e.key)) return;
          e.preventDefault();
          actions.move(issueKey, Number(e.key) - 1);
          set({ overlay: null });
        }}
      >
        <Command.Input autoFocus placeholder="Change status…" className={MENU_INPUT} />
        <Command.List className="max-h-[340px] overflow-y-auto p-1">
          <Command.Empty className="p-3 text-fg-3">No status</Command.Empty>
          {board.columns.map((c, ci) =>
            c.statuses.map((s, si) => (
              <Command.Item key={s.id} value={s.name} keywords={[c.name]} onSelect={() => actions.status(issueKey, s.id)}>
                <StatusIcon status={s} />
                <span className="flex-1 truncate">{s.name}</span>
                {s.id === issue.status && <Icon name="check" />}
                <kbd className={si ? "invisible" : ""}>{ci + 1}</kbd>
              </Command.Item>
            )),
          )}
        </Command.List>
      </Command>
    </Popover>
  );
}

function AssignPicker({ issueKey }: { issueKey: string }) {
  const issues = useStore((s) => s.issues);
  const current = issues.get(issueKey)?.assignee;
  const users = useMemo(() => {
    const m = new Map<string, User>([[ME.id, ME]]);
    for (const i of issues.values()) if (i.assignee && !m.has(i.assignee.id)) m.set(i.assignee.id, i.assignee);
    return [...m.values()].sort((a, b) => (a.id === ME.id ? -1 : b.id === ME.id ? 1 : a.name.localeCompare(b.name)));
  }, [issues]);
  const value = (u: User) => `${u.name} ${u.id}`;
  return (
    <Popover issueKey={issueKey} prop="assignee">
      <Command loop defaultValue={current ? value(current) : "Unassigned"} className={MENU}>
        <Command.Input autoFocus placeholder="Assign to…" className={MENU_INPUT} />
        <Command.List className="max-h-[340px] overflow-y-auto p-1">
          <Command.Empty className="p-3 text-fg-3">No one found</Command.Empty>
          <Command.Item value="Unassigned" onSelect={() => actions.assign(issueKey, null)}>
            <Avatar user={null} size={18} /><span className="flex-1">Unassigned</span>{!current && <Icon name="check" />}
          </Command.Item>
          {users.map((u) => (
            <Command.Item key={u.id} value={value(u)} onSelect={() => actions.assign(issueKey, u)}>
              <Avatar user={u} size={18} />
              <span className="flex-1 truncate">{u.name}{u.id === ME.id && <span className="text-fg-3"> (me)</span>}</span>
              {current?.id === u.id && <Icon name="check" />}
              {u.id === ME.id && <kbd>I</kbd>}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Popover>
  );
}

type Cmd = { name: string; hint?: string; icon?: ReactNode; run: () => void };
/** A palette command that runs a shortcut, so the hint shown is the key that does the same thing. */
const viaKey = (name: string, key: string, icon?: ReactNode): Cmd => ({
  name, hint: key.toUpperCase(), icon, run: () => (set({ overlay: null }), press(key)),
});

function Palette() {
  const issues = useStore((s) => s.issues);
  const boards = useStore((s) => s.boards);
  const boardId = useStore((s) => s.board);
  const mine = useStore((s) => s.mine);
  const view = useStore((s) => s.view);
  const [scope, setScope] = useState(get().selected); // ⌘K acts on the selected issue; Backspace drops it
  const [q, setQ] = useState("");
  const scoped = scope ? issues.get(scope) : undefined;

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const exact = q.trim().toUpperCase();
    const hits = [...issues.values()].filter((i) => words.every((w) => `${i.key} ${i.summary}`.toLowerCase().includes(w)));
    hits.sort((a, b) => Number(b.key === exact) - Number(a.key === exact) || (a.updated < b.updated ? 1 : -1));
    return hits.slice(0, 50);
  }, [q, issues]);

  const issueCmds: Cmd[] = scoped
    ? [
        viaKey("Change status…", "s", <StatusIcon status={statusOf(scoped) ?? { name: "", category: "new" }} />),
        viaKey("Assign to…", "a", <Avatar user={scoped.assignee} size={14} />),
        viaKey(scoped.assignee?.id === ME.id ? "Unassign me" : "Assign to me", "i"),
        viaKey("Edit title", "e", <Icon name="pencil" />),
        viaKey("Edit description", "d", <Icon name="pencil" />),
        viaKey("Add comment", "c", <Icon name="comment" />),
        { name: "Open issue", hint: "↵", icon: <Icon name="expand" />, run: () => set({ panel: true, overlay: null }) },
        { name: "Open in Jira", icon: <Icon name="external" />, run: () => (window.open(`${JIRA}/browse/${scoped.key}`), set({ overlay: null })) },
        ...(boardOf(scoped.key)?.columns ?? []).map((c, i): Cmd => ({
          name: `Move to ${c.name}`, hint: String(i + 1), icon: <StatusIcon status={colLook(c)} />,
          run: () => (set({ overlay: null }), actions.move(scoped.key, i)),
        })),
      ]
    : [];
  const general: Cmd[] = [
    viaKey("New issue", "n", <Icon name="plus" />),
    viaKey(mine ? "Show all issues" : "Show only my issues", "m"),
    viaKey(view === "page" ? "Open issues in a side panel" : "Open issues as a full page", "v", <Icon name={view === "page" ? "side" : "expand"} />),
    ...boards.filter((b) => b.id !== boardId).map((b) => viaKey(`Switch to ${b.name}`, "b")),
  ];
  const match = (c: Cmd) => c.name.toLowerCase().includes(q.trim().toLowerCase());
  const item = (c: Cmd) => (
    <Command.Item key={c.name} value={`cmd:${c.name}`} onSelect={c.run}>
      <span className="grid w-4 shrink-0 place-items-center text-fg-3">{c.icon}</span>
      <span className="flex-1 truncate">{c.name}</span>
      {c.hint && <kbd>{c.hint}</kbd>}
    </Command.Item>
  );

  return (
    <Overlay>
      <Command shouldFilter={false} loop className={`w-[640px] ${MENU}`}>
        <div className="flex items-center gap-2 border-b border-line px-3.5">
          {scoped && (
            <span className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-sel px-2 text-[12px] text-fg-2">
              <TypeDot type={scoped.type} />{scoped.key}
            </span>
          )}
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            onKeyDown={(e) => e.key === "Backspace" && !q && setScope(null)}
            placeholder={scoped ? "Type a command, or ⌫ to search everything…" : "Search issues or type a command…"}
            className="h-12 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-4"
          />
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
          <Command.Empty className="p-3 text-fg-3">No results</Command.Empty>
          {issueCmds.some(match) && <Command.Group heading={scoped!.key}>{issueCmds.filter(match).map(item)}</Command.Group>}
          {general.some(match) && <Command.Group heading="General">{general.filter(match).map(item)}</Command.Group>}
          {results.length > 0 && (
            <Command.Group heading={`Issues (${results.length === 50 ? "top 50" : results.length})`}>
              {results.map((i) => (
                <Command.Item
                  key={i.key}
                  value={i.key}
                  onSelect={() => timed(`open ${i.key}`, () => set({ board: i.board, selected: i.key, panel: true, overlay: null, query: "" }))}
                >
                  {(() => { const s = statusOf(i); return s ? <StatusIcon status={s} /> : <TypeDot type={i.type} />; })()}
                  <span className="w-[88px] shrink-0 text-[12px] tracking-[-0.24px] text-fg-3">{i.key}</span>
                  <span className="flex-1 truncate">{i.summary}</span>
                  <Avatar user={i.assignee} size={18} />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}

function CreateDialog() {
  const board = useStore((s) => s.boards.find((b) => b.id === s.board));
  return (
    <Overlay>
      <form
        className={`w-[640px] ${MENU}`}
        onSubmit={(e) => {
          e.preventDefault();
          actions.create(new FormData(e.currentTarget).get("summary") as string);
        }}
      >
        <div className="px-3.5 pt-3 text-[12px] text-fg-3">New issue in {board?.name}</div>
        <input name="summary" autoFocus placeholder="Issue title, then ↵" className="h-12 w-full bg-transparent px-3.5 text-[15px] text-fg outline-none placeholder:text-fg-4" />
      </form>
    </Overlay>
  );
}

export default App;
