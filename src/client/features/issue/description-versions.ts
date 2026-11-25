/**
 * The issue's description versions, read from Jira's changelog, for Linear's description history (startup-root `Xz` "Show
 * description history" → `Kz.show` → `sJt`): a version list grouped by day (`LDt`/`BDt`), each version shown against the one
 * before it with its changes highlighted (`VRe`, "Highlight changes"). Jira's changelog holds the whole text on both sides
 * of each edit, so every version and its predecessor are known without a second request. The description revisions this app
 * kept locally (edits replaced here, refused or unsent text) join the same list, as Linear's timeline (`IDt`) merges its
 * history entries and agent checkpoints into one.
 */
import type { AdfDocument } from "@/shared/document";
import type { Issue } from "@/shared/issue-model";
import type { HistoryEntry } from "@/shared/jira-history";
import type { Actor, PropertyActivity } from "./issue-activity";
import { mergeHistory } from "./jira-history";

/** One description version: what an edit (or the issue's creation) left, and the text it replaced. A `local` version is a
 *  revision this app kept, with its document so it can be restored. */
export type DescriptionVersion = {
  id: string;
  kind: "history" | "creation" | "local";
  at?: string;
  actor?: Actor;
  text: string;
  previous?: string;
  document?: AdfDocument;
};

/** Newest first, as Linear's list (`RDt` sorts by snapshot time, latest on top). The text the first edit replaced is the
 *  issue's original description: Linear's `creation` entry ("Created by …"), at the issue's creation. */
export function descriptionVersions(
  events: readonly PropertyActivity[],
  created?: { at?: string; actor?: Actor | null },
  revisions: Issue["descriptionHistory"] = [],
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
  const local = revisions.map(
    (revision, i): DescriptionVersion => ({
      id: `local-${i}`,
      kind: "local",
      at: revision.at,
      text: revision.text,
      document: revision.document,
    }),
  );
  const time = (version: DescriptionVersion) => (version.at ? Date.parse(version.at) : -Infinity);
  return local.length ? [...versions, ...local].toSorted((a, b) => time(b) - time(a)) : versions.toReversed();
}

/** Every version of the issue's description, from its mirrored record and Jira's changelog: what the issue menu's "Show
 *  description history" opens wherever the menu is (a list row has no Activity mounted to hand its events over). */
export const issueDescriptionVersions = (issue: Issue, history: readonly HistoryEntry[]) =>
  descriptionVersions(
    mergeHistory(issue.activity ?? [], history),
    { at: issue.created, actor: issue.creator },
    issue.descriptionHistory,
  );

/** The issue's description now: the newest version read from Jira. A local revision is text this app set aside, never the
 *  current one. */
export const currentVersion = (versions: readonly DescriptionVersion[]) => versions.find((v) => v.kind !== "local");

/** Why Linear's "Restore version" is off for a version (`sJt`'s disabled reasons), or nothing when it can be restored. Jira's
 *  changelog keeps past descriptions as wiki-markup text, not documents, so only a revision this app kept restores. */
export function restoreBlocker(version: DescriptionVersion, current: DescriptionVersion | undefined): string | undefined {
  if (version === current) return "This is the current version, you cannot restore it";
  if (version.kind === "creation") return "";
  if (version.kind !== "local") return "Jira keeps past descriptions as text only, so this version can't be restored";
}

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };
/** Past this many token pairs the diff gives up, as Linear's (`RRe` budget) does, and the whole text reads as replaced. */
const DIFF_BUDGET = 4_000_000;
/** Linear's word tokens (`R8`, jsdiff's `diffWordsWithSpace`): a line break, a run of word characters, a run of other
 *  whitespace, or one other character. */
const WORD = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
const TOKEN = new RegExp(`(\\r?\\n)|[${WORD}]+|[^\\S\\n\\r]+|[^${WORD}]`, "gu");
/** Linear's merge distance (prosemirror-changeset `minUnchanged`, `Q6`): changes closer than this many unchanged characters
 *  are one change, so a rewritten run reads as one deletion and one addition, not old and new words in turn. */
const minUnchanged = (a: number, b: number) => Math.min(15, Math.max(2, Math.floor(Math.max(a, b) / 10)));

