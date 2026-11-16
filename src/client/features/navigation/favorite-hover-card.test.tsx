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
import type { IssueResource } from "@/shared/issue-resource";
import { epicProgress, favoriteCardAnchor, FavoriteCard, favoriteCardKind, FavoriteHoverCard, FavoriteIcon, fittingNames } from "./favorite-hover-card";

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

const doc = (patch: Partial<IssueResource> = {}): IssueResource => ({
  id: "d1", kind: "document", title: "Rollout plan", updated: "2026-11-02T10:00:00Z", editedBy: { id: "u2", name: "Ben Ito" }, ...patch,
});

test("each favorite opens its kind's card: an issue the issue card, an epic the project card, a view the view card, a space the team card, a document the document card", () => {
  expect(favoriteCardKind({ issue: issue("Z-2") })).toBe("issue");
  expect(favoriteCardKind({ issue: epic })).toBe("project");
  expect(favoriteCardKind({ view: view(rules) })).toBe("view");
  expect(favoriteCardKind({ board })).toBe("team");
  expect(favoriteCardKind({ document: { issue: all[4]!, resource: doc() } })).toBe("document");
  expect(favoriteCardKind({})).toBeNull();
  expect(renderToStaticMarkup(<FavoriteHoverCard.Row thing={{}} label="Gone"><a href="/d">Gone</a></FavoriteHoverCard.Row>)).toBe('<a href="/d">Gone</a>');
});

test("a favorite's card opens after Linear's interactive card delay (550ms, `Rwe`), to the right of the row (`h$` → `wZ` position right)", async () => {
  expect(TOOLTIP_TIMING.card.delay).toBe(550);
  const source = await Bun.file(new URL("./favorite-hover-card.tsx", import.meta.url)).text();
  expect(source).toMatch(/<HoverCard\s+placement="right"\s+display=\{at === "row" \? "block" : "fill"\}/);
  // No delay of its own: every favorite kind takes the card default.
  expect(source).not.toMatch(/<HoverCard[^>]*\bdelay=/);
  // The trigger is the full-width row (`_$.tooltipBlock`), so the row keeps its whole width.
  const html = renderToStaticMarkup(<FavoriteHoverCard.Row thing={{ issue: all[4]! }} label="Z-5"><a href="/i">Z-5</a></FavoriteHoverCard.Row>);
  expect(html).toMatch(/^<span class="flex w-full min-w-0" data-hover-card-trigger="">/);
});

