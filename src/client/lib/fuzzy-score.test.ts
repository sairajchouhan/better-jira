import { expect, test } from "bun:test";
import {
  actionScore,
  breadcrumbKeywords,
  breadcrumbScore,
  fuzzyScore,
  hoistValues,
  HOISTED_PER_PARENT,
  menuFilter,
  MIN_APPLICABILITY,
  workflowOrder,
} from "./fuzzy-score";
import { COMMAND_KEYWORDS, VIEW_COMMAND_KEYWORDS } from "@/client/features/navigation/command-keywords";

test("BJ-180: Linear's search score ranks exact, then prefix, then word-start, then mid-word matches", () => {
  expect(fuzzyScore("tada", "tada")).toBe(1);
  expect(fuzzyScore("Tada", "tada")).toBe(0.9999);
  const prefix = fuzzyScore("tada", "ta"),
    word = fuzzyScore("party_tada", "ta"),
    inner = fuzzyScore("potato", "ta");
  expect(prefix).toBeGreaterThan(word);
  expect(word).toBeGreaterThan(inner);
  expect(fuzzyScore("tada", "zz")).toBe(0);
  expect(fuzzyScore(["nope", "tada"], "tada")).toBe(1);
});

test("FILTER-5: the shared menu filter ranks by Linear's score and searches a row by its keywords instead of its id", () => {
  // "to" finds Status › To Do first: a word-start label match beats a category whose name only contains it mid-word.
  expect(menuFilter("Status To Do todo", "to", ["To Do"])).toBeGreaterThan(menuFilter("Creator", "to"));
  for (const [label, query] of [["To Do", "todo"], ["In Progress", "inprog"], ["Assignee", "asign"]])
    expect(menuFilter(label!, query!)).toBeGreaterThan(0);
  expect(menuFilter("Status", "revi")).toBe(0);
  // A value is matched on its label: the path and the id in its value don't make it match.
  expect(menuFilter("Status To Do todo", "status", ["To Do"])).toBe(0);
});

test("5.10: a hoisted row scores by its breadcrumb as Linear's secondaryString, below an equal row of the menu itself", () => {
  // "status" finds Status › Todo by its breadcrumb, though "Todo" alone doesn't match it.
  expect(menuFilter("Status Todo todo", "status", ["Todo"])).toBe(0);
  const value = menuFilter("Status Todo todo", "status", breadcrumbKeywords("Todo", ["Status"]));
  expect(value).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  expect(value).toBeLessThan(menuFilter("Status", "status"));
  // Its own label still matches, 0.15 under the same label unhoisted.
  expect(breadcrumbScore(["Todo"], "Status Todo", "todo")).toBeCloseTo(fuzzyScore("Todo", "todo") - 0.15);
  // A weak hit of 3+ characters scores 0.34 when the label contains it, else 0.29 when the breadcrumb does; 2 characters don't.
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "ckin")).toBeCloseTo(MIN_APPLICABILITY + 0.1);
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "emov")).toBeCloseTo(MIN_APPLICABILITY + 0.05);
  expect(breadcrumbScore(["Blocking issue"], "Remove Blocking issue", "zq")).toBe(0);
});

import { personKeywords } from "./fuzzy-score";

test("assignee search (Linear's mH): \"me\" lifts the current user above everyone, though their name doesn't match it", () => {
  const score = (name: string, query: string, person: { me?: boolean; team?: boolean } = {}) =>
    menuFilter(`${name} id-${name}`, query, personKeywords(name, person));
  const you = score("Sairaj Chouhan", "me", { me: true });
  expect(you).toBeGreaterThan(score("Meera Shah", "me", { team: true }));
  expect(you).toBeGreaterThan(score("Me", "me"));
  // Someone else's row doesn't answer to "me" unless their name does.
  expect(score("Sairaj Chouhan", "me")).toBe(0);
  // A word of your own name lifts you too.
  expect(score("Sam Ray", "sa", { me: true })).toBeGreaterThan(score("Sana Ali", "sa", { team: true }));
});

test("assignee search: a team member outranks an equal match outside the team; a whole name gets its +10", () => {
  const score = (name: string, query: string, team = false) => menuFilter(name, query, personKeywords(name, { team }));
  expect(score("Alex", "al", true)).toBeGreaterThan(score("Alex", "al"));
  expect(score("Jo Lee", "jo lee") - score("Jo Leeds", "jo lee")).toBeGreaterThan(9);
  // The row is searched by the name alone, never by the account id in its value.
  expect(menuFilter("Alex 5b10ac", "5b10", personKeywords("Alex"))).toBe(0);
});

