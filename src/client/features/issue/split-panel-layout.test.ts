import { afterEach, expect, test } from "bun:test";
import { readSplitPanelWidth, splitPanelLayout, writeSplitPanelWidth } from "./split-panel-layout";

test("the panel keeps Linear's 480px minimum and leaves the board 640px", () => {
  expect(splitPanelLayout(1600, 760)).toEqual({ fillsPage: false, width: 760, min: 480, max: 960 });
  expect(splitPanelLayout(1600, 300).width).toBe(480);
  expect(splitPanelLayout(1600, 2000).width).toBe(960);
  // A narrower window narrows the panel without touching the saved width.
  expect(splitPanelLayout(1187, 760).width).toBe(547);
});

test("under 480 + 640 the panel covers the page", () => {
  expect(splitPanelLayout(1120, 760).fillsPage).toBe(false);
  expect(splitPanelLayout(1119, 760)).toEqual({ fillsPage: true, width: 1119, min: 480, max: 480 });
});

const stores = ["sessionStorage", "localStorage"] as const;
const previous = stores.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
const memory = () => {
  const items = new Map<string, string>();
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
};
afterEach(() =>
  stores.forEach((name, i) => {
    if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
    else delete (globalThis as any)[name];
  }),
);

test("the width is a browser-session setting: this tab's value first, else the last one any tab saved, else 760", () => {
  const session = memory(),
    local = memory();
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  Object.defineProperty(globalThis, "localStorage", { value: local, configurable: true });
  expect(readSplitPanelWidth()).toBe(760);
  writeSplitPanelWidth(612);
  expect(readSplitPanelWidth()).toBe(612);
  // A new tab (empty session) starts from the last saved width.
  Object.defineProperty(globalThis, "sessionStorage", { value: memory(), configurable: true });
  expect(readSplitPanelWidth()).toBe(612);
  // Another tab saving later does not move this tab's own width.
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  local.setItem("better-jira:boardSplitPanelWidth", "700");
  expect(readSplitPanelWidth()).toBe(612);
});
