import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderWithFakeDocument } from "@/client/test/fake-document";
import { Toast, ToastEntry } from "./toast";
import { createToastQueue } from "./toast-queue";

test("a toast is React Aria's alertdialog, named by its title and described by its description, with the close slot", () => {
  const queue = createToastQueue();
  queue.show(
    <Toast>
      <Toast.Title>Issue created</Toast.Title>
      <Toast.Description>Fix the toast</Toast.Description>
      <Toast.Close />
    </Toast>,
    { id: "created", duration: Infinity },
  );
  const [toast] = queue.visibleToasts;
  const html = renderWithFakeDocument(() => renderToStaticMarkup(<ToastEntry queue={queue} toast={toast!} />));
  const dialog = /^<div [^>]*>/.exec(html)?.[0] ?? "";
  expect(dialog).toContain('role="alertdialog"');
  expect(dialog).toContain('tabindex="0"');
  expect(dialog).toContain('class="ui-toast-entry"');
  const title = /<p class="ui-toast-title " id="([^"]+)"/.exec(html)?.[1];
  const description = /<p class="ui-toast-description " id="([^"]+)"/.exec(html)?.[1];
  expect(dialog).toContain(`aria-labelledby="${title}"`);
  expect(dialog).toContain(`aria-describedby="${description}"`);
  expect(html).toContain('<div class="ui-toast " role="alert" aria-atomic="true"');
  expect(html).toMatch(/<button class="ui-toast-close"[^>]*aria-label="Dismiss"[^>]*slot="close"/);
});
