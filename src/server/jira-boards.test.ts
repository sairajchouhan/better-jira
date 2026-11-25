import { describe, expect, test } from "bun:test";
import { filterAvailableBoards } from "@/shared/available-board";
import { listJiraBoards } from "./jira-boards";

describe("listJiraBoards", () => {
  test("paginates all pages, deduplicates by id, maps location metadata, and sorts by name", async () => {
    const seen: string[] = [];
    const page0 = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Board ${String(50 - i).padStart(2, "0")}`,
      type: i % 2 === 0 ? "kanban" : "scrum",
      location: { projectKey: `P${i + 1}`, projectName: `Project ${i + 1}` },
    }));
    const page1 = [
      // Duplicate id 1 from an overlapping page should not appear twice.
      { id: 1, name: "Board 50", type: "kanban", location: { key: "P1", name: "Project 1" } },
      { id: 51, name: "Alpha space", type: "kanban", location: { key: "ALP", name: "Alpha" } },
    ];
    const read = async (path: string) => {
      seen.push(path);
      return path.includes("startAt=0") ? { values: page0, isLast: false } : { values: page1, isLast: true };
    };

    const result = await listJiraBoards(read);
    expect(seen).toEqual([
      "/rest/agile/1.0/board?maxResults=50&startAt=0",
      "/rest/agile/1.0/board?maxResults=50&startAt=50",
    ]);
    expect(result.partial).toBe(false);
    expect(result.boards).toHaveLength(51);
    expect(result.boards[0]).toEqual({
      id: 51,
      name: "Alpha space",
      type: "kanban",
      projectKey: "ALP",
      projectName: "Alpha",
    });
  });

  test("caps at maxPages and reports partial=true when Jira has more boards", async () => {
    const seen: string[] = [];
    const fullPage = (offset: number) => ({
      values: Array.from({ length: 50 }, (_, i) => ({ id: offset + i + 1, name: `Board ${offset + i + 1}` })),
      isLast: false,
    });
    const read = async (path: string) => {
      seen.push(path);
      return path.includes("startAt=0") ? fullPage(0) : fullPage(50);
    };

    const result = await listJiraBoards(read, { maxPages: 2 });
    expect(seen).toHaveLength(2);
    expect(result.partial).toBe(true);
    expect(result.boards).toHaveLength(100);
  });

  test("passes name query param when searching server-side", async () => {
    const seen: string[] = [];
    const read = async (path: string) => {
      seen.push(path);
      return {
        values: [{ id: 12, name: "Platform Ops", type: "kanban", location: { projectKey: "OPS" } }],
        isLast: true,
      };
    };

    const result = await listJiraBoards(read, { name: "Platform" });
    expect(seen).toEqual(["/rest/agile/1.0/board?maxResults=50&startAt=0&name=Platform"]);
    expect(result).toEqual({
      boards: [{ id: 12, name: "Platform Ops", type: "kanban", projectKey: "OPS" }],
      partial: false,
    });
  });
});

describe("filterAvailableBoards", () => {
  const sample = [
    { id: 1, name: "Core Engineering", type: "kanban", projectKey: "CORE", projectName: "Core Platform" },
    { id: 42, name: "Design Systems", type: "scrum", projectKey: "DS", projectName: "Design" },
  ];

  test("matches by board name, project key, project name, type, or exact id", () => {
    expect(filterAvailableBoards(sample, "core").map((b) => b.id)).toEqual([1]);
    expect(filterAvailableBoards(sample, "ds").map((b) => b.id)).toEqual([42]);
    expect(filterAvailableBoards(sample, "platform").map((b) => b.id)).toEqual([1]);
    expect(filterAvailableBoards(sample, "scrum").map((b) => b.id)).toEqual([42]);
    expect(filterAvailableBoards(sample, "42").map((b) => b.id)).toEqual([42]);
    expect(filterAvailableBoards(sample, "").map((b) => b.id)).toEqual([1, 42]);
  });
});
