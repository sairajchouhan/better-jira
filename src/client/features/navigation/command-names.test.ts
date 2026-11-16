import { expect, test } from "bun:test";
import type { Issue } from "@/shared/issue-model";
import { COMMAND_ALT_NAMES, paletteName } from "./command-names";
import { shortcuts } from "./shortcuts";

const issue = (over: Partial<Issue> = {}) => ({ key: "ABC-7", labels: [], ...over }) as Issue;
const nameOf = (id: string, target?: Issue) => paletteName(shortcuts.find((s) => s.id === id)!, target, () => undefined);

test("BJ-244: ⌘K names the targeted issue's field commands as Linear's command menu does", () => {
  const bare = issue();
  expect(["assign", "status", "priority", "labels", "due", "remind", "project", "milestone"].map((id) => nameOf(id, bare))).toEqual([
    "Assign to…",
    "Change status…",
    "Set priority…",
    "Add labels…",
    "Set due date…",
    "Remind me about this issue…",
    "Add to epic…",
    "Add to milestone…",
  ]);
  const filled = issue({ priority: "High", labels: ["ui"], due: "2026-12-01", milestones: [{ id: "1", name: "v1" }] });
  expect(["priority", "labels", "due", "milestone"].map((id) => nameOf(id, filled))).toEqual([
    "Change priority…",
    "Change or add labels…",
    "Change due date…",
    "Move to milestone…",
  ]);
});

test("BJ-244: relation, parent and copy commands take Linear's ⌘K wording; the shortcuts panel keeps the registry name", () => {
  const target = issue({ parent: "ABC-1" });
  expect(nameOf("blocked", target)).toBe("Mark ABC-7 as blocked by…");
  expect(nameOf("duplicate", target)).toBe("Mark ABC-7 as duplicate of…");
  expect(nameOf("parent-set", target)).toBe("Change parent issue…");
  expect(nameOf("parent-set", issue())).toBe("Set parent issue…");
  expect(nameOf("copy-id", target)).toBe("Copy issue ID");
  expect(nameOf("copy-link", target)).toBe("Copy title as link");
  expect(nameOf("team-open")).toBe("Open space…");
  expect(nameOf("favorite-open")).toBe("Open favorite…");
  expect(shortcuts.find((s) => s.id === "copy-id")!.name).toBe("Copy issue id");
});

test("BJ-244: Dismiss all toasts keeps its key but stays out of ⌘K, as Linear's hideInCommandMenu", () => {
  expect(shortcuts.find((s) => s.id === "dismiss-toast")).toMatchObject({ hotkey: "Mod+Alt+X", hideInCommandMenu: true });
});

test("BJ-379/380: ⌘K's Copy commands take Linear's ⌥ names", () => {
  expect(COMMAND_ALT_NAMES).toEqual({
    "copy-id": "Copy issue ID as link",
    "copy-title": "Copy issue title without ID",
    "copy-link": "Copy title without ID as link",
  });
});