test("B2: ⌘K finds a command by Linear's keywords as well as its name", () => {
  const found = (name: string, id: string, query: string) => actionScore({ name, keywords: COMMAND_KEYWORDS[id] }, query);
  // Each query misses the name alone and finds the command through its keywords.
  for (const [name, id, query] of [
    ["Undo", "undo", "revert"],
    ["Toggle left sidebar", "sidebar", "hide sidebar"],
    ["Open document", "open-document", "goto"],
    ["Open user", "open-user", "goto"],
    ["Copy issue id", "copy-id", "identifier"],
    // Linear's Team reads Space here; "team" still finds it.
    ["Open space", "team-open", "team"],
    ["Add space", "board-add", "team"],
    ["Go to space 1", "team-1", "team"],
  ] as const) {
    expect(actionScore({ name }, query)).toBeLessThan(MIN_APPLICABILITY);
    expect(found(name, id, query)).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  }
  expect(actionScore({ name: "Delete view", keywords: VIEW_COMMAND_KEYWORDS["Delete view"] }, "remove")).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  // A keyword hit counts ×0.85, so the command named by the query still ranks first.
  expect(found("Undo", "undo", "redo")).toBeLessThan(actionScore({ name: "Redo" }, "redo"));
});

test("B2: Linear's score corrections: exact names and exact keywords score 1, a hoisted row loses 0.15, weak 3+ character hits", () => {
  // An exact name ignores case, punctuation and the ellipsis.
  expect(actionScore({ name: "Create view…" }, "create view")).toBe(1);
  expect(actionScore({ name: "Undo" }, " UNDO ")).toBe(1);
  // "me" is only an exact keyword on your own assignee row.
  expect(actionScore({ name: "Ada Lovelace", exact: ["me"], parents: ["Assign to"] }, "me")).toBeCloseTo(0.85);
  expect(actionScore({ name: "Ada Lovelace", parents: ["Assign to"] }, "me")).toBeLessThan(MIN_APPLICABILITY);
  expect(actionScore({ name: "High", parents: ["Change priority to"] }, "high")).toBeCloseTo(0.85);
  // A hoisted value is found by its parent's label too ("status" lists every status).
  expect(actionScore({ name: "Done", parents: ["Change status"] }, "status")).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  // Below 0.24, 3+ characters the name contains score 0.34, ones only the parents contain 0.29; 2 characters never.
  expect(actionScore({ name: "Blocking issue", parents: ["Remove"] }, "ckin")).toBeCloseTo(MIN_APPLICABILITY + 0.1);
  expect(actionScore({ name: "Blocking issue", parents: ["Remove"] }, "emov")).toBeCloseTo(MIN_APPLICABILITY + 0.05);
  expect(actionScore({ name: "Blocking issue", parents: ["Remove"] }, "zq")).toBeLessThan(MIN_APPLICABILITY);
});

test("A3: a status a query starts scores 0.84 less 0.001 per workflow step, so \"in\" lists statuses in workflow order", () => {
  const status = (name: string, index: number) => ({ name, parents: ["Change status"], override: workflowOrder(name, index) });
  expect(actionScore(status("In Progress", 2), "in prog")).toBeCloseTo(0.838);
  expect(actionScore(status("In Review", 3), "in")).toBeLessThan(actionScore(status("In Progress", 2), "in"));
  // A full name is not a prefix match: it keeps its own score.
  expect(actionScore(status("Done", 4), "done")).toBeCloseTo(0.85);
});

test("A3: values hoist into ⌘K from the parent's minimum input, at most 10 per parent in the parent's order", () => {
  const labels = Array.from({ length: 14 }, (_, i) => ({ name: `label-${String(i).padStart(2, "0")}`, parents: ["Add label"] }));
  expect(hoistValues(labels, "la", 3)).toEqual([]);
  const listed = hoistValues(labels, "lab", 3);
  expect(listed).toHaveLength(HOISTED_PER_PARENT);
  expect(listed.map(([, v]) => v.name)).toEqual(labels.slice(0, 10).map((l) => l.name));
  // Status and priority hoist from 2 characters, counted untrimmed as Linear does; a miss never counts towards the 10.
  const statuses = [{ name: "Todo" }, { name: "In Progress" }, { name: "Done" }].map((s) => ({ ...s, parents: ["Change status"] }));
  expect(hoistValues(statuses, "i", 2)).toEqual([]);
  expect(hoistValues(statuses, "in", 2).map(([, v]) => v.name)).toEqual(["In Progress"]);
});

