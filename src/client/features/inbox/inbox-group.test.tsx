import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { InboxItem, InboxNote } from "@/shared/inbox-model";
import { InboxGroupNote, InboxGroupUpdates } from "./inbox-group";

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
