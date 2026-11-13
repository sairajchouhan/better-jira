import { expect, test } from "bun:test";

const css = (await Bun.file(new URL("./node-toolbar.css", import.meta.url)).text()).replace(/\/\*[\s\S]*?\*\//g, "");

test("BJ-228: a hover-revealed node toolbar is Linear's kx.reveal + kx.fade: .1s delay on hover, 40ms ease-out, instant with focus inside", () => {
  expect(css).toMatch(/\.ui-node-toolbar\[data-reveal="hover"\] \{\s*opacity: 0;\s*pointer-events: none;\s*transition-property: opacity;\s*transition-duration: 40ms;\s*transition-timing-function: ease-out;\s*transition-delay: 0s;/);
  expect(css).toMatch(/\[data-node-toolbar-host\]:hover \.ui-node-toolbar\[data-reveal="hover"\] \{\s*opacity: 1;\s*pointer-events: auto;/);
  expect(css).toMatch(/\[data-node-toolbar-host\]:hover:not\(:focus-within\) \.ui-node-toolbar\[data-reveal="hover"\] \{\s*transition-delay: 0\.1s;/);
  expect(css).toMatch(/\[data-node-toolbar-host\]:focus-within \.ui-node-toolbar\[data-reveal="hover"\] \{\s*opacity: 1;\s*pointer-events: auto;\s*transition-property: none;/);
});

test("BJ-228: node toolbar items are Linear's Nx: 26px circles with 14px icons, labelMuted turning labelBase", () => {
  expect(css).toMatch(/\[data-appearance="node-toolbar"\] \{\s*width: 26px;\s*min-width: 26px;\s*height: 26px;\s*padding: 6px;[^}]*border-radius: 9999px;\s*background: transparent;\s*color: var\(--fg-3\);/);
  expect(css).toMatch(/\.ui-node-toolbar \{[^}]*padding: 2px;\s*border-radius: 9999px;/);
  expect(css).toMatch(/\.ui-node-toolbar:has\(> :only-child\) \{\s*padding: 0;/);
});
