/**
 * The issue's description versions, read from Jira's changelog, for Linear's description history (startup-root `Xz` "Show
 * description history" → `Kz.show` → `sJt`): a version list grouped by day (`LDt`/`BDt`), each version shown against the one
 * before it with its changes highlighted (`VRe`, "Highlight changes"). Jira's changelog holds the whole text on both sides
 * of each edit, so every version and its predecessor are known without a second request.
 */
import type { Actor, PropertyActivity } from "./issue-activity";

/** One description version: what an edit (or the issue's creation) left, and the text it replaced. */
export type DescriptionVersion = {
  id: string;
  kind: "history" | "creation";
  at?: string;
  actor?: Actor;
  text: string;
  previous?: string;
};

/** Newest first, as Linear's list (`RDt` sorts by snapshot time, latest on top). The text the first edit replaced is the
 *  issue's original description: Linear's `creation` entry ("Created by …"), at the issue's creation. */
export function descriptionVersions(
  events: readonly PropertyActivity[],
  created?: { at?: string; actor?: Actor | null },
): DescriptionVersion[] {
  const edits = events
    .filter((event) => event.field === "description")
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const versions: DescriptionVersion[] = edits.map((event) => ({
    id: event.id,
    kind: "history",
    at: event.at,
    actor: event.actor,
    text: text(event.after),
    previous: text(event.before),
  }));
  const first = edits[0];
  if (first && text(first.before))
    versions.unshift({
      id: "creation",
      kind: "creation",
      at: created?.at,
      actor: created?.actor ?? undefined,
      text: text(first.before),
    });
  return versions.toReversed();
}

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };
/** Past this many token pairs the diff gives up, as Linear's (`RRe` budget) does, and the whole text reads as replaced. */
const DIFF_BUDGET = 4_000_000;

/** A word diff of `before` → `after`: Linear's inline changes (`inline-change-addition` / `inline-change-deletion`), on Jira's
 *  wiki-markup text. Whitespace runs are tokens of their own, so line breaks survive. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/).filter(Boolean),
    b = after.split(/(\s+)/).filter(Boolean);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end);
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  for (const token of a.slice(0, start)) push("same", token);
  if (x.length * y.length > DIFF_BUDGET) {
    for (const token of x) push("removed", token);
    for (const token of y) push("added", token);
  } else {
    // Longest common subsequence, filled from the end so the walk below reads forward.
    const width = y.length + 1;
    const table = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--)
        table[i * width + j] =
          x[i] === y[j]
            ? table[(i + 1) * width + j + 1]! + 1
            : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    let i = 0,
      j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        push("same", x[i]!);
        i++;
        j++;
      } else if (i < x.length && (j === y.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) {
        // A replacement reads old, then new, as Linear's deletion sits before its addition.
        push("removed", x[i++]!);
      } else push("added", y[j++]!);
    }
  }
  for (const token of a.slice(a.length - end)) push("same", token);
  return parts;
}

/** Linear's day buckets for the version list (`BDt`): Today, Yesterday, then "N days/weeks/months/years ago". */
export function versionBucket(iso: string, now = new Date()): string {
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const from = day(new Date(iso)),
    to = day(now);
  const days = Math.round((+to - +from) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  let months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  if (to.getDate() < from.getDate()) months--;
  const count = (unit: string, n: number) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (months >= 12) return count("year", Math.floor(months / 12));
  if (months >= 1) return count("month", months);
  if (days >= 7) return count("week", Math.floor(days / 7));
  return count("day", days);
}
