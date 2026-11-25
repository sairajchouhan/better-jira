import { describe, expect, test } from "bun:test";
import { readWholeBoard } from "./board-sync";

const cols = async () => ({ id: 1, name: "Engineering", columns: [{ name: "In Progress", statuses: [] }] });

describe("readWholeBoard", () => {
  test("shows priority active issues immediately before streaming the remaining pages", async () => {
    const events: string[] = [];
    const saved: string[] = [];
    const progress = await readWholeBoard({
      priorityFirstPage: async () => {
        events.push("priority");
        return { issues: ["ACT-1", "ACT-2"], total: 2 };
      },
      page: async (startAt) => {
        events.push(`page:${startAt}`);
        if (startAt === 0) return { issues: ["ACT-2", "DONE-3"], total: 4 };
        return { issues: ["DONE-2", "DONE-1"], total: 4 };
      },
      columns: cols,
      save: (issues) => saved.push(...(issues as string[])),
      shown: (_config, p) => events.push(`shown:${p.loaded}/${p.total}`),
      landed: (p) => events.push(`landed:${p.loaded}/${p.total}`),
      pageSize: 2,
      parallel: 2,
    });

    expect(events[0]).toBe("priority");
    expect(events[1]).toBe("shown:2/2");
    expect(events).toContain("page:0");
    expect(events).toContain("page:2");
    expect(saved).toEqual(["ACT-1", "ACT-2", "ACT-2", "DONE-3", "DONE-2", "DONE-1"]);
    expect(progress).toEqual({ loaded: 4, total: 4 });
  });

  test("falls back to page(0) before shown when priorityFirstPage returns no active issues", async () => {
    const events: string[] = [];
    const progress = await readWholeBoard({
      priorityFirstPage: async () => ({ issues: [], total: 0 }),
      page: async (startAt) => {
        events.push(`page:${startAt}`);
        return { issues: ["DONE-2", "DONE-1"], total: 2 };
      },
      columns: cols,
      save: () => {},
      shown: (_config, p) => events.push(`shown:${p.loaded}/${p.total}`),
      pageSize: 2,
      parallel: 2,
    });

    expect(events).toEqual(["page:0", "shown:2/2"]);
    expect(progress).toEqual({ loaded: 2, total: 2 });
  });
});
