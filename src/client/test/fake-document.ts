/**
 * Server-renders a tree that reads `document` (the composer does), with a stub document for the call. React Aria sets up its
 * focus-visible listeners during render and patches the owner window's `HTMLElement.prototype.focus`, so a window another test
 * file left behind gets a stub `HTMLElement` for the call too.
 */
export function renderWithFakeDocument<T>(render: () => T): T {
  const g = globalThis as { document?: unknown; window?: { HTMLElement?: unknown } };
  const win = g.window;
  const stubElement = !!win && !win.HTMLElement;
  g.document = { activeElement: null, getElementById: () => null, addEventListener() {}, removeEventListener() {} };
  if (stubElement) win.HTMLElement = function HTMLElement() {};
  try {
    return render();
  } finally {
    delete g.document;
    if (stubElement) delete win.HTMLElement;
  }
}
