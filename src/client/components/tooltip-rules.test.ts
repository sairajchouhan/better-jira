import { expect, test } from "bun:test";
import {
  CARD_FALLBACKS,
  choosePlacement,
  closeOnEscape,
  createTooltipStore,
  keepsCardOpen,
  safeArea,
  TOOLTIP_TIMING,
  tooltipFallbacks,
  type Schedule,
} from "./tooltip-rules";

/** A clock the test moves by hand: `schedule` queues, `advance(ms)` runs what came due. */
function fakeClock() {
  let now = 0;
  const tasks: { at: number; run: () => void; live: boolean }[] = [];
  const schedule: Schedule = (run, ms) => {
    const task = { at: now + ms, run, live: true };
    tasks.push(task);
    return () => void (task.live = false);
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = tasks.filter((task) => task.live && task.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now = next.at;
      next.live = false;
      next.run();
    }
    now = end;
  };
  return { schedule, advance };
}

const setup = () => {
  const clock = fakeClock();
  return { ...clock, store: createTooltipStore(clock.schedule) };
};

test("a plain tooltip opens after a 450ms rest; every move starts the rest again (`Rwe`'s mousemove reschedule)", () => {
  const { store, advance } = setup();
  store.enter("a", TOOLTIP_TIMING.plain);
  advance(449);
  expect(store.openId).toBeUndefined();
  store.move("a");
  advance(449);
  expect(store.openId).toBeUndefined();
  advance(1);
  expect(store.openId).toBe("a");
});

test("a hover card waits 550ms; the edge tooltip's timer is not restarted by moves (`B_`)", () => {
  const { store, advance } = setup();
  store.enter("card", TOOLTIP_TIMING.card);
  advance(549);
  expect(store.openId).toBeUndefined();
  advance(1);
  expect(store.openId).toBe("card");
  store.leave("card");
  advance(200);
  store.enter("edge", TOOLTIP_TIMING.edge);
  advance(300);
  store.move("edge");
  advance(150);
  expect(store.openId).toBe("edge");
});

test("one open at a time; the next opens at once within 100ms of the last hiding, then waits again (`Lwe.schedule(…, 100)`)", () => {
  const { store, advance } = setup();
  store.enter("a", TOOLTIP_TIMING.plain);
  advance(450);
  store.leave("a");
  expect(store.openId).toBeUndefined();
  advance(99);
  store.enter("b", TOOLTIP_TIMING.plain);
  expect(store.openId).toBe("b");
  store.leave("b");
  advance(100);
  store.enter("c", TOOLTIP_TIMING.plain);
  expect(store.openId).toBeUndefined();
  advance(450);
  expect(store.openId).toBe("c");
  // Keyboard focus on another trigger opens it at once and closes this one.
  store.focus("d");
  expect(store.openId).toBe("d");
});

test("a press hides the tooltip until the pointer comes back (`closeOnPointerDown`)", () => {
  const { store, advance } = setup();
  store.enter("a", TOOLTIP_TIMING.plain);
  advance(450);
  store.close("a");
  expect(store.openId).toBeUndefined();
  store.move("a");
  advance(1000);
  expect(store.openId).toBeUndefined();
});

test("Escape hides the open tooltip and lets the key through, so one press also closes the panel under it", () => {
  const { store, advance } = setup();
  const calls: string[] = [];
  const event = {
    key: "Escape",
    preventDefault: () => calls.push("preventDefault"),
    stopPropagation: () => calls.push("stopPropagation"),
    stopImmediatePropagation: () => calls.push("stopImmediatePropagation"),
  };
  expect(closeOnEscape(event, store)).toBe(false);
  store.enter("card", TOOLTIP_TIMING.card);
  advance(550);
  expect(closeOnEscape({ key: "Enter" }, store)).toBe(false);
  expect(store.openId).toBe("card");
  expect(closeOnEscape(event, store)).toBe(true);
  expect(store.openId).toBeUndefined();
  expect(calls).toEqual([]);
  // It stays hidden while the pointer rests on the trigger.
  store.move("card");
  advance(1000);
  expect(store.openId).toBeUndefined();
});

