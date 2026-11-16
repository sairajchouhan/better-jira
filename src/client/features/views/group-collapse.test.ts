import { expect, test } from "bun:test";
import { type Issue } from "@/shared/issue-model";
import { type Bucket } from "@/shared/view-model";
import { collapseClick, collapseTarget, collapseTip } from "./group-collapse";

test("the chevron's tooltip is Linear's: T for this group over ⌥ click for all, expand while collapsed", () => {
  expect(collapseTip(false, true)).toBe("(T) to collapse group\n(⌥ click) to collapse all");
  expect(collapseTip(true, true)).toBe("(T) to expand group\n(⌥ click) to expand all");
  expect(collapseTip(false, false)).toBe("(T) to collapse group\n(Alt click) to collapse all");
});

test("⌥-click on the chevron toggles every group, a plain click only its own (CollapseListGroupButton `S`)", () => {
  const calls: string[] = [];
  collapseClick({ altKey: false }, () => calls.push("one"), () => calls.push("all"));
  collapseClick({ altKey: true }, () => calls.push("one"), () => calls.push("all"));
  expect(calls).toEqual(["one", "all"]);
});

test("T and ⌥T act on the groups the list shows, never the board's unfiltered ones (BJ-278)", () => {
  const issue = (key: string) => ({ key }) as Issue;
  // A filter left Todo with only A, and Doing empty is hidden: these are the shown groups.
  const shown = [{ id: "Todo", issues: [issue("A")] }, { id: "Done", issues: [issue("C")] }] as Bucket[];
  expect(collapseTarget(shown, "A", false)).toEqual({ ids: ["Todo"] });
  expect(collapseTarget(shown, "A", true)).toEqual({ ids: ["Todo", "Done"], from: "Todo" });
  // The selected issue is filtered out: T has no group; ⌥T toggles each shown group.
  expect(collapseTarget(shown, "B", false)).toBeNull();
  expect(collapseTarget(shown, "B", true)).toEqual({ ids: ["Todo", "Done"] });
  expect(collapseTarget([], null, true)).toEqual({ ids: [] });
});

test("the T and ⌥T shortcuts feed collapseTarget the list's shown groups from boardView (BJ-278)", async () => {
  const src = await Bun.file(new URL("../navigation/shortcuts.tsx", import.meta.url)).text();
  const body = /function collapse\(all = false\) \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
  expect(body).toContain("boardView(s, ME.id)");
  expect(body).toContain("collapseTarget(groupVisibility(view.columns, view.prefs).show, s.selected, all)");
});
