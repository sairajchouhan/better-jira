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

test("Escape closes a dialog even with focus on its box, and its keys stop there but ⌘K and ⌘/ (dialogKey)", async () => {
  const { dialogKey } = await import("./dialog");
  const key = (key: string, mods: { metaKey?: boolean } = {}) => {
    const e = { key, metaKey: false, ctrlKey: false, defaultPrevented: false, stopped: false, ...mods,
      preventDefault() { e.defaultPrevented = true; }, stopPropagation() { e.stopped = true; } };
    return e;
  };
  let closed = 0;
  const escape = key("Escape");
  dialogKey(escape, () => closed++);
  expect([closed, escape.defaultPrevented, escape.stopped]).toEqual([1, true, true]);
  const s = key("s");
  dialogKey(s, () => closed++);
  expect([closed, s.stopped]).toEqual([1, true]);
  const palette = key("k", { metaKey: true });
  dialogKey(palette, () => closed++);
  expect(palette.stopped).toBe(false);
  // The box's own keys (React Aria's Dialog focuses itself; a press on its padding does too) get the same handling.
  const source = await Bun.file(new URL("./dialog.tsx", import.meta.url)).text();
  expect(source).toMatch(/if \(event\.target === node\) dialogKey\(event/);
  // The box ref sits on an ancestor of the content, attached after its layout effects: initial focus reads it in the frame.
  const surface = await Bun.file(new URL("./menu-surface.tsx", import.meta.url)).text();
  expect(surface).toMatch(/requestAnimationFrame\(\(\) => \{\s*const node = ref\.current;/);
});
