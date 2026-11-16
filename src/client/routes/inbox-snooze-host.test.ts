import { expect, test } from "bun:test";
import { Glob } from "bun";

// H and the header's Snooze notification open the "snooze" overlay, which only InboxSnooze draws, beside the inbox's list. The
// notification's actions show only in the inbox's pane (InboxIssuePane), which only the inbox screen renders, next to its list and
// its snooze menu: the issue's page reached from the inbox drops them, as Linear's IssuePage mounts no InboxActionControls (item 4).
// The overlay needs a DOM, so this reads the source.
test("the notification's actions show only in the inbox's pane, beside the list that hosts the snooze menu", async () => {
  const actions: string[] = [],
    panes: string[] = [];
  for await (const path of new Glob("src/client/**/*.tsx").scan(".")) {
    if (path.includes(".test.")) continue;
    const source = await Bun.file(path).text();
    if (source.includes("<InboxIssueActions")) actions.push(path);
    if (source.includes("<InboxIssuePane")) panes.push(path);
  }
  expect(actions.sort()).toEqual(["src/client/routes/inbox.tsx", "src/client/routes/issue-view.tsx"]);
  const view = await Bun.file("src/client/routes/issue-view.tsx").text();
  // In issue-view.tsx, only the pane renders them; the page (IssueScreen, IssuePage) doesn't.
  expect(view.match(/<InboxIssueActions/g)?.length).toBe(1);
  expect(view.slice(view.indexOf("export const InboxIssuePane")).includes("<InboxIssueActions")).toBe(true);
  expect(panes).toEqual(["src/client/routes/inbox.tsx"]);
  const inbox = await Bun.file("src/client/routes/inbox.tsx").text();
  expect(inbox.includes("<InboxSnooze")).toBe(true);
});
