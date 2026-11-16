import { expect, test } from "bun:test";
import { createHoverIntent } from "./hover-intent";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const intent = () => {
  const fired: string[] = [];
  return { fired, ...createHoverIntent((key: string) => void fired.push(key), { interval: 80 }) };
};

test("Linear's hover intent waits 100ms with the pointer within 2px by default", async () => {
  const fired: string[] = [];
  const hover = createHoverIntent((key: string) => void fired.push(key));
  hover.over("A", { x: 0, y: 0 });
  await sleep(20);
  hover.over("A", { x: 1, y: 0 }); // under 2px: the wait goes on
  await sleep(20);
  expect(fired).toEqual([]);
  await sleep(200);
  expect(fired).toEqual(["A"]);
});

test("a pointer resting on a target fires it once per stay; leaving ends the stay", async () => {
  const hover = intent();
  hover.over("A", { x: 0, y: 0 });
  await sleep(150);
  hover.over("A", { x: 50, y: 0 });
  await sleep(150);
  expect(hover.fired).toEqual(["A"]);
  hover.out();
  hover.over("A", { x: 50, y: 0 });
  await sleep(150);
  expect(hover.fired).toEqual(["A", "A"]);
});

test("a sweep across targets, or a pointer still moving over one, fires nothing", async () => {
  const hover = intent();
  for (let i = 0; i < 10; i++) {
    hover.over(`T${i}`, { x: 0, y: i * 40 });
    await sleep(5);
  }
  hover.out();
  for (let i = 0; i < 8; i++) {
    hover.over("M", { x: i * 5, y: 0 });
    await sleep(5);
  }
  expect(hover.fired).toEqual([]);
  hover.out();
  await sleep(150);
  expect(hover.fired).toEqual([]);
});
