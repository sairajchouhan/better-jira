import { expect, test } from "bun:test";
import { placed } from "./menu-surface";

const source = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

// Ship round 2: ⌘K pressed right after load (focus on <body>) opened an invisible palette. React Aria's Popover stays hidden
// (useEnterAnimation's opacity 0 and clip) until it has placed itself from its trigger, and the menu had no trigger to give it.
test("a menu with nothing to anchor to still gives React Aria a trigger, so it can place and show itself", async () => {
  const surface = await source("./menu-surface.tsx");
  expect(surface).toContain("const [trigger] = useState(() => ({ current: anchor ?? fallback ?? document.body }));");
  expect(surface).not.toMatch(/current: anchor \?\? fallback \?\? null/);
});

// Once placed, React Aria writes its own top and max-height onto the node (measured against the trigger, the whole page for
// ⌘K: the palette sat below the window with max-height 0). Our edges go through custom properties index.css applies with
// !important, so they hold over React Aria's writes on every menu and toolbar popover.
test("our placement's edges hold over the ones React Aria writes onto the node", async () => {
  expect(placed({ position: "fixed", width: 720, left: 340, top: 110, maxHeight: 774 })).toEqual({
    position: "fixed",
    width: 720,
    "--placed-top": "110px",
    "--placed-left": "340px",
    "--placed-right": "auto",
    "--placed-bottom": "auto",
    "--placed-max-height": "774px",
  } as never);
  expect(placed({ top: "12vh", maxHeight: "80vh" })).toMatchObject({ "--placed-top": "12vh", "--placed-max-height": "80vh" });
  expect(placed(undefined)).toMatchObject({ visibility: "hidden", "--placed-top": "0px", "--placed-left": "0px" });
  const css = await source("../index.css");
  for (const edge of ["top", "left", "right", "bottom", "max-height"])
    expect(css).toContain(`${edge}: var(--placed-${edge}, ${edge === "max-height" ? "none" : "auto"}) !important;`);
  expect((await source("./menu-surface.tsx")).match(/\n\s+data-placed\n/g)).toHaveLength(2);
});
