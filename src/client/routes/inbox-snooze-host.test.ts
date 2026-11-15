import { expect, test } from "bun:test";
import { Glob } from "bun";

// H and the header's Snooze notification open the "snooze" overlay, which only InboxSnooze draws. The inbox's issue page is its
// own route, without the list that hosted the menu, so there H and the button did nothing (Linear's HEn snoozes from it). Every
// file that shows the notification's actions hosts the menu too. The overlay needs a DOM, so this reads the source.
test("every screen with the notification's actions hosts the snooze menu", async () => {
  const missing: string[] = [];
  for await (const path of new Glob("src/client/**/*.tsx").scan(".")) {
    if (path.includes(".test.")) continue;
    const source = await Bun.file(path).text();
    if (source.includes("<InboxIssueActions") && !source.includes("<InboxSnooze")) missing.push(path);
  }
  expect(missing).toEqual([]);
});
