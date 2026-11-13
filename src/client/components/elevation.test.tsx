import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { ElevationScope, useElevation } from "./menu-surface";

/** A popup surface the way MenuSurface, Popover and the hand-built popups use the mechanism. */
function Surface({ name, variant, children }: { name: string; variant?: "surface" | "raised"; children?: ReactNode }) {
  const elevation = useElevation(variant);
  return (
    <div data-name={name} {...elevation.props}>
      <ElevationScope level={elevation.level}>{children}</ElevationScope>
    </div>
  );
}
const levels = (tree: ReactNode) =>
  Object.fromEntries(
    [...renderToStaticMarkup(tree).matchAll(/data-name="([^"]+)" data-elevation="(\d)"/g)].map(([, n, l]) => [n, Number(l)]),
  );

test("Linear's menuTheme is idempotent: a menu, or a submenu, over another surface stays at level 1", () => {
  expect(
    levels(
      <Surface name="dialog">
        <Surface name="menu">
          <Surface name="submenu" />
        </Surface>
      </Surface>,
    ),
  ).toEqual({ dialog: 1, menu: 1, submenu: 1 });
});

test("a Select's list climbs one level over the surface it opens from, and only from one", () => {
  expect(
    levels(
      <>
        <Surface name="page-select" variant="raised" />
        <Surface name="dialog">
          <Surface name="dialog-select" variant="raised" />
        </Surface>
        <Surface name="popover">
          <Surface name="popover-select" variant="raised">
            <Surface name="inside-list" />
          </Surface>
        </Surface>
      </>,
    ),
  ).toEqual({ "page-select": 1, dialog: 1, "dialog-select": 2, popover: 1, "popover-select": 2, "inside-list": 2 });
});
