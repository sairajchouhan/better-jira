import { expect, test } from "bun:test";

// The pane renders the whole issue (editor, comments, activity), which needs a DOM, so these read the source.
const view = await Bun.file("src/client/routes/issue-view.tsx").text();
const inbox = await Bun.file("src/client/routes/inbox.tsx").text();
/** The source of the component declared at `start`, up to the next top-level declaration. */
const body = (source: string, start: string) => {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const next = source.slice(from + start.length).search(/\n(export )?(const|function) /);
  return source.slice(from, next < 0 ? undefined : from + start.length + next);
};
const pane = body(view, "export const InboxIssuePane");

test("item 1: the pane's header leads with the issue's key and title (PaneIssueTitle, Linear's Hh), not the bare key", () => {
  expect(pane).toContain("<PaneIssueTitle issue={issue} />");
  expect(pane).not.toContain("IssueKey");
});

test("item 2: the pane has no Open as full page or Close button, as Linear's IssueInboxView; the board's panel and page keep theirs", () => {
  expect(pane).not.toContain("FrameControls");
  expect(pane).not.toMatch(/Open as full page|label="Close"/);
  expect(body(view, "export const IssueSidePanel")).toContain('<FrameControls switchTo="page" />');
  expect(body(view, "export const IssuePage")).toContain('<FrameControls switchTo="side" />');
});

test("the pane always shows the issue's properties; ⌘⌥I hides them only on the board's panel and page", () => {
  expect(pane).toMatch(/<IssueBody issue={issue} \/>/);
  expect(body(view, "export const IssueSidePanel")).toContain("propertiesHidden={propertiesHidden}");
});

test("item 6: no +N updates disclosure sits above the issue in the pane; Linear's IssueInboxView mounts no group", () => {
  expect(pane).not.toContain("InboxGroupUpdates");
  expect(inbox).not.toContain("InboxIssueGroup");
  // The notification shown on its own (an issue outside the mirror) keeps its group.
  expect(body(inbox, "export function InboxNotification")).toContain("<InboxGroupUpdates");
});

test("item 10: a mirrored row whose issue is not open leaves Linear's empty state, never the no-such-issue notification (D1)", () => {
  const empty = body(inbox, "export function InboxPane");
  expect(empty).toContain("s.issues.has(row.key)");
  expect(empty).toContain("if (row && !mirrored)");
});

test("item 4: the full page reached from the inbox reads notifications as any issue page does; only the pane skips it", async () => {
  const visit = await Bun.file("src/client/features/inbox/issue-visit.ts").text();
  expect(visit.match(/const fromInbox = useStore\(inboxShown\);/g)?.length).toBe(2);
});

test("the inbox, hosted by the Shell outside any route match (tree.tsx InboxHost), reads no match-bound router hook", () => {
  expect(inbox).not.toMatch(/\b(useSearch|useParams|useMatch|useLoaderData|useRouteContext)\(/);
});
