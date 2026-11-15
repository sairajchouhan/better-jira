import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Board, Issue } from "@/shared/issue-model";
import { commit, get } from "@/client/state/store";
import { RouterContextProvider } from "@tanstack/react-router";
import { BoardBreadcrumbs, CRUMB_BAR, DocumentBreadcrumbs, IssueBreadcrumbs, PAGE_HEADER } from "./breadcrumbs";
import { defaultPreferences } from "@/shared/view-model";
import type { SavedView } from "@/shared/saved-view-model";
import { router } from "./app-navigation";

const before = get();
afterEach(() => commit({ issues: before.issues, boards: before.boards, board: before.board, selected: before.selected, panel: before.panel, view: before.view, trail: before.trail, mine: before.mine, activeViewId: before.activeViewId, editorDraft: before.editorDraft, savedViews: before.savedViews, person: before.person, document: before.document }));

const board: Board = { id: 7, name: "Space", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key, boards: [7], summary: `${key} title`, status: "todo", type: "Task", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T10:00:00Z", resolved: null, ...patch,
});
const all = [
  issue("Z-1", { type: "Epic", summary: "Sync engine" }),
  issue("Z-2", { parent: "Z-1", rank: "a" }),
  issue("Z-3", { type: "Sub-task", parent: "Z-2", rank: "a" }),
  issue("Z-4", { type: "Sub-task", parent: "Z-2", rank: "b" }),
  issue("Z-5", { parent: "Z-3", rank: "a" }),
];
const other: Board = { ...board, id: 8, name: "Other" };
const open = (key: string, trail: ReturnType<typeof get>["trail"], patch: Parameters<typeof commit>[0] = {}) => {
  commit({ issues: new Map(all.map((i) => [i.key, i])), boards: [board, other], board: 7, selected: key, panel: true, view: "page", trail, mine: false, activeViewId: null, editorDraft: null, ...patch });
  return renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <IssueBreadcrumbs issue={get().issues.get(key)!} />
    </RouterContextProvider>,
  );
};
/** The crumbs' text, in order, as a reader hears them. */
const crumbs = (html: string) =>
  [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(([, li]) => li!.replace(/<span aria-hidden="true"[^>]*>›<\/span>/g, "").replace(/<[^>]+>/g, "").trim());

/** The `<a>` tag that links to `key`'s page. */
const linkTo = (html: string, key: string) => html.match(new RegExp(`<a[^>]*href="/issue/${key}"[^>]*>`))?.[0] ?? "";
/** What the link to `key`'s page draws, up to its closing tag. */
const linkBody = (html: string, key: string) => html.match(new RegExp(`<a[^>]*href="/issue/${key}"[^>]*>([\\s\\S]*?)</a>`))?.[1] ?? "";
/** The issue type a crumb's icon shows: the TypeDot (titled with its type) in the crumb's hidden icon slot. */
const crumbType = (body: string) => body.match(/^<span aria-hidden="true"[^>]*><span title="([^"]+)"[^>]*style="background:[^"]+"/)?.[1];

const render = (node: React.ReactNode) => renderToStaticMarkup(<RouterContextProvider router={router}>{node}</RouterContextProvider>);
const showBoard = (patch: Parameters<typeof commit>[0] = {}) => {
  commit({ boards: [board], board: 7, selected: null, panel: false, mine: false, person: null, trail: null, activeViewId: null, editorDraft: null, ...patch });
  return render(<BoardBreadcrumbs board={board} />);
};
const triage = (): SavedView => {
  const p = defaultPreferences();
  return { id: "v1", board: 7, kind: "custom", name: "Triage", description: "", icon: "filter", color: "gray", filters: p.filters, display: p.display, scope: p.scope, hidden: {}, collapsed: {}, order: {}, mine: false, createdAt: "", updatedAt: "" };
};

