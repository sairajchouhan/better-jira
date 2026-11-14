import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Board, Issue } from "@/shared/issue-model";
import { commit, get } from "@/client/state/store";
import { RouterContextProvider } from "@tanstack/react-router";
import { BoardBreadcrumbs, IssueBreadcrumbs } from "./breadcrumbs";
import { router } from "./app-navigation";

const before = get();
afterEach(() => commit({ issues: before.issues, boards: before.boards, board: before.board, selected: before.selected, panel: before.panel, view: before.view, trail: before.trail, mine: before.mine, activeViewId: before.activeViewId, editorDraft: before.editorDraft }));

const board: Board = { id: 7, name: "Space", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] };
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key, board: 7, summary: `${key} title`, status: "todo", type: "Task", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T10:00:00Z", resolved: null, ...patch,
});
const all = [
  issue("Z-1", { type: "Epic", summary: "Sync engine" }),
  issue("Z-2", { parent: "Z-1", rank: "a" }),
  issue("Z-3", { type: "Sub-task", parent: "Z-2", rank: "a" }),
  issue("Z-4", { type: "Sub-task", parent: "Z-2", rank: "b" }),
  issue("Z-5", { parent: "Z-3", rank: "a" }),
];
const open = (key: string, trail: ReturnType<typeof get>["trail"]) => {
  commit({ issues: new Map(all.map((i) => [i.key, i])), boards: [board], board: 7, selected: key, panel: true, view: "page", trail });
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

test("an issue page's breadcrumb is React Aria's list, the epic in Linear's project slot, the parent by key, the issue current", () => {
  const html = open("Z-3", { path: ["Z-1", "Z-2"] });
  expect(html).toContain('<nav aria-label="Breadcrumb"');
  expect(html).toMatch(/<ol[^>]*>/);
  expect(crumbs(html)).toEqual(["Z-1", "Z-2", "Z-3Z-3 title"]);
  // Ancestors are links into the app, by key with their titles as tooltips; only the issue is the current page, and it opens in Jira.
  expect(linkTo(html, "Z-1")).toContain('title="Sync engine"');
  expect(linkTo(html, "Z-2")).toContain('title="Z-2 title"');
  // The epic is a parent's crumb with the epic's icon before the key; the parent has no icon.
  expect(html).toMatch(/href="\/issue\/Z-1"[^>]*>(?:(?!<\/a>)[\s\S])*<svg(?:(?!<\/a>)[\s\S])*<span class="ui-entity-id ">Z-1<\/span><\/a>/);
  expect(html).toMatch(/href="\/issue\/Z-2"[^>]*><span class="ui-entity-id ">Z-2<\/span><\/a>/);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*target="_blank"|<a[^>]*target="_blank"[^>]*aria-current="page"/);
  expect(html).toContain("data-crumb-issue");
  // One separator between each pair of crumbs.
  expect(html.match(/>›</g)).toHaveLength(2);
});

test("reached directly, the page shows the epic then the issue; over a list, the list's crumbs", () => {
  expect(crumbs(open("Z-3", null))).toEqual(["Z-1", "Z-3Z-3 title"]);
  // The space crumb reads its initial (its icon), then its name.
  expect(crumbs(open("Z-2", "list"))).toEqual(["SSpace", "Issues", "Z-2Z-2 title"]);
});

test("on a long trail the epic is its icon alone, named and titled as before", () => {
  const html = open("Z-5", { path: ["Z-2", "Z-3"] });
  expect(crumbs(html)).toEqual(["", "Z-2", "Z-3", "Z-5Z-5 title"]);
  expect(linkTo(html, "Z-1")).toContain('aria-label="Z-1"');
  expect(linkTo(html, "Z-1")).toContain('title="Sync engine"');
});

test("a board's breadcrumb: the space, then Issues as the current page that still links (it clears the board's search)", () => {
  commit({ boards: [board], board: 7, selected: null, panel: false, mine: false, trail: null, activeViewId: null, editorDraft: null });
  const html = renderToStaticMarkup(
    <RouterContextProvider router={router}>
      <BoardBreadcrumbs board={board} />
    </RouterContextProvider>,
  );
  expect(crumbs(html)).toEqual(["SSpace", "Issues"]);
  expect(html).toMatch(/<a[^>]*title="Space"/);
  expect(html).toMatch(/<a(?=[^>]*aria-label="Issues")(?=[^>]*aria-current="page")(?=[^>]*href="\/board\/7\/all")[^>]*>/);
  expect(html).not.toContain('aria-disabled');
});
