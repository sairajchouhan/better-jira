import { expect, test } from "bun:test";
import { openInNewTabOnMiddleClick } from "./middle-click";

// A row holding a link and a badge button, and a menu it opened in a portal (outside it in the DOM).
type FakeNode = { parent: FakeNode | null; matches: string[]; closest(selector: string): FakeNode | null };
const node = (parent: FakeNode | null, matches: string[] = []): FakeNode => {
  const self: FakeNode = {
    parent,
    matches,
    closest: (selector) => {
      for (let at: FakeNode | null = self; at; at = at.parent) if (at.matches.includes(selector)) return at;
      return null;
    },
  };
  return self;
};
const row = node(null);
const title = node(row, ['a[href], [role="dialog"]']);
const badge = node(row);
const portal = node(null);
const within = (inner: FakeNode | null, outer: FakeNode) => {
  for (let n = inner; n; n = n.parent) if (n === outer) return true;
  return false;
};

function click(button: number, on: FakeNode) {
  const opened: string[] = [];
  const event = {
    button,
    target: on as unknown as EventTarget,
    currentTarget: { contains: (n: Node | null) => within(n as unknown as FakeNode, row) },
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {
      this.stopped = true;
    },
  };
  openInNewTabOnMiddleClick(() => "http://localhost/issue/ABC-1", (url) => opened.push(url))(event);
  return { opened, prevented: event.prevented, stopped: event.stopped };
}

test("a middle-click on a card or row opens its issue in a new tab, as Linear's row links and Button onMiddleClick do", () => {
  expect(click(1, badge)).toEqual({ opened: ["http://localhost/issue/ABC-1"], prevented: true, stopped: true });
  expect(click(1, row).opened).toEqual(["http://localhost/issue/ABC-1"]);
});

test("only the middle button: a left or right click stays the row's own (⌘-click unchanged)", () => {
  expect(click(0, badge)).toEqual({ opened: [], prevented: false, stopped: false });
  expect(click(2, badge).opened).toEqual([]);
});

test("a link inside the row opens its own address, and a click from a menu the row opened isn't the row's", () => {
  expect(click(1, title)).toEqual({ opened: [], prevented: false, stopped: false });
  expect(click(1, portal).opened).toEqual([]);
});

test("board cards, list rows and sub-issue rows (an epic's issues too) take the middle-click", async () => {
  const board = await Bun.file(new URL("../../routes/board-view.tsx", import.meta.url)).text();
  expect(board).toMatch(/function IssueTarget[^]*?onAuxClick=\{openInNewTabOnMiddleClick\(\(\) => appURL\(issue\)\)\}/);
  const subIssues = await Bun.file(new URL("../issue/sub-issues.tsx", import.meta.url)).text();
  expect(subIssues).toMatch(/<GridListItem[^]*?data-sub-issue[^]*?onAuxClick=\{openInNewTabOnMiddleClick\(\(\) => appURL\(child\)\)\}/);
});
