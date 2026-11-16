import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const card = (key: string, extra: Record<string, unknown> = {}) =>
  ({ key, boards: [1], summary: key, status: "todo", assignee: null, labels: [], updated: "", resolved: null, comments: 0, ...extra }) as never;

test("a card's epic badge shows the epic's violet Jira type icon, never the layers glyph", async () => {
  const { set } = await import("@/client/state/store");
  const { ProjectBadge } = await import("./board-view");
  set({ issues: new Map([["EP-1", card("EP-1", { type: "Epic", summary: "Collab" })], ["EP-2", card("EP-2", { type: "Bug", parent: "EP-1" })]]) });
  const html = renderToStaticMarkup(<ProjectBadge issue={card("EP-2", { type: "Bug", parent: "EP-1" })} />);
  expect(html).toContain("Collab");
  expect(html).toContain('title="Epic"');
  expect(html).toContain("background:#bb87fc");
  expect(html).not.toContain("<svg");
  // The epic's own card has no epic badge: it is the epic.
  expect(renderToStaticMarkup(<ProjectBadge issue={card("EP-1", { type: "Epic", summary: "Collab" })} />)).toBe("");
});
