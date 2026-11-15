import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { compareNatural, compareText } from "./compare";

// Keys, names and timestamps shaped like the ones sorted in the app: digits, case, accents, empties and the "~" fallback.
const SAMPLES = [
  "PROJ-9", "PROJ-10", "PROJ-100", "proj-2", "ABC-1", "ABC-01", "abc-1", "Zed", "zed", "Émile", "Emile", "emile", "Ölaf",
  "Oscar", "ångström", "Angstrom", "", "~", " ", "Item 2", "Item 10", "item 1", "a-b", "a_b", "a b", "ab", "Ab", "aB",
  "2026-11-15T09:30:00.000+0530", "2026-11-15T09:30:00.000Z", "2026-11-15T10:00:00.000+0000", "2026-02-01", "2026-10-01",
  "naïve", "naive", "résumé", "resume", "Δelta", "delta", "1", "01", "001", "10", "9",
];

test("compareText orders exactly as localeCompare with no options", () => {
  for (const a of SAMPLES)
    for (const b of SAMPLES) expect(Math.sign(compareText(a, b))).toBe(Math.sign(a.localeCompare(b)));
  expect(SAMPLES.toSorted(compareText)).toEqual(SAMPLES.toSorted((a, b) => a.localeCompare(b)));
});

test("compareNatural orders exactly as localeCompare with numeric: true", () => {
  for (const a of SAMPLES)
    for (const b of SAMPLES)
      expect(Math.sign(compareNatural(a, b))).toBe(Math.sign(a.localeCompare(b, undefined, { numeric: true })));
  expect(["PROJ-10", "PROJ-9", "PROJ-100", "PROJ-1"].toSorted(compareNatural)).toEqual(["PROJ-1", "PROJ-9", "PROJ-10", "PROJ-100"]);
  // Plain text order is not natural: the two must stay distinct.
  expect(["PROJ-10", "PROJ-9"].toSorted(compareText)).toEqual(["PROJ-10", "PROJ-9"]);
});

test("compare is usable unbound, as a sort callback", () => {
  const { compare } = { compare: compareNatural };
  expect(["b", "a", ""].toSorted(compare)).toEqual(["", "a", "b"]);
});

test("compareNatural reuses one collator instead of building one per comparison", () => {
  const keys = Array.from({ length: 3000 }, (_, i) => `PROJ-${(i * 7919) % 3000}`);
  const time = (run: () => void) => {
    run();
    const runs = [0, 1, 2].map(() => {
      const start = performance.now();
      run();
      return performance.now() - start;
    });
    return runs.toSorted((a, b) => a - b)[1]!;
  };
  // Measured 38 ms against 6 ms in Bun (75 against 5 in V8); half leaves room for a noisy machine.
  const perCall = time(() => keys.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  expect(time(() => keys.toSorted(compareNatural))).toBeLessThan(perCall / 2);
});

test("every sort in src compares through shared/compare", () => {
  const root = path.join(import.meta.dir, "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (statSync(file).isDirectory()) walk(file);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "compare.ts")
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => /\.localeCompare\(/.test(line) && offenders.push(`${path.relative(root, file)}:${i + 1}`));
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
