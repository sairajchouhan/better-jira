import { expect, test } from "bun:test";
import { toasts } from "@/client/components/toast-queue";
import { notifyMedia } from "./media-toast";

test("BJ-271: the same media message again replaces its toast instead of stacking a second", () => {
  toasts.dismissAll();
  const first = notifyMedia("Could not copy the image link");
  expect(notifyMedia("Could not copy the image link")).toBe(first);
  notifyMedia("Image copied");
  expect(toasts.all()).toHaveLength(2);
  toasts.dismissAll();
});
