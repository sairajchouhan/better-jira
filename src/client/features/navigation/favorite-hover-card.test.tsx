import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { RouterContextProvider } from "@tanstack/react-router";
import type { Board, Issue } from "@/shared/issue-model";
import type { SavedView } from "@/shared/saved-view-model";
import { defaultPreferences, type FilterGroup } from "@/shared/view-model";
import { commit, get } from "@/client/state/store";
import { TOOLTIP_TIMING } from "@/client/components/tooltip-rules";
import { router } from "./app-navigation";
import { epicProgress, FavoriteCard, favoriteCardKind, FavoriteHoverCard } from "./favorite-hover-card";

const before = get();
afterEach(() => commit({ issues: before.issues, boards: before.boards, board: before.board }));

const board: Board = {
  id: 7,
  name: "Space",
  columns: [
    { name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] },
    { name: "Done", statuses: [{ id: "done", name: "Done", category: "done" }] },
  ],
};
const issue = (key: string, patch: Partial<Issue> = {}): Issue => ({
  key, boards: [7], summary: `${key} title`, status: "todo", type: "Task", assignee: null, labels: [], comments: 0,
  updated: "2026-11-01T10:00:00Z", resolved: null, ...patch,
});
const epic = issue("Z-1", { type: "Epic", summary: "Sync engine", priority: "High", due: "2020-01-01" });
const all = [
  epic,
  issue("Z-2", { parent: "Z-1", status: "done", resolved: "2026-11-01T10:00:00Z" }),
  issue("Z-3", { parent: "Z-1", status: "done", resolved: "2026-11-01T10:00:00Z" }),
  issue("Z-4", { parent: "Z-1", status: "done", resolved: "2026-11-01T10:00:00Z" }),
  issue("Z-5", { parent: "Z-1" }),
  issue("Z-9", { type: "Epic", summary: "Shipped", status: "done", resolved: "2026-11-01T10:00:00Z" }),
];
const view = (filters: FilterGroup): SavedView => {
  const p = defaultPreferences();
  return { id: "v1", board: 7, kind: "custom", name: "Triage", description: "Fresh bugs to sort", icon: "filter", color: "gray", filters, display: p.display, scope: p.scope, hidden: {}, collapsed: {}, order: {}, mine: false, createdAt: "", updatedAt: "" };
};
const rules: FilterGroup = {
  id: "root",
  join: "and",
  children: [
    { id: "r1", field: "status", op: "is", values: ["todo"] },
    { id: "r2", field: "priority", op: "is", values: ["High"] },
  ],
};
const render = (node: ReactNode) => {
  commit({ issues: new Map(all.map((i) => [i.key, i])), boards: [board], board: 7 });
  return renderToStaticMarkup(<RouterContextProvider router={router}>{node}</RouterContextProvider>);
};

test("each favorite opens its kind's card: an issue the issue card, an epic the project card, a view the view card, a space the team card", () => {
  expect(favoriteCardKind({ issue: issue("Z-2") })).toBe("issue");
  expect(favoriteCardKind({ issue: epic })).toBe("project");
  expect(favoriteCardKind({ view: view(rules) })).toBe("view");
  expect(favoriteCardKind({ board })).toBe("team");
  // Linear's document card (`cpt`) isn't built: a document favorite is its row alone.
  expect(favoriteCardKind({ document: {} })).toBeNull();
  expect(renderToStaticMarkup(<FavoriteHoverCard thing={{ document: {} }} label="Doc"><a href="/d">Doc</a></FavoriteHoverCard>)).toBe('<a href="/d">Doc</a>');
});

test("a favorite's card opens after Linear's interactive card delay (550ms, `Rwe`), to the right of the row (`h$` → `wZ` position right)", async () => {
  expect(TOOLTIP_TIMING.card.delay).toBe(550);
  const source = await Bun.file(new URL("./favorite-hover-card.tsx", import.meta.url)).text();
  expect(source).toMatch(/<HoverCard placement="right" display="block"/);
  // No delay of its own: every favorite kind takes the card default.
  expect(source).not.toMatch(/<HoverCard[^>]*\bdelay=/);
  // The trigger is the full-width row (`_$.tooltipBlock`), so the row keeps its whole width.
  const html = renderToStaticMarkup(<FavoriteHoverCard thing={{ board }} label="Space"><a href="/b">Space</a></FavoriteHoverCard>);
  expect(html).toMatch(/^<span class="flex w-full min-w-0" data-hover-card-trigger="">/);
});

test("the issue favorite's card: key with the assignee across, the title, then status, epic and priority under Linear's property line", () => {
  const html = render(<FavoriteCard kind="issue" thing={{ issue: { ...all[4]!, assignee: { id: "u1", name: "Ada Lane" }, priority: "Low" } }} />);
  expect(html).toContain('data-issue-hover="Z-5"');
  expect(html).toContain("Ada Lane");
  expect(html).toContain("border-(--card-divider)");
  expect(html).toContain('title="Status"');
  expect(html).toMatch(/title="Epic"[^]*Sync engine/);
  expect(html).toContain('title="Priority"');
});

test("an epic's progress is its done share in whole percent out of every issue under it (Linear's `progressText` 'N% of T')", () => {
  expect(epicProgress({ done: 3, total: 4 })).toEqual({ value: 0.75, percent: "75%", total: 4 });
  expect(epicProgress({ done: 1, total: 3 }).percent).toBe("33%");
  expect(epicProgress(undefined)).toEqual({ value: 0, percent: "0%", total: 0 });
  const html = render(<FavoriteCard kind="project" thing={{ issue: epic }} />);
  expect(html).toContain('data-epic-progress="75%"');
  expect(html).toMatch(/75%<\/span><span[^>]*>of<\/span><span[^>]*>4</);
  // Linear's kA order: status, team, lead, priority, target date, then progress.
  const order = ['title="Status"', 'title="Space"', 'title="Priority"', 'title="Target date"', "data-epic-progress"].map((s) => html.indexOf(s));
  expect(order.every((at) => at > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("the view favorite's card shows the view's own filters as read-only chips: no button, no remove, tooltip appearance", () => {
  const html = render(<FavoriteCard kind="view" thing={{ view: view(rules) }} />);
  expect(html).toContain('data-view-hover="v1"');
  expect(html).toContain("Triage");
  expect(html).toContain("Fresh bugs to sort");
  expect(html).toContain('data-appearance="tooltip"');
  expect(html).toContain("data-read-only");
  expect(html).not.toContain("<button");
  expect(html).not.toMatch(/aria-label="Remove/);
  // A view filtering nothing shows no chip row (`Y8n` returns null).
  expect(render(<FavoriteCard kind="view" thing={{ view: view({ id: "root", join: "and", children: [] }) }} />)).not.toContain("data-appearance");
});

test("the space favorite's card names the space and its open epics, or says it has none", () => {
  const html = render(<FavoriteCard kind="team" thing={{ board }} />);
  expect(html).toContain('data-team-hover="7"');
  expect(html).toContain("Sync engine");
  expect(html).not.toContain("Shipped");
  commit({ issues: new Map() });
  const empty = renderToStaticMarkup(<RouterContextProvider router={router}><FavoriteCard kind="team" thing={{ board }} /></RouterContextProvider>);
  expect(empty).toContain("No epics");
});