test("an issue page's breadcrumb is React Aria's list: the space, the epic in Linear's project slot, the parent, the issue current, each with its type icon", () => {
  const html = open("Z-3", { path: ["Z-1", "Z-2"] });
  expect(html).toContain('<nav aria-label="Breadcrumb"');
  expect(html).toMatch(/<ol[^>]*>/);
  expect(crumbs(html)).toEqual(["SSpace", "Z-1", "Z-2", "Z-3Z-3 title"]);
  // The space links to its board's issues; ancestors are links into the app, by key with their titles as tooltips; only the issue
  // is the current page, and it opens in Jira.
  expect(html).toMatch(/<a(?=[^>]*title="Space")(?=[^>]*href="\/board\/7\/all")[^>]*>/);
  expect(linkTo(html, "Z-1")).toContain('title="Sync engine"');
  expect(linkTo(html, "Z-2")).toContain('title="Z-2 title"');
  // Every issue crumb is its type icon, then its key: the epic the Epic icon, the parent the Task icon; no layers icon (no svg).
  expect(crumbType(linkBody(html, "Z-1"))).toBe("Epic");
  expect(linkBody(html, "Z-1")).toMatch(/<\/span><span class="ui-entity-id ">Z-1<\/span>$/);
  expect(crumbType(linkBody(html, "Z-2"))).toBe("Task");
  expect(linkBody(html, "Z-2")).toMatch(/<\/span><span class="ui-entity-id ">Z-2<\/span>$/);
  expect(crumbType(html.match(/<a[^>]*target="_blank"[^>]*>([\s\S]*?)<\/a>/)![1]!)).toBe("Sub-task");
  expect(html.match(/<ol[\s\S]*<\/ol>/)![0]).not.toContain("<svg");
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*target="_blank"|<a[^>]*target="_blank"[^>]*aria-current="page"/);
  expect(html).toContain("data-crumb-issue");
  // One separator between each pair of crumbs.
  expect(html.match(/>›</g)).toHaveLength(3);
});

test("every issue form leads with the space and never shows an Issues crumb", () => {
  // A direct link or reload: the space, the epic, the issue; with no epic, the space then the issue.
  expect(crumbs(open("Z-3", null))).toEqual(["SSpace", "Z-1", "Z-3Z-3 title"]);
  expect(crumbs(open("Z-1", null))).toEqual(["SSpace", "Z-1Sync engine"]);
  // From the epic's Sub-issues: the same.
  expect(crumbs(open("Z-2", { path: ["Z-1"] }))).toEqual(["SSpace", "Z-1", "Z-2Z-2 title"]);
  // Over the board, the inbox or a view: the space, then the issue (a view's name shows only on the view itself).
  expect(crumbs(open("Z-2", "list"))).toEqual(["SSpace", "Z-2Z-2 title"]);
  expect(crumbs(open("Z-2", "list", { savedViews: [triage()], activeViewId: "v1" }))).toEqual(["SSpace", "Z-2Z-2 title"]);
  // Over My issues: that list's crumb, as before.
  expect(crumbs(open("Z-2", "list", { mine: true }))).toEqual(["My issues", "Z-2Z-2 title"]);
  for (const html of [open("Z-3", null), open("Z-2", "list"), open("Z-5", { path: ["Z-2", "Z-3"] })]) expect(html).not.toContain(">Issues<");
});

test("the space is the issue's own board, whichever board was current", () => {
  const moved = all.map((i) => (i.key === "Z-2" ? { ...i, boards: [8] } : i));
  commit({ issues: new Map(moved.map((i) => [i.key, i])) });
  const html = (trail: ReturnType<typeof get>["trail"]) => {
    commit({ boards: [board, other], board: 7, selected: "Z-2", panel: true, view: "page", trail, mine: false, activeViewId: null, editorDraft: null, issues: new Map(moved.map((i) => [i.key, i])) });
    return render(<IssueBreadcrumbs issue={get().issues.get("Z-2")!} />);
  };
  expect(crumbs(html("list"))).toEqual(["OOther", "Z-2Z-2 title"]);
  expect(crumbs(html(null))).toEqual(["OOther", "Z-1", "Z-2Z-2 title"]);
  expect(html(null)).toMatch(/<a(?=[^>]*title="Other")(?=[^>]*href="\/board\/8\/all")[^>]*>/);
});

test("on a long trail the epic is its icon alone, named and titled as before", () => {
  const html = open("Z-5", { path: ["Z-2", "Z-3"] });
  expect(crumbs(html)).toEqual(["SSpace", "", "Z-2", "Z-3", "Z-5Z-5 title"]);
  expect(linkTo(html, "Z-1")).toContain('aria-label="Z-1"');
  expect(linkTo(html, "Z-1")).toContain('title="Sync engine"');
  // Its icon is the Epic type icon alone, and the parents keep theirs.
  expect(crumbType(linkBody(html, "Z-1"))).toBe("Epic");
  expect(linkBody(html, "Z-1")).not.toContain("ui-entity-id");
  expect(linkBody(html, "Z-1")).not.toContain("<svg");
  expect(crumbType(linkBody(html, "Z-2"))).toBe("Task");
  expect(crumbType(linkBody(html, "Z-3"))).toBe("Sub-task");
});

