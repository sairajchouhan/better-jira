import { expect, test } from "bun:test";
import { defaultDisplay, FIELDS, type Display } from "@/shared/view-model";
import { GROUPING_ACTION, ORDERING_ACTION, groupingChoices, groupingOptions, estimateChoices, hoistedViewChoices, orderingChoices, orderingOptions } from "./view-choices";

const list: Display = { ...defaultDisplay(), layout: "list", columns: "status", ordering: "priority" };

test("Linear's action names: Change grouping (⌥⇧G) and View ordering… (⌥⇧O), hoisted from 2 and 5 characters", () => {
  expect([GROUPING_ACTION.name, GROUPING_ACTION.hoistFrom]).toEqual(["Change grouping", 2]);
  expect([ORDERING_ACTION.name, ORDERING_ACTION.parent, ORDERING_ACTION.hoistFrom]).toEqual(["View ordering…", "View ordering", 5]);
});

test("grouping choices are the Display select's options, named by label, the current one selected; a board has no No grouping", () => {
  const choices = groupingChoices(list, () => {});
  expect(choices.map((c) => c.name)).toEqual(groupingOptions("list").map(([, label]) => label));
  expect(choices[0]!.name).toBe("No grouping");
  expect(choices.filter((c) => c.selected).map((c) => c.name)).toEqual(["Status"]);
  expect(groupingChoices({ ...list, layout: "board" }, () => {}).map((c) => c.name)).not.toContain("No grouping");
});

test("ordering choices are Manual, then By <label lowercased>, with Linear's keywords", () => {
  const choices = orderingChoices(list, true, () => {});
  expect(choices.slice(0, 3).map((c) => c.name)).toEqual(["Manual", "By title", "By status"]);
  expect(choices.find((c) => c.selected)?.name).toBe("By priority");
  expect(choices.every((c) => c.keywords?.join(" ") === "order ordering")).toBe(true);
});

test("BJ-334: a board without estimates offers no Estimate ordering, unless the view is already ordered by it", () => {
  expect(orderingChoices(list, true, () => {}).map((c) => c.name)).toContain("By estimate");
  expect(orderingChoices(list, false, () => {}).map((c) => c.name)).not.toContain("By estimate");
  expect(orderingOptions(list, false).map(([value]) => value)).not.toContain("estimate");
  expect(orderingOptions({ ...list, ordering: "estimate" }, false).map(([value]) => value)).toContain("estimate");
  expect(estimateChoices(FIELDS, false, "status").map(([value]) => value)).not.toContain("estimate");
  expect(estimateChoices(FIELDS, true, "status").map(([value]) => value)).toContain("estimate");
});

test("picking a choice writes the display the Display menu's select writes", () => {
  const patches: Partial<Display>[] = [];
  groupingChoices(list, (p) => patches.push(p)).find((c) => c.name === "Assignee")!.run!();
  orderingChoices(list, true, (p) => patches.push(p)).find((c) => c.name === "Manual")!.run!();
  expect(patches).toEqual([{ columns: "assignee" }, { ordering: "manual" }]);
});

test("⌘K hoists grouping values from 2 characters and ordering values from 5, breadcrumbed, only while the action applies", () => {
  const rows = {
    grouping: groupingChoices(list, () => {}).map((c) => ({ name: c.name })),
    ordering: orderingChoices(list, true, () => {}).map((c) => ({ name: c.name, keywords: c.keywords })),
  };
  const all = () => true;
  const hit = (q: string, applies: (id: "grouping" | "ordering") => boolean = all) =>
    hoistedViewChoices(rows, q, applies).map(([, r]) => `${r.parents.join(" › ")} › ${r.name}`);
  expect(hit("a")).toEqual([]);
  expect(hit("as")).toContain("Change grouping › Assignee");
  // "By assignee" needs 5 typed characters before it is lifted.
  expect(hit("assi")).not.toContain("View ordering › By assignee");
  expect(hit("assig")).toContain("View ordering › By assignee");
  expect(hit("assig", (id) => id !== "ordering")).not.toContain("View ordering › By assignee");
});
