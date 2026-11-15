import { expect, test } from "bun:test";
import { type Issue, type IssueDraft } from "@/shared/issue-model";
import { parentInProject, switchBoard } from "./composer-draft";

test("R3-create-D5: switching board keeps the board-independent properties and drops the board's own", () => {
  const draft: IssueDraft = {
    board: 1,
    title: "Kept",
    priority: "High",
    labels: ["a"],
    due: "2026-11-15",
    status: "todo",
    assignee: { id: "u", name: "U", avatar: "" },
    project: { key: "P", name: "P" },
    milestones: [{ id: "1", name: "v1" }],
  };
  expect(switchBoard(draft, 1, 2)).toEqual({ board: 2, title: "Kept", priority: "High", labels: ["a"], due: "2026-11-15" });
  expect(switchBoard(draft, 1, 1)).toBe(draft);
});

const P = { key: "P", name: "P" },
  Q = { key: "Q", name: "Q" };
const held: Record<string, Issue> = {
  "P-1": { key: "P-1", type: "Epic", project: P } as Issue,
  "Q-1": { key: "Q-1", type: "Epic", project: Q } as Issue,
  "Q-2": { key: "Q-2", type: "Task", project: Q } as Issue,
};
const lookup = (key: string) => held[key];

test("BJ-256: switching board drops an epic the new board can't hold (Linear's project outside the new team), keeps one it can, and keeps a parent issue", () => {
  expect(switchBoard({ board: 1, parent: "P-1", title: "T" }, 1, 2, lookup, [Q])).toEqual({ board: 2, title: "T" });
  expect(switchBoard({ board: 1, parent: "P-1", title: "T" }, 1, 2, lookup)).toEqual({ board: 2, title: "T" });
  // Two boards on the same Jira project: the epic still fits (Linear's `accessibleTeams.contains(team)`).
  expect(switchBoard({ board: 1, parent: "P-1", title: "T" }, 1, 2, lookup, [Q, P])).toEqual({ board: 2, parent: "P-1", title: "T" });
  expect(switchBoard({ board: 1, parent: "Q-2" }, 1, 2, lookup)).toEqual({ board: 2, parent: "Q-2" });
});

test("BJ-257: the draft follows a parent from another Jira project when the board has it; a foreign parent issue is never sent", () => {
  // The board holds only P: a parent issue in Q goes; Q's epic stays for Jira to judge (company-managed links across projects).
  expect(parentInProject({ parent: "Q-2", title: "T" }, [P], lookup)).toEqual({ title: "T" });
  const epic = { parent: "Q-1", title: "T" };
  expect(parentInProject(epic, [P], lookup)).toBe(epic);
  // The draft chose P: Q's parent issue goes.
  expect(parentInProject({ parent: "Q-2", project: P }, [P, Q], lookup)).toEqual({ project: P });
  // No project chosen and the board holds Q too: the issue goes to Q, in its epic.
  expect(parentInProject({ parent: "Q-1" }, [P, Q], lookup)).toEqual({ parent: "Q-1", project: Q });
  // Same project, or a parent the mirror doesn't hold: unchanged.
  const same = { parent: "P-1" };
  expect(parentInProject(same, [P], lookup)).toBe(same);
  const unknown = { parent: "Z-9" };
  expect(parentInProject(unknown, [P], lookup)).toBe(unknown);
});