test("an epic the mirror doesn't hold is plain text, its key with no icon, on a short trail and a long one", () => {
  const orphan = (patch: Partial<Issue>) => issue("Z-8", { parent: "Z-9", parentLevel: 1, ...patch });
  const span = (html: string) => html.match(/<span aria-label="Z-9"[^>]*>[\s\S]*?<\/span><\/span>|<span title="Z-9"[^>]*>([\s\S]*?)<\/span><\/li>/)?.[0] ?? "";
  commit({ issues: new Map([...all, orphan({})].map((i) => [i.key, i])) });
  const short = open("Z-8", null, { issues: new Map([...all, orphan({})].map((i) => [i.key, i])) });
  expect(crumbs(short)).toEqual(["SSpace", "Z-9", "Z-8Z-8 title"]);
  expect(short).not.toContain('href="/issue/Z-9"');
  expect(span(short)).toContain(">Z-9<");
  expect(span(short)).not.toMatch(/title="Epic"|<svg/);
  // A long trail through it: the epic stays its key, since there is no type to show.
  const chain = [orphan({}), issue("Z-10", { parent: "Z-8" }), issue("Z-11", { type: "Sub-task", parent: "Z-10" })];
  const long = open("Z-11", { path: ["Z-8", "Z-10"] }, { issues: new Map([...all, ...chain].map((i) => [i.key, i])) });
  expect(crumbs(long)).toEqual(["SSpace", "Z-9", "Z-8", "Z-10", "Z-11Z-11 title"]);
  expect(span(long)).toContain(">Z-9<");
  expect(span(long)).not.toMatch(/title="Epic"|<svg/);
});

test("a board's breadcrumb is the space alone, the current page that still links (it clears the board's search)", () => {
  const html = showBoard();
  expect(crumbs(html)).toEqual(["SSpace"]);
  expect(html).toMatch(/<a(?=[^>]*aria-label="Space")(?=[^>]*aria-current="page")(?=[^>]*href="\/board\/7\/all")[^>]*>/);
  expect(html).not.toContain('aria-disabled');
  expect(html).not.toContain(">Issues<");
});

test("a view's breadcrumb is the space then the view; My issues is its own crumb", () => {
  expect(crumbs(showBoard({ savedViews: [triage()], activeViewId: "v1" }))).toEqual(["SSpace", "Triage"]);
  expect(crumbs(showBoard({ mine: true }))).toEqual(["My issues"]);
});

test("a document's breadcrumb: the space, the issue's key back to it, then the document", () => {
  commit({ issues: new Map(all.map((i) => [i.key, i])), boards: [board], board: 7 });
  const html = render(<DocumentBreadcrumbs issue={get().issues.get("Z-2")!} title="Spec" />);
  expect(crumbs(html)).toEqual(["SSpace", "Z-2", "Spec"]);
  expect(html).toMatch(/<a(?=[^>]*aria-label="Back to issue")(?=[^>]*title="Z-2 title")[^>]*>/);
});

test("the board, view, issue and document breadcrumbs are the one bar, at the one inset, in the one header row", () => {
  const navClass = (html: string) => html.match(/<nav aria-label="Breadcrumb" class="([^"]*)"/)?.[1];
  const bars = [
    showBoard(),
    showBoard({ savedViews: [triage()], activeViewId: "v1" }),
    open("Z-2", "list"),
    open("Z-3", null),
    render(<DocumentBreadcrumbs issue={get().issues.get("Z-2")!} title="Spec" />),
  ].map(navClass);
  expect(new Set(bars)).toEqual(new Set([CRUMB_BAR]));
  // The inset is the row's 8px plus the bar's 10px, Linear's board header; nothing else pads the crumbs.
  expect(PAGE_HEADER).toContain("px-2");
  expect(CRUMB_BAR).toContain("pl-2.5");
});

test("the board, issue page and document headers are the shared row, with nothing that moves the breadcrumb", async () => {
  // The user's report: the issue page's breadcrumb sat 6px left of the board's (its own px-3 row). Each page must use PageHeader
  // and pass no padding, height or border of its own.
  const src = async (path: string) => Bun.file(new URL(path, import.meta.url)).text();
  for (const [file, owner] of [
    ["./app-chrome.tsx", "export function BoardHeader"],
    ["../../routes/issue-view.tsx", "function IssueHeader"],
    ["../../routes/issue-document.tsx", "function DocumentHeader"],
  ] as const) {
    const code = await src(file);
    const body = code.slice(code.indexOf(owner));
    expect(body.indexOf(owner)).toBe(0);
    const row = body.match(/<PageHeader\b[^>]*className="([^"]*)"/);
    expect(row, file).not.toBeNull();
    expect(row![1]).not.toMatch(/(^|\s)(p[xl]?-|h-|border)/);
  }
});
