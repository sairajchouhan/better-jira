import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InboxItem, InboxNote } from "@/shared/inbox-model";
import { InboxGroupNote, InboxGroupNotes, InboxGroupUpdates } from "./inbox-group";

/** The row's parts as Linear's ActivityHistoryEntry lays them out: [icon box contents?, the words-and-time run]. */
const parts = (html: string) => [html.includes('class="activity-event-icon"'), /class="activity-event-text">(.*?)<\/span><\/(?:div|li)>/.exec(html)?.[1]?.replace(/<[^>]+>/g, "")];

const note: InboxNote = {
  id: "n1",
  actor: { name: "Kim", avatar: "" },
  kind: "status",
  message: "Kim changed a task from To Do to Doing, a status change with a very long sentence that wraps",
  preview: "",
  time: "2026-11-01T10:00:00Z",
  status: "Doing",
  link: "https://cloudsairaj.atlassian.net/browse/ABC-1",
} as InboxNote;

test("R3 G18: a grouped notification and the group's summary line are activity rows, so a long one wraps beside its icon", () => {
  const [icon, run] = parts(renderToStaticMarkup(<InboxGroupNote note={note} mirrored={false} />));
  expect(icon).toBe(true);
  expect(run).toMatch(/^Status updated by Kim: To Do → Doing, .+ wraps\u00a0·\u00a0\S.*$/);
  // The folded group's summary line: its chevron in the icon box, its words beside it.
  const row = { ...note, id: "g1", head: "n1", count: 3, others: [{ name: "Priya", avatar: "" }, { name: "Lee", avatar: "" }] } as unknown as InboxItem;
  const html = renderToStaticMarkup(<InboxGroupUpdates row={row} mirrored={false} />);
  expect(html).toContain('<span class="activity-event-icon"><button type="button" aria-expanded="false" aria-label="Show grouped notifications"');
  expect(parts(html)[1]).toBe("+2 updates from Priya and others");
});

/** A group of `n` made-up notifications, newest first, whose first page (the feed's) holds the first ten. */
function seeded(id: string, n: number) {
  const notes = Array.from({ length: n }, (_, i) => ({ ...note, id: `${id}-n${i}`, message: `Kim changed a task from Step ${i} to Step ${i + 1}` }));
  return {
    ...note,
    id,
    head: notes[0]!.id,
    count: n,
    others: [{ name: "Kim" }],
    group: { notes: notes.slice(0, 10), more: n > 10, cursor: "c10" },
  } as unknown as InboxItem;
}

test("R3 G20 #15: an expanded group shows the head and five more before Show more, as Jira's bell", () => {
  const html = renderToStaticMarkup(<InboxGroupNotes row={seeded("g-paging", 12)} mirrored={false} />);
  expect(html.match(/data-inbox-note=/g)).toHaveLength(6);
  expect(html).toContain("Step 5 → Step 6");
  expect(html).not.toContain("Step 6 → Step 7");
  expect(html).toContain("Show more");
});

test("R3 G20: expanding a group shows the feed's first page at once, without reading it again", () => {
  const html = renderToStaticMarkup(<InboxGroupNotes row={seeded("g-seeded", 3)} mirrored={false} />);
  expect(html).not.toContain("Loading updates…");
  expect(html.match(/data-inbox-note=/g)).toHaveLength(3);
  // Every notification the feed read is shown, so nothing is left to page.
  expect(html).not.toContain("Show more");
});

test("R3 G20: a grouped comment's card is clamped to three lines, as Linear's comment card (truncate: 3)", () => {
  const long = "A long made-up comment that goes on. ".repeat(40).trim();
  const comment = { ...note, id: "c1", kind: "comment", message: "Kim commented on a task", preview: long, doc: { type: "doc", content: [] } } as InboxNote;
  const html = renderToStaticMarkup(<InboxGroupNote note={comment} mirrored={false} />);
  expect(html).toMatch(/<div [^>]*data-lines="3"[^>]*style="--lines:3">A long made-up comment/);
  expect(html).toContain("View comment");
});
