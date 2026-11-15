/**
 * Code block languages and the lazy highlighter behind them, shared by the editor and the read-only view.
 * The table is Linear's (`XMe.all` in startup-root.CnUSfl4j.js): id, aliases, picker name and comment syntax. The ADF
 * codeBlock `language` stores the id; any alias (Jira's "go", "js", "py"…) resolves to its entry.
 */
import { highlighterChunk } from "./code-grammars";
export type CodeLanguage = {
  id: string;
  aliases: string[];
  name: string;
  comment?: { line: string } | { block: { start: string; end: string } };
};
const line = (line: string) => ({ line }),
  block = (start: string, end: string) => ({ block: { start, end } });
export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "bash", aliases: ["bash"], name: "Bash", comment: line("#") },
  { id: "cpp", aliases: ["cpp"], name: "C++", comment: line("//") },
  { id: "csharp", aliases: ["cs", "csharp"], name: "C#", comment: line("//") },
  { id: "clojure", aliases: ["clj", "clojure"], name: "Clojure", comment: line(";;") },
  { id: "cypher", aliases: ["cypher", "cql", "neo4j"], name: "Cypher", comment: line("//") },
  { id: "dart", aliases: ["dart"], name: "Dart", comment: line("//") },
  { id: "diff", aliases: ["diff"], name: "Diff" },
  { id: "elixir", aliases: ["elixir"], name: "Elixir", comment: line("#") },
  { id: "excel", aliases: ["excel", "xls", "xlsx"], name: "Excel" },
  { id: "graphql", aliases: ["graphql", "gql"], name: "GraphQL", comment: line("#") },
  { id: "golang", aliases: ["go", "golang"], name: "Golang", comment: line("//") },
  { id: "haskell", aliases: ["hs", "haskell"], name: "Haskell", comment: line("--") },
  { id: "html", aliases: ["html"], name: "HTML", comment: block("<!--", "-->") },
  { id: "java", aliases: ["java"], name: "Java", comment: line("//") },
  { id: "javascript", aliases: ["js", "jsx", "javascript"], name: "JavaScript", comment: line("//") },
  { id: "json", aliases: ["json"], name: "JSON" },
  { id: "kotlin", aliases: ["kt", "kotlin"], name: "Kotlin", comment: line("//") },
  { id: "makefile", aliases: ["makefile"], name: "Makefile", comment: line("#") },
  { id: "markdown", aliases: ["md", "markdown"], name: "Markdown" },
  { id: "ocaml", aliases: ["ocaml"], name: "OCaml", comment: block("(*", "*)") },
  { id: "perl", aliases: ["pl", "perl"], name: "Perl", comment: line("#") },
  { id: "php", aliases: ["php"], name: "PHP", comment: line("//") },
  { id: "plaintext", aliases: ["plaintext", "txt", "text"], name: "Plaintext" },
  { id: "protobuf", aliases: ["protobuf", "proto"], name: "Protocol Buffers", comment: line("//") },
  { id: "python", aliases: ["py", "python"], name: "Python", comment: line("#") },
  { id: "r", aliases: ["r"], name: "R", comment: line("#") },
  { id: "reasonml", aliases: ["re"], name: "ReasonML", comment: line("//") },
  { id: "rescript", aliases: ["res", "resi"], name: "ReScript", comment: line("//") },
  { id: "ruby", aliases: ["ruby", "rb"], name: "Ruby", comment: line("#") },
  { id: "rust", aliases: ["rs", "rust"], name: "Rust", comment: line("//") },
  { id: "scss", aliases: ["css", "scss"], name: "CSS", comment: block("/*", "*/") },
  { id: "swift", aliases: ["swift"], name: "Swift", comment: line("//") },
  { id: "sql", aliases: ["sql"], name: "SQL", comment: line("--") },
  { id: "verilog", aliases: ["verilog", "systemverilog", "sv", "svh", "v"], name: "SystemVerilog", comment: line("//") },
  { id: "terraform", aliases: ["terraform", "tf", "hcl"], name: "Terraform", comment: line("#") },
  { id: "toml", aliases: ["toml", "ini"], name: "TOML", comment: line("#") },
  { id: "typescript", aliases: ["typescript", "ts", "tsx"], name: "TypeScript", comment: line("//") },
  { id: "xml", aliases: ["xml"], name: "XML", comment: block("<!--", "-->") },
  { id: "yaml", aliases: ["yaml", "yml"], name: "YAML", comment: line("#") },
];
/** Linear's `zb.resolveLanguageId`: the entry whose id or alias the stored language names, ignoring case. */
export const codeLanguage = (language: unknown) => {
  const name = typeof language === "string" ? language.trim().toLowerCase() : "";
  return name ? CODE_LANGUAGES.find((l) => l.id === name || l.aliases.includes(name)) : undefined;
};
/** The language button's text (Linear's `R0e`): the stored or detected language's name, "Plaintext" for one it
 *  doesn't know, "Detecting…" while auto-detect runs. */
export function languageLabel(stored: string | null, detected: string | null | undefined) {
  if (stored != null) return codeLanguage(stored)?.name ?? "Plaintext";
  return detected === undefined ? "Detecting…" : (codeLanguage(detected)?.name ?? "Plaintext");
}

/** Linear's `zb.COLLAPSE_THRESHOLD_LOC` and `COLLAPSED_VISIBLE_LOC`: a block of 30 lines or more loads collapsed to 15. */
export const COLLAPSE_LINES = 30,
  COLLAPSED_LINES = 15;
/** Each line's start offset in the code (Linear's `zb.lineStarts`). */
export function lineStarts(text: string) {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
}

/** A highlighted span: offsets into the code and Linear's `syntax-*` class. */
export type CodeToken = { from: number; to: number; className: string };
export type Highlight = { tokens: CodeToken[]; language: string | null };
let waiting: Promise<unknown> | undefined;
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const listener of listeners) listener();
};
/** Highlighting arrives later than the text: lowlight and each grammar load on first use (Linear's lowlight fallback). */
export const onHighlighter = (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener));
export const highlighterVersion = () => version;
/**
 * The code's tokens, or undefined until its grammar has loaded (a listener then hears about it). A null language is
 * auto-detected; `detect` false keeps the last guess instead of guessing again while the code is being typed.
 */
export function highlightCode(text: string, language: string | null, detect = true): Highlight | undefined {
  const highlighter = highlighterChunk.loaded();
  if (!highlighter) {
    // A failed fetch is forgotten, so the next block asks again.
    waiting ??= highlighterChunk.load().then(changed, () => (waiting = undefined));
    return undefined;
  }
  return highlighter.highlight(text, language, detect, changed);
}
