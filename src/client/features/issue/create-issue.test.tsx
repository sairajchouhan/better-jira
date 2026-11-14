import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

test("R3-create-D1/D3/D6: the composer is not a form (Enter in a side field or a nested date form can't submit or reload) and the due chip reads like the app", async () => {
  const { set } = await import("@/client/state/store");
  const { ui } = await import("@/client/features/navigation/app-navigation");
  const { CreateIssue } = await import("./personal-controls");
  set({
    boards: [{ id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] }],
  } as never);
  ui.send({ type: "overlay.open", overlay: "create", draft: { board: 1, due: "2030-11-15" } });
  Object.assign(globalThis, { document: { activeElement: null, getElementById: () => null, addEventListener() {}, removeEventListener() {} } });
  let html: string;
  try {
    html = renderToStaticMarkup(<CreateIssue />);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  expect(html).toContain("Issue title");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("2030-11-15");
  expect(html).toContain('maxLength="255"');
});

test("R3-comments-D6: a file the composer's description already shows is not listed again below it", async () => {
  const { set } = await import("@/client/state/store");
  const { ui } = await import("@/client/features/navigation/app-navigation");
  const { CreateIssue } = await import("./personal-controls");
  set({
    boards: [{ id: 1, name: "B", columns: [{ name: "Todo", statuses: [{ id: "todo", name: "Todo", category: "new" }] }] }],
  } as never);
  const file = (id: string, name: string) => ({ id, name, type: "image/png", size: 10, url: "" });
  ui.send({
    type: "overlay.open",
    overlay: "create",
    draft: {
      board: 1,
      attachments: [file("shown", "copied-shot.png"), file("loose", "loose-file.png")],
      descriptionDoc: {
        type: "doc",
        version: 1,
        content: [{ type: "mediaSingle", content: [{ type: "media", attrs: { id: "shown", type: "file", collection: "" } }] }],
      },
    },
  });
  Object.assign(globalThis, { document: { activeElement: null, getElementById: () => null, addEventListener() {}, removeEventListener() {} } });
  let html: string;
  try {
    html = renderToStaticMarkup(<CreateIssue />);
  } finally {
    delete (globalThis as { document?: unknown }).document;
  }
  expect(html).toContain("loose-file.png");
  expect(html).not.toContain("copied-shot.png");
});