/** A word diff of `before` → `after`: Linear's inline changes (`inline-change-addition` / `inline-change-deletion`), on Jira's
 *  wiki-markup text. Line breaks are tokens of their own, so they survive. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(TOKEN) ?? [],
    b = after.match(TOKEN) ?? [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end),
    y = b.slice(start, b.length - end);
  // The middle as unchanged runs and changes, each change its removed and added text.
  type Change = { removed: string; added: string };
  type Chunk = { same: string } | Change;
  const isChange = (chunk: Chunk | undefined): chunk is Change => !!chunk && !("same" in chunk);
  const chunks: Chunk[] = [];
  const put = (kind: DiffPart["kind"], text: string) => {
    const last = chunks.at(-1);
    if (kind === "same") {
      if (last && !isChange(last)) last.same += text;
      else chunks.push({ same: text });
    } else if (isChange(last)) last[kind] += text;
    else chunks.push({ removed: "", added: "", [kind]: text });
  };
  if (x.length * y.length > DIFF_BUDGET) {
    put("removed", x.join(""));
    put("added", y.join(""));
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
        put("same", x[i]!);
        i++;
        j++;
      } else if (i < x.length && (j === y.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!))
        put("removed", x[i++]!);
      else put("added", y[j++]!);
    }
  }
  // Fold short unchanged runs between two changes into one change (Linear's `e8` merge). A line break stays a boundary:
  // Linear diffs each paragraph as its own node, so a change never runs across one.
  const gap = minUnchanged(x.join("").length, y.join("").length);
  const merged: Chunk[] = [];
  for (let k = 0; k < chunks.length; k++) {
    const chunk = chunks[k]!,
      last = merged.at(-1),
      next = chunks[k + 1];
    if (!isChange(chunk) && isChange(last) && isChange(next) && chunk.same.length < gap && !chunk.same.includes("\n")) {
      last.removed += chunk.same + next.removed;
      last.added += chunk.same + next.added;
      k++;
    } else merged.push({ ...chunk });
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  push("same", a.slice(0, start).join(""));
  // A replacement reads old, then new, as Linear's deletion sits before its addition.
  for (const chunk of merged)
    if (!isChange(chunk)) push("same", chunk.same);
    else {
      push("removed", chunk.removed);
      push("added", chunk.added);
    }
  push("same", a.slice(a.length - end).join(""));
  return slideToLines(parts);
}

/** How well a change edge sits between `before` and `after` tokens: at a line start or end best, then at a space. */
const edge = (before: string | undefined, after: string | undefined) =>
  before === undefined || after === undefined || before.endsWith("\n") || after.startsWith("\n")
    ? 2
    : /^\s/.test(after) || /\s$/.test(before)
      ? 1
      : 0;

/**
 * Slides each pure insertion or deletion along the unchanged text around it to the place whose edges sit best, so added lines
 * read as whole lines. The diff alone keeps a shared leading token in the unchanged prefix: inserting `!b!⏎⏎` before `!c!`
 * marks `b!⏎⏎!` with the first `!` outside. Linear never shows that: its diff (`calculateDiff`, prosemirror-recreate-transform
 * with `wordDiffs`) compares paragraphs as nodes first, so an inserted paragraph is marked whole.
 */
function slideToLines(parts: DiffPart[]): DiffPart[] {
  const out = parts.map((part) => ({ ...part }));
  for (let k = 0; k < out.length; k++) {
    const part = out[k]!,
      prev = out[k - 1],
      next = out[k + 1];
    if (part.kind === "same" || (prev && prev.kind !== "same") || (next && next.kind !== "same")) continue;
    let left: string[] = prev?.text.match(TOKEN) ?? [],
      change: string[] = part.text.match(TOKEN) ?? [],
      right: string[] = next?.text.match(TOKEN) ?? [];
    // Leftmost place first, then each place to the right; the best scoring wins, the rightmost of equals.
    while (left.length && left.at(-1) === change.at(-1)) {
      change = [left.at(-1)!, ...change.slice(0, -1)];
      right = [left.at(-1)!, ...right];
      left = left.slice(0, -1);
    }
    let best = { score: -1, left, change, right };
    for (;;) {
      const score = edge(left.at(-1), change[0]) + edge(change.at(-1), right[0]);
      if (score >= best.score) best = { score, left, change, right };
      if (!right.length || right[0] !== change[0]) break;
      left = [...left, change[0]!];
      change = [...change.slice(1), right[0]!];
      right = right.slice(1);
    }
    if (prev) prev.text = best.left.join("");
    part.text = best.change.join("");
    if (next) next.text = best.right.join("");
  }
  return out.filter((part) => part.text);
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
