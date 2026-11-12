import { expect, test } from "bun:test";
import { readStored, writeStored } from "./stored-state";

test("stored state round-trips JSON, removes on undefined and falls back on bad data", () => {
  const data = new Map<string, string>();
  globalThis.localStorage ??= {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as Storage;
  const parse = (raw: unknown) => {
    if (typeof raw !== "number") throw new Error("not a number");
    return raw;
  };
  expect(readStored("t:n", parse, 0)).toBe(0);
  expect(writeStored("t:n", 3)).toBe(true);
  expect(readStored("t:n", parse, 0)).toBe(3);
  localStorage.setItem("t:n", '"x"');
  expect(readStored("t:n", parse, 0)).toBe(0);
  localStorage.setItem("t:n", "{");
  expect(readStored("t:n", parse, 0)).toBe(0);
  writeStored("t:n", undefined);
  expect(localStorage.getItem("t:n")).toBeNull();
});