test("BJ-410: a space's card sits beside its label (`m5n`'s toggle button), every other kind's beside the whole row (`d5n` → `h$`)", () => {
  expect(favoriteCardAnchor("team")).toBe("label");
  for (const kind of ["issue", "project", "view", "document"] as const) expect(favoriteCardAnchor(kind)).toBe("row");
  // A space: the row passes through, the label (icon and name, growing up to the ×, with the row's gap) is the trigger.
  const row = (thing: Parameters<typeof favoriteCardKind>[0]) =>
    renderToStaticMarkup(
      <FavoriteHoverCard.Row thing={thing} label="x">
        <a href="/r">
          <FavoriteHoverCard.Label thing={thing} label="x"><i />name</FavoriteHoverCard.Label>
          <b>×</b>
        </a>
      </FavoriteHoverCard.Row>,
    );
  expect(row({ board })).toBe('<a href="/r"><span class="flex min-w-0 flex-1 items-center gap-[inherit]" data-hover-card-trigger=""><i></i>name</span><b>×</b></a>');
  // Any other kind: the row is the trigger and the label is plain.
  expect(row({ issue: all[4]! })).toBe('<span class="flex w-full min-w-0" data-hover-card-trigger=""><a href="/r"><i></i>name<b>×</b></a></span>');
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

test("the view favorite's card shows the view's own filters as read-only chips: no button, no remove, tooltip appearance", async () => {
  const html = render(<FavoriteCard kind="view" thing={{ view: view(rules) }} />);
  expect(html).toContain('data-view-hover="v1"');
  expect(html).toContain("Triage");
  expect(html).toContain("Fresh bugs to sort");
  expect(html).toContain('data-appearance="tooltip"');
  expect(html).toContain("data-read-only");
  expect(html).not.toContain("<button");
  expect(html).not.toMatch(/aria-label="Remove/);
  // Outside the filter bar the chips still take the chip tokens, at the chip's own 12px (Linear's micro rounds up to 12px live),
  // and draw no value icons.
  const css = await Bun.file(new URL("../../components/filter-block.css", import.meta.url)).text();
  const tooltip = css.match(/\.ui-filter-blocks\[data-appearance="tooltip"\] \{([^}]*)\}/)?.[1] ?? "";
  for (const token of ["--chip-border", "--chip-bg", "--chip-divider"]) expect(tooltip).toContain(token);
  expect(css).toMatch(/\[data-appearance="tooltip"\] \.ui-filter-icons \{\s*display: none;/);
  expect(css).not.toMatch(/data-appearance="tooltip"[^{]*\{[^}]*font-size: 11px/);
  // A view filtering nothing shows no chip row (`Y8n` returns null).
  expect(render(<FavoriteCard kind="view" thing={{ view: view({ id: "root", join: "and", children: [] }) }} />)).not.toContain("data-appearance");
});

test("BJ-413: a card row names as many epics as Linear's 42-character budget holds (`fct`, two more per comma), always at least one", () => {
  expect(fittingNames([])).toBe(0);
  expect(fittingNames(["x".repeat(60), "short"])).toBe(1);
  // 20 + 2 + 20 = 42 fits; one more character doesn't.
  expect(fittingNames(["a".repeat(20), "b".repeat(20), "c"])).toBe(2);
  expect(fittingNames(["a".repeat(20), "b".repeat(17), "c"])).toBe(3);
  expect(fittingNames(["a".repeat(20), "b".repeat(21)])).toBe(1);
  expect(fittingNames(["Ab", "Cd", "Ef", "Gh", "Ij"])).toBe(5);
  // Rendered: comma separated in one truncating line, then "+N" with the rest in its title.
  const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"];
  const epics = names.map((name, n) => issue(`E-${n + 10}`, { type: "Epic", summary: name }));
  commit({ issues: new Map(epics.map((e) => [e.key, e])), boards: [board], board: 7 });
  const html = renderToStaticMarkup(<RouterContextProvider router={router}><FavoriteCard kind="team" thing={{ board }} /></RouterContextProvider>);
  // "Alpha, Bravo, Charlie, Delta, Echo" is 34 characters; ", Foxtrot" would make 43.
  expect(html).toContain('data-team-epics="5"');
  expect(html).toMatch(/Alpha<\/a>, <a[^>]*>Bravo/);
  expect(html).toMatch(/title="Foxtrot\nGolf"[^>]*>\+(<!-- -->)?2</);
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

test("every sidebar favorite row goes through the one card wrapper, inside its menu so the × and right-click still work, and no card opens while a favorite is dragged", async () => {
  const rows = await Bun.file(new URL("../views/views-navigation.tsx", import.meta.url)).text();
  expect(rows).toMatch(/<ContextMenu label="Favorite options" entries=\{.*?\}><FavoriteHoverCard\.Row thing=\{thing\} label=\{label\}>\{link\}<\/FavoriteHoverCard\.Row><\/ContextMenu>/);
  expect(rows).toMatch(/<FavoriteHoverCard\.Label thing=\{thing\} label=\{label\}><FavoriteIcon \{\.\.\.thing\} \/>.*?<\/FavoriteHoverCard\.Label><RemoveFavoriteButton id=\{id\} \/>/);
  const wrapper = await Bun.file(new URL("./favorite-hover-card.tsx", import.meta.url)).text();
  expect(wrapper).toContain("const sorting = useSortableDragging(),");
  expect(wrapper).toMatch(/<HoverCard[^>]*\bisDisabled=\{sorting \|\| dragging\}/s);
});

test("BJ-409: no favorite card opens while anything is dragged (`zN()`), an issue on its way across the sidebar as much as a favorite", async () => {
  const { isDragging, subscribeToDrags } = await import("@/client/components/drag-state");
  const before = globalThis.document;
  const target = new EventTarget();
  globalThis.document = target as unknown as Document;
  try {
    const stop = subscribeToDrags(() => {});
    expect(isDragging()).toBe(false);
    target.dispatchEvent(new Event("dragstart"));
    expect(isDragging()).toBe(true);
    target.dispatchEvent(new Event("dragend"));
    expect(isDragging()).toBe(false);
    // A drop, or the next press after a drag whose row unmounted, ends it too.
    target.dispatchEvent(new Event("dragstart"));
    target.dispatchEvent(new Event("drop"));
    expect(isDragging()).toBe(false);
    target.dispatchEvent(new Event("dragstart"));
    target.dispatchEvent(new Event("pointerdown"));
    expect(isDragging()).toBe(false);
    target.dispatchEvent(new Event("dragstart"));
    stop();
    expect(isDragging()).toBe(false);
  } finally {
    globalThis.document = before;
  }
  const wrapper = await Bun.file(new URL("./favorite-hover-card.tsx", import.meta.url)).text();
  expect(wrapper).toContain("dragging = useAnyDrag();");
});

test("BJ-408: each favorite row shows the item's own icon (Linear's `z1`): an issue its type, a view's, a space's and a document's, never ☆", async () => {
  commit({ issues: new Map(all.map((i) => [i.key, i])), boards: [board], board: 7 });
  const icon = (thing: Parameters<typeof favoriteCardKind>[0]) => renderToStaticMarkup(<FavoriteIcon {...thing} />);
  // Every issue, an epic included, shows its Jira type (the user's choice over Linear's status and project icons): the type's
  // TypeDot in a 16px box, never the layers icon or the status ring (no svg).
  const typeIcon = (type: string, color: string) =>
    new RegExp(`^<span aria-hidden="true" class="grid size-4 shrink-0 place-items-center" data-favorite-icon="type"><span title="${type}"[^>]*background:${color}`);
  expect(icon({ issue: epic })).toMatch(typeIcon("Epic", "#bb87fc"));
  expect(icon({ issue: issue("Z-7", { type: "Spike" }) })).toMatch(typeIcon("Spike", "#f2994a"));
  expect(icon({ issue: all[4]! })).toMatch(typeIcon("Task", "#4ea7fc"));
  for (const i of [epic, issue("Z-7", { type: "Spike" }), all[4]!]) expect(icon({ issue: i })).not.toContain("<svg");
  expect(icon({ view: view(rules) })).toContain('style="color:var(--view-gray)"');
  expect(icon({ board })).toContain("width:14px");
  expect(icon({ board })).toContain(">S</span>");
  expect(icon({ document: { issue: all[4]!, resource: doc({ icon: { name: "star", color: "#4cb782" } }) } })).toMatch(/data-document-glyph="star"/);
  expect(icon({ document: { issue: all[4]!, resource: doc({ icon: { name: "emoji:🚀", color: "#4cb782" } }) } })).toContain(">🚀</span>");
  const rows = await Bun.file(new URL("../views/views-navigation.tsx", import.meta.url)).text();
  expect(rows).not.toContain("☆");
});

test("BJ-412: a document's card (`cpt`): its icon and title, then its issue and 'Last edited {date} by {editor}', and no summary", () => {
  const html = render(<FavoriteCard kind="document" thing={{ document: { issue: all[4]!, resource: doc({ icon: { name: "list", color: "#5e6ad2" } }) } }} />);
  expect(html).toContain('data-document-hover="d1"');
  expect(html).toContain('data-document-glyph="list"');
  expect(html).toContain("Rollout plan");
  expect(html).toMatch(/data-document-parent=""[^]*Z-5 title/);
  // The card's issue line keeps the issue's status (14px ring), not the favorite rows' type icon.
  expect(html).toMatch(/data-document-parent=""[^>]*><svg width="14" height="14" viewBox="0 0 14 14"/);
  expect(html).toMatch(/data-document-edited=""[^]*Last edited Nov 2 by Ben Ito/);
  expect(html).toContain("border-(--card-divider)");
  // No editor known: no "by"; an untitled document reads "New document".
  const bare = render(<FavoriteCard kind="document" thing={{ document: { issue: all[4]!, resource: doc({ title: "", editedBy: undefined }) } }} />);
  expect(bare).toContain("New document");
  expect(bare).not.toContain(" by ");
  expect(bare).toMatch(/Last edited Nov 2</);
});

test("the epic card's target date is Linear's (\"Jan 1st, '20\", `kA` → `Zp.format` with shortYear), the calendar plain once the epic is done", () => {
  const html = render(<FavoriteCard kind="project" thing={{ issue: epic }} />);
  expect(html).toMatch(/title="Target date"[^]*?data-due="overdue"[^]*?Jan 1st, &#x27;20/);
  const done = render(<FavoriteCard kind="project" thing={{ issue: { ...epic, status: "done", resolved: "2026-11-01T10:00:00Z" } }} />);
  expect(done).toMatch(/title="Target date"[^]*?data-due="none"/);
});

test("BJ-411: a progress ring on a card, menu or dialog draws its track in that surface's bgBorder (Linear's `Nk` reads its theme's)", async () => {
  const css = await Bun.file(new URL("../../components/control-tokens.css", import.meta.url)).text();
  expect(css).toMatch(/\[data-elevation\] \{[^}]*--progress-track: var\(--bg-border\);/);
  const hoverCard = await Bun.file(new URL("../../components/hover-card.tsx", import.meta.url)).text();
  expect(hoverCard).toMatch(/data-hover-card=\{label\}\s+\{\.\.\.elevation\.props\}/);
});