test("a card stays open only while the pointer goes into it or back to its trigger (`Rwe`'s mouse-out, `Vwe`)", () => {
  expect(keepsCardOpen("card")).toBe(true);
  expect(keepsCardOpen("trigger")).toBe(true);
  expect(keepsCardOpen("elsewhere")).toBe(false);
  expect(keepsCardOpen("nothing")).toBe(false);
  expect(keepsCardOpen("nothing", 499)).toBe(true);
  expect(keepsCardOpen("nothing", 500)).toBe(false);
});

test("placement fallbacks are Linear's `Bwe`", () => {
  expect(tooltipFallbacks("bottom")).toEqual([
    "bottom-start", "bottom-end", "top", "top-start", "top-end", "right", "right-start", "right-end", "left", "left-start", "left-end",
  ]);
  expect(tooltipFallbacks("top")).toEqual([
    "top-start", "top-end", "bottom", "bottom-start", "bottom-end", "left", "left-start", "left-end", "right", "right-start", "right-end",
  ]);
  expect(tooltipFallbacks("left").slice(0, 5)).toEqual(["left-start", "left-end", "right", "right-start", "right-end"]);
  expect(CARD_FALLBACKS).toEqual(["top-start", "top", "bottom-start", "bottom"]);
});

test("the first placement that fits 12px inside the window wins, so a bottom tooltip at the right edge end-aligns before it shifts", () => {
  const viewport = { width: 1000, height: 800 };
  const floating = { width: 120, height: 28 };
  const at = (left: number, top: number) => ({ left, top, right: left + 40, bottom: top + 24 });
  const pick = (reference: ReturnType<typeof at>) =>
    choosePlacement({ placements: ["bottom", ...tooltipFallbacks("bottom")], reference, floating, viewport, offset: 8 });
  expect(pick(at(400, 100))).toBe("bottom");
  expect(pick(at(940, 100))).toBe("bottom-end");
  expect(pick(at(20, 100))).toBe("bottom-start");
  expect(pick(at(400, 750))).toBe("top");
  // A card with no room above opens below, start-aligned.
  expect(
    choosePlacement({ placements: ["top-start", ...CARD_FALLBACKS], reference: at(400, 20), floating: { width: 300, height: 120 }, viewport, offset: 0 }),
  ).toBe("bottom-start");
  // Too tall for either side: the side it spills least on (`$Ce`).
  expect(
    choosePlacement({ placements: ["bottom", "top"], reference: at(400, 300), floating: { width: 200, height: 500 }, viewport, offset: 0 }),
  ).toBe("bottom");
  // Too wide for any alignment, but room below: the side that fits, spilling least across.
  expect(
    choosePlacement({ placements: ["bottom", "bottom-start", "bottom-end"], reference: at(900, 100), floating: { width: 990, height: 28 }, viewport, offset: 8 }),
  ).toBe("bottom-end");
});

test("the card's safe area spans from the card's edge to the trigger plus 24px, 10px deep (`Jwe`/`Ywe`)", () => {
  const card = { left: 100, top: 100, right: 300, bottom: 200 };
  const below = { left: 150, top: 200, right: 190, bottom: 220 };
  expect(safeArea(card, below, "top")).toEqual({
    left: 0,
    right: 0,
    height: 10,
    bottom: -10,
    clipPath: "polygon(0 0, 100% 0, 57% 100%, 13% 100%)",
  });
  const beside = { left: 300, top: 140, right: 340, bottom: 160 };
  expect(safeArea(card, beside, "left")).toEqual({
    top: 0,
    bottom: 0,
    width: 10,
    right: -10,
    clipPath: "polygon(0 0, 100% 16%, 100% 84%, 0 100%)",
  });
});
