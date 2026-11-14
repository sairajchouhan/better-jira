import { expect, test } from "bun:test";
import { ignoreBenignErrors, isBenignError } from "./benign-errors";

test("R3-create-D12: the ResizeObserver loop report never reaches later error listeners; real errors do", () => {
  expect(isBenignError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
  expect(isBenignError("TypeError: x is undefined")).toBe(false);
  const target = new EventTarget() as EventTarget & Pick<Window, "addEventListener">;
  ignoreBenignErrors(target);
  const seen: string[] = [];
  target.addEventListener("error", (e) => seen.push((e as ErrorEvent).message));
  const fire = (message: string) => {
    const event = new Event("error") as Event & { message: string };
    event.message = message;
    target.dispatchEvent(event);
  };
  fire("ResizeObserver loop completed with undelivered notifications.");
  fire("TypeError: boom");
  expect(seen).toEqual(["TypeError: boom"]);
});
