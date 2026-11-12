import { type Board, type Issue } from "@/shared/issue-model";
import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";

import type { FilterGroup } from "@/shared/view-model";

const storage = new Map<string, string>();
const define = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { configurable: true, value });
define("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
});
define("sessionStorage", globalThis.localStorage);
define("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
define("indexedDB", new IDBFactory());
define("location", {
  href: "http://localhost:3000/",
  origin: "http://localhost:3000",
  pathname: "/",
  search: "",
});
define("history", {
  pushState: (_s: unknown, _t: string, url: URL) => ((globalThis as any).location.href = String(url)),
  replaceState: (_s: unknown, _t: string, url: URL) =>
    ((globalThis as any).location.href = String(url)),
});

const filter = (field: "labels" | "priority", value: string): FilterGroup => ({
  id: "root",
  join: "and",
  children: [{ id: `${field}-${value}`, field, op: "is", values: [value] }],
});

test("the visible order follows a saved view, its temporary filters and the view editor's draft", async () => {
  const { get, set, ME } = await import("./store");
  const { navigate, openSavedView, setOverlay, setViewDraft } = await import("@/client/features/navigation/app-navigation");
  const { defaultPreferences, navigationIssues, visibleOrder } = await import("@/shared/view-model");
  const board: Board = {
    id: 1,
    name: "Board",
    columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }],
  };
  const issue = (key: string, rank: string, patch: Partial<Issue>): Issue => ({
    key,
    board: 1,
    summary: key,
    status: "todo",
    assignee: null,
    labels: [],
    comments: 0,
    updated: "2026-11-06T10:00:00Z",
    resolved: null,
    rank,
    ...patch,
  });
  set({
    boards: [board],
    preferences: { 1: defaultPreferences() },
    issues: new Map(
      [
        issue("A-1", "a", { labels: ["bug"], priority: "High" }),
        issue("A-2", "b", { labels: ["ui"] }),
        issue("A-3", "c", { labels: ["bug"] }),
      ].map((i) => [i.key, i]),
    ),
  });
  navigate({ board: 1 });
  const keys = () => navigationIssues(visibleOrder(get(), ME.id)).map((i) => i.key);
  expect(keys()).toEqual(["A-1", "A-2", "A-3"]);
  // Memoised on its inputs: a store selector can return it.
  expect(visibleOrder(get(), ME.id)).toBe(visibleOrder(get(), ME.id));

  const p = defaultPreferences(),
    at = new Date().toISOString();
  const view = {
    id: "bugs",
    board: 1,
    kind: "custom" as const,
    name: "Bugs",
    description: "",
    icon: "filter",
    color: "gray",
    filters: filter("labels", "bug"),
    display: p.display,
    scope: p.scope,
    mine: false,
    createdAt: at,
    updatedAt: at,
  };
  set({ savedViews: [view] });
  openSavedView(view);
  expect(keys()).toEqual(["A-1", "A-3"]);

  setOverlay(filter("priority", "High"));
  expect(keys()).toEqual(["A-1"]);

  setViewDraft({ ...view, filters: filter("labels", "ui") });
  expect(keys()).toEqual(["A-2"]);
});
