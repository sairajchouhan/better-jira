import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfirmDialog, Dialog, DIALOG } from "./dialog";

const render = renderToStaticMarkup;

test("a dialog is Linear's DialogPresenter box: named, in the elevated theme, as wide as asked but never wider than the window", () => {
  const html = render(
    <Dialog label="Preferences" close={() => {}} width={560}>
      <Dialog.Header>
        <Dialog.Title>Preferences</Dialog.Title>
      </Dialog.Header>
    </Dialog>,
  );
  expect(html).toMatch(/^<div role="dialog" aria-label="Preferences" data-elevation="dialog" data-surface="dialog"/);
  expect(html).toContain('style="width:min(560px, 100%)"');
  // React Aria's title slot, an h2 as before.
  expect(html).toMatch(/<h2 [^>]*class="ui-dialog-title /);
});

test("the side panel takes its own surface and width; a confirmation focuses its confirm button", () => {
  const side = render(
    <Dialog label="Keyboard Shortcuts" placement="side" close={() => {}}>
      x
    </Dialog>,
  );
  expect(side).toContain("side-panel");
  expect(side).not.toContain("style=");
  const confirm = render(<ConfirmDialog title="Delete view" description="Gone." confirmLabel="Delete" onConfirm={() => {}} close={() => {}} />);
  expect(confirm).toContain(`width:min(${DIALOG.CONFIRM_WIDTH}px, 100%)`);
  expect(confirm).toMatch(/<button[^>]*data-autofocus[^>]*>Delete<\/button>|<button[^>]*data-autofocus=""[^>]*>/);
});
