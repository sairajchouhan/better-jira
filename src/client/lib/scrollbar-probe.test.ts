import { expect, test } from "bun:test";
import { installScrollbarProbe, measureScrollbar, OBTRUSIVE, PROBE } from "./scrollbar-probe";

/** A page whose scrollbars take `regular` px, or `thin` px once body has the obtrusive class (0 and 0: overlay scrollbars). */
function page(regular: number, thin = regular) {
  const classes = new Set<string>();
  const vars = new Map<string, string>();
  const appended: unknown[] = [];
  let mode = { regular, thin };
  const width = () => 50 - (classes.has(OBTRUSIVE) ? mode.thin : mode.regular);
  const element = () => {
    const node = {
      className: "",
      tabIndex: 0,
      attributes: {} as Record<string, string>,
      children: [] as unknown[],
      removed: false,
      offsetWidth: 50,
      setAttribute(name: string, value: string) {
        node.attributes[name] = value;
      },
      append(child: unknown) {
        node.children.push(child);
      },
      remove() {
        node.removed = true;
      },
    };
    return node;
  };
  const created: ReturnType<typeof element>[] = [];
  const doc = {
    body: {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return !!force;
        },
      },
      append: (node: unknown) => appended.push(node),
    },
    documentElement: { style: { setProperty: (name: string, value: string) => vars.set(name, value) } },
    createElement() {
      const node = element();
      // The probe's inner div loses the scrollbar's room; the outer one is always 50px.
      if (created.length === 1) Object.defineProperty(node, "offsetWidth", { get: width });
      created.push(node);
      return node as unknown as HTMLDivElement;
    },
    querySelector: (selector: string) => (selector === `.${PROBE}` ? (appended[0] ?? null) : null),
  };
  let resized: (() => void) | undefined;
  class Resize {
    observed: unknown[] = [];
    constructor(callback: () => void) {
      resized = callback;
    }
    observe(target: unknown) {
      this.observed.push(target);
    }
    disconnect() {
      resized = undefined;
    }
  }
  return {
    doc,
    Resize,
    classes,
    vars,
    appended,
    created,
    /** The OS switches scrollbar mode (a mouse plugged in, the zoom changed): the inner div resizes. */
    switchTo(next: { regular: number; thin: number }) {
      mode = next;
      resized?.();
    },
    get observing() {
      return resized !== undefined;
    },
  };
}

test("obtrusive scrollbars: body gets the class and --scrollbar-width the thin width", () => {
  const p = page(15, 11);
  installScrollbarProbe(p.doc, p.Resize);
  expect(p.classes.has(OBTRUSIVE)).toBe(true);
  // Measured again under the class, as TTe does: the thin scrollbar's room, not the regular one's.
  expect(p.vars.get("--scrollbar-width")).toBe("11px");
});

test("overlay scrollbars: no class and a 0px --scrollbar-width", () => {
  const p = page(0);
  installScrollbarProbe(p.doc, p.Resize);
  expect(p.classes.has(OBTRUSIVE)).toBe(false);
  expect(p.vars.get("--scrollbar-width")).toBe("0px");
});

test("the probe is Linear's: a 50px scroll box with one child, hidden from assistive tech, added once", () => {
  const p = page(15, 11);
  installScrollbarProbe(p.doc, p.Resize);
  installScrollbarProbe(p.doc, p.Resize); // a hot reload of main.tsx
  expect(p.appended).toHaveLength(1);
  const [outer, inner] = p.created;
  expect(outer!.className).toBe(PROBE);
  expect(outer!.tabIndex).toBe(-1);
  expect(outer!.attributes["aria-hidden"]).toBe("true");
  expect(outer!.children).toEqual([inner]);
});

test("a scrollbar mode change re-measures through the ResizeObserver, both ways", () => {
  const p = page(0);
  installScrollbarProbe(p.doc, p.Resize);
  p.switchTo({ regular: 15, thin: 11 });
  expect(p.classes.has(OBTRUSIVE)).toBe(true);
  expect(p.vars.get("--scrollbar-width")).toBe("11px");
  p.switchTo({ regular: 0, thin: 0 });
  expect(p.classes.has(OBTRUSIVE)).toBe(false);
  expect(p.vars.get("--scrollbar-width")).toBe("0px");
});

test("removing the probe stops watching and takes it out of the page", () => {
  const p = page(15, 11);
  const remove = installScrollbarProbe(p.doc, p.Resize);
  expect(p.observing).toBe(true);
  remove();
  expect(p.observing).toBe(false);
  expect(p.created[0]!.removed).toBe(true);
});

test("measureScrollbar toggles the class off again when the thin measure finds no room", () => {
  const classes = new Set<string>();
  const doc = {
    body: { classList: { toggle: (name: string, force?: boolean) => (force ? classes.add(name) : classes.delete(name), !!force) } },
  };
  let calls = 0;
  const inner = {
    get offsetWidth() {
      return calls++ === 0 ? 35 : 50;
    },
  };
  expect(measureScrollbar(doc, { offsetWidth: 50 }, inner)).toBe(0);
  expect(classes.has(OBTRUSIVE)).toBe(false);
});