import { hoistedRow, rowKeywords, typoScore } from "./fuzzy-score";
import { duePresets } from "./due-date";

/** A picker row as PickerRow hands it to menuFilter: its name, then rowKeywords. */
const row = (name: string, query: string, search: Parameters<typeof rowKeywords>[0] = {}, parents?: string[]) =>
  menuFilter(name, query, [name, ...rowKeywords(search)], { parents });

test("C3: the S picker lists the statuses a query starts in workflow order, from 0.999 less 0.001 a step (PCn submenu base)", () => {
  // Shorter names score higher on their own ("In Review" over "In Progress"); the workflow order wins.
  expect(row("In Progress", "in", { order: 1 })).toBeCloseTo(0.998);
  expect(row("In Review", "in", { order: 2 })).toBeCloseTo(0.997);
  expect(row("Done", "do", { order: 4 })).toBeLessThan(row("Doing", "do", { order: 2 }));
  // A whole name is no prefix match: it keeps its own score, so an exact query still picks it.
  expect(row("Done", "done", { order: 4 })).toBe(1);
});

test("C3: a status hoisted into a root menu orders from 0.84 (PCn hoisted base), under its parent's breadcrumb", () => {
  expect(row("Doing", "do", { order: 2 }, ["Status"])).toBeCloseTo(0.838);
  expect(row("Done", "do", { order: 4 }, ["Status"])).toBeCloseTo(0.836);
  // ⌘K reads the same order from the value's keywords.
  expect(hoistedRow("Doing", rowKeywords({ order: 2 })).override!(0.5, "do")).toBeCloseTo(0.838);
  expect(hoistedRow("Doing", ["open"]).keywords).toEqual(["open"]);
});

test("C3: a picker row is found by Linear's keywords through its secondary string", () => {
  for (const [name, keywords, query] of [
    ["Custom…", "select specific pick", "pick"],
    ["Remove due date", "clear delete", "clear"],
    ["No project", "epic delete", "epic"],
    ["No milestone", "project", "project"],
    ["Tomorrow", "tom", "tom"],
  ] as const) {
    expect(row(name, query, { keywords })).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
    if (query !== "tom") expect(row(name, query)).toBe(0);
  }
  // The secondary string counts ×0.85: a keyword hit ranks under the same hit on a name.
  expect(row("Custom…", "pick", { keywords: "select specific pick" })).toBeLessThan(row("Pick", "pick"));
});

test("C3: a pinned row is listed whatever is typed (skipFilterScoring): a typed date first, Create new label last", () => {
  expect(row("Due", "feb 9", { pin: "first" })).toBe(1);
  const create = row("Create new label", "zzz", { pin: "last" });
  expect(create).toBeGreaterThan(0);
  expect(create).toBeLessThan(row("bug", "b"));
});

test("C3: a row under 0.24 is left out, as Linear's filterAndSortByScores", () => {
  // Found only by a scattered subsequence of its no-space secondary string, and not by the typo fallback either.
  expect(row("Restore mirrored Jira version", "remind")).toBe(0);
  expect(menuFilter("Priya", "py", personKeywords("Priya"))).toBe(0);
});

test("C3: a typo below 0.24 is rescued by Linear's fallback (H8.scoreAll, then 0.4 + score × 0.45)", () => {
  // "asign" in "assignee": one character skipped, two runs of which one starts the word, the term not whole, at 0.
  expect(typoScore("assignee", "asign")).toBeCloseTo((5 / 6) * 0.45 + 0.5 * 0.25 + 0 + 0.1);
  expect(actionScore({ name: "Assignee" }, "asign")).toBeCloseTo(0.4 + typoScore("assignee", "asign") * 0.45, 5);
  expect(row("Assignee", "asign")).toBeGreaterThanOrEqual(MIN_APPLICABILITY);
  // Terms are found in order, across words; one missing character is no match.
  expect(typoScore("restore mirrored jira version", "remove")).toBeGreaterThan(0);
  expect(typoScore("restore mirrored jira version", "remind")).toBe(0);
  // Two whole terms, each starting a word, with the space between them skipped (uFuzzy's interIns).
  expect(typoScore("in progress", "in prog")).toBeCloseTo((6 / 7) * 0.45 + 0.25 + 0.2 + 0.1);
});

test("C3: the due presets carry Linear's keywords (gfn)", () => {
  expect(duePresets().map((p) => [p.name, p.keywords])).toEqual([
    ["Tomorrow", "tom"],
    ["End of this week", "end this week"],
    ["In one week", "one week"],
  ]);
});
