/**
 * Runs every issue description a running copy of the app holds through the editor, read-only, and lists what the editor gets
 * wrong: a node it supports shown as a preserved placeholder, and a description a save would change. Two documents Jira reads
 * the same (keys in another order, an empty `attrs`, plain text split across nodes) count as the same.
 *   bun scripts/scan-documents.ts [port]   (default 3000)
 * Prints issue keys and node types only, never their text.
 */
import { fromEditorDocument, toEditorDocument } from "@/client/features/editor/rich-document";
import { EDITOR_NODES } from "@/client/features/editor/editor-shape";

type Adf = { type: string; attrs?: Record<string, unknown>; content?: Adf[]; [key: string]: unknown };

const port = process.argv[2] ?? "3000";
const keys: string[] = (await (await fetch(`http://localhost:${port}/api/issues`)).json()).map((i: { key: string }) => i.key);
/** Each issue's Jira document, eight reads at a time; an issue the server can't read is counted, not scanned. */
const descriptions = new Map<string, unknown>();
let unread = 0;
for (let i = 0; i < keys.length; i += 8)
  await Promise.all(
    keys.slice(i, i + 8).map(async (key) => {
      const response = await fetch(`http://localhost:${port}/api/issues/${key}`);
      if (!response.ok) return void unread++;
      descriptions.set(key, (await response.json()).fields?.description);
    }),
  );

/** Where a group's examples are kept: the first few issue keys. */
const tally = new Map<string, string[]>();
const note = (finding: string, key: string) => {
  const keys = tally.get(finding) ?? [];
  if (!keys.includes(key)) keys.push(key);
  tally.set(finding, keys);
};
/** A node's children as types, so "listItem(mediaSingle paragraph)" names the shape the schema refused. */
const shape = (node: Adf) => `${node.type}(${(node.content ?? []).map((c) => c.type).join(" ")})`;

/** A document as Jira reads it: keys sorted, no empty `attrs`, neighbouring text with the same marks joined. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const joined: unknown[] = [];
    for (const item of value.map(canonical) as Adf[]) {
      const last = joined.at(-1) as Adf | undefined;
      if (item?.type === "text" && last?.type === "text" && JSON.stringify(last.marks) === JSON.stringify(item.marks))
        joined[joined.length - 1] = { ...last, text: `${last.text}${item.text}` };
      else joined.push(item);
    }
    return joined;
  }
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value).filter(([k, v]) => !(k === "attrs" && v && typeof v === "object" && !Object.keys(v).length));
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
}
/** The first place two canonical documents differ, as a path of node types and the field that differs. */
function firstDifference(a: unknown, b: unknown, path: string): string | undefined {
  if (JSON.stringify(a) === JSON.stringify(b)) return undefined;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return `${path}: ${JSON.stringify(a)?.slice(0, 60)} → ${JSON.stringify(b)?.slice(0, 60)}`;
  const at = (a as Adf).type ? `${path}/${(a as Adf).type}` : path;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = firstDifference((a as any)[k], (b as any)[k], k === "content" || /^\d+$/.test(k) ? at : `${at}.${k}`);
    if (d) return d;
  }
  return at;
}
/** Text and media ids out of reach: a round trip names only the node path and field, not what it holds. */
const redact = (difference: string) => difference.replace(/: .*/, "");

let documents = 0;
for (const [key, description] of descriptions) {
  if (!description || typeof description !== "object") continue;
  documents++;
  const editor = toEditorDocument(description);
  editor.descendants((node) => {
    if (node.type.name !== "opaqueBlock" && node.type.name !== "opaqueInline") return;
    const raw = node.attrs.raw as Adf;
    if (EDITOR_NODES.has(raw.type)) note(`placeholder ${shape(raw)}`, key);
  });
  const back = fromEditorDocument(editor);
  const difference = firstDifference(canonical(description), canonical(back), "");
  if (difference) note(`round trip ${redact(difference)}`, key);
}

console.log(`${keys.length} issues, ${documents} descriptions read from :${port}${unread ? `, ${unread} issues unreadable` : ""}`);
if (!tally.size) console.log("Every description shows and saves back as Jira holds it.");
for (const [finding, keys] of [...tally].sort((a, b) => b[1].length - a[1].length))
  console.log(`${String(keys.length).padStart(5)}  ${finding}   e.g. ${keys.slice(0, 3).join(", ")}`);
process.exit(tally.size ? 1 : 0);
