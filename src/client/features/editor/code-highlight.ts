/**
 * The lazily loaded highlighter (code-languages.ts imports it on first use): lowlight with highlight.js grammars, each
 * fetched when a block first needs it. Linear highlights with tree-sitter where it can and lowlight otherwise; this is
 * the lowlight path only. Cypher, ReScript and Terraform have no highlight.js grammar, so they stay plain.
 */
import { createLowlight } from "lowlight";
import type { LanguageFn } from "highlight.js";
import type { Element, ElementContent, Root } from "hast";
import { codeLanguage, type CodeToken, type Highlight } from "./code-languages";

type Grammar = () => Promise<{ default: LanguageFn }>;
/** Linear's language id → its highlight.js grammar (`jLe` names hljs's own where they differ). */
const GRAMMARS: Record<string, [string, Grammar]> = {
  bash: ["bash", () => import("highlight.js/lib/languages/bash")],
  cpp: ["cpp", () => import("highlight.js/lib/languages/cpp")],
  csharp: ["csharp", () => import("highlight.js/lib/languages/csharp")],
  clojure: ["clojure", () => import("highlight.js/lib/languages/clojure")],
  dart: ["dart", () => import("highlight.js/lib/languages/dart")],
  diff: ["diff", () => import("highlight.js/lib/languages/diff")],
  elixir: ["elixir", () => import("highlight.js/lib/languages/elixir")],
  excel: ["excel", () => import("highlight.js/lib/languages/excel")],
  graphql: ["graphql", () => import("highlight.js/lib/languages/graphql")],
  golang: ["go", () => import("highlight.js/lib/languages/go")],
  haskell: ["haskell", () => import("highlight.js/lib/languages/haskell")],
  html: ["xml", () => import("highlight.js/lib/languages/xml")],
  java: ["java", () => import("highlight.js/lib/languages/java")],
  javascript: ["javascript", () => import("highlight.js/lib/languages/javascript")],
  json: ["json", () => import("highlight.js/lib/languages/json")],
  kotlin: ["kotlin", () => import("highlight.js/lib/languages/kotlin")],
  makefile: ["makefile", () => import("highlight.js/lib/languages/makefile")],
  markdown: ["markdown", () => import("highlight.js/lib/languages/markdown")],
  ocaml: ["ocaml", () => import("highlight.js/lib/languages/ocaml")],
  perl: ["perl", () => import("highlight.js/lib/languages/perl")],
  php: ["php", () => import("highlight.js/lib/languages/php")],
  protobuf: ["protobuf", () => import("highlight.js/lib/languages/protobuf")],
  python: ["python", () => import("highlight.js/lib/languages/python")],
  r: ["r", () => import("highlight.js/lib/languages/r")],
  reasonml: ["reasonml", () => import("highlight.js/lib/languages/reasonml")],
  ruby: ["ruby", () => import("highlight.js/lib/languages/ruby")],
  rust: ["rust", () => import("highlight.js/lib/languages/rust")],
  scss: ["scss", () => import("highlight.js/lib/languages/scss")],
  swift: ["swift", () => import("highlight.js/lib/languages/swift")],
  sql: ["sql", () => import("highlight.js/lib/languages/sql")],
  verilog: ["verilog", () => import("highlight.js/lib/languages/verilog")],
  toml: ["ini", () => import("highlight.js/lib/languages/ini")],
  typescript: ["typescript", () => import("highlight.js/lib/languages/typescript")],
  xml: ["xml", () => import("highlight.js/lib/languages/xml")],
  yaml: ["yaml", () => import("highlight.js/lib/languages/yaml")],
};
/** hljs scope → Linear's editor class (`E$r`); the innermost scope that has one wins (`T$r`). */
const SCOPES: Record<string, string> = {
  "hljs-meta": "syntax-meta",
  "hljs-comment": "syntax-comment",
  "hljs-quote": "syntax-markup-quote",
  "hljs-tag": "syntax-entity-name-tag",
  "hljs-name": "syntax-entity-name-tag",
  "hljs-string": "syntax-string",
  "hljs-bullet": "syntax-markup-list",
  "hljs-link": "syntax-markup-link",
  "hljs-literal": "syntax-constant-language",
  "hljs-number": "syntax-constant-numeric",
  "hljs-type": "syntax-entity-name-type",
  "hljs-deletion": "syntax-markup-deleted",
  "hljs-addition": "syntax-markup-inserted",
  "hljs-title": "syntax-entity-name-function",
  "hljs-function": "syntax-entity-name-function",
  "hljs-section": "syntax-markup-heading",
  "hljs-keyword": "syntax-keyword",
  "hljs-operator": "syntax-keyword-operator",
  "hljs-built_in": "syntax-support-function",
  "hljs-builtin-name": "syntax-support-function",
  "hljs-attr": "syntax-entity-other-attribute-name",
  "hljs-attribute": "syntax-entity-other-attribute-name",
  "hljs-property": "syntax-variable-other-property",
  "hljs-variable": "syntax-variable",
  "hljs-template-variable": "syntax-variable",
  "hljs-params": "syntax-variable-parameter",
  "hljs-subst": "syntax-variable",
  "hljs-regexp": "syntax-string-regexp",
  "hljs-selector-tag": "syntax-entity-name-tag",
  "hljs-selector-id": "syntax-entity-other-attribute-name-id",
  "hljs-selector-class": "syntax-entity-other-attribute-name-class",
};
/** Linear doesn't highlight blocks this long (`HLe`). */
const MAX_LENGTH = 1e5;

const lowlight = createLowlight(),
  pending = new Map<string, Promise<void>>();
/** Loads Linear language `id`'s grammar; true once it can highlight. */
function ready(id: string, loaded: () => void): boolean {
  const [name, grammar] = GRAMMARS[id]!;
  if (lowlight.registered(name)) return true;
  if (!pending.has(name))
    pending.set(
      name,
      grammar().then(
        (module) => {
          lowlight.register(name, module.default);
          loaded();
        },
        () => void pending.delete(name),
      ),
    );
  return false;
}

/** Flattens lowlight's tree into class ranges over the code. */
export function tokensOf(tree: Root): CodeToken[] {
  const tokens: CodeToken[] = [];
  let offset = 0;
  const walk = (node: ElementContent | Root, className?: string) => {
    if (node.type === "text") {
      if (className && node.value) {
        const last = tokens.at(-1);
        if (last?.to === offset && last.className === className) last.to += node.value.length;
        else tokens.push({ from: offset, to: offset + node.value.length, className });
      }
      offset += node.value.length;
      return;
    }
    if (node.type !== "element" && node.type !== "root") return;
    const classes = node.type === "element" ? ((node as Element).properties.className as string[] | undefined) : [];
    let inner = className;
    for (const name of classes ?? []) inner = SCOPES[name] ?? inner;
    for (const child of node.children) walk(child as ElementContent, inner);
  };
  walk(tree);
  return tokens;
}

const cache = new Map<string, CodeToken[]>(),
  detections = new Map<string, string>();
function tokensFor(text: string, id: string, loaded: () => void): CodeToken[] | undefined {
  if (!GRAMMARS[id] || text.length >= MAX_LENGTH) return [];
  if (!ready(id, loaded)) return undefined;
  const key = `${id}\n${text}`;
  let tokens = cache.get(key);
  if (!tokens) {
    tokens = tokensOf(lowlight.highlight(GRAMMARS[id][0], text, { prefix: "hljs-" }));
    // ponytail: unbounded per text; trim to recent entries if long sessions show memory growth.
    if (cache.size > 500) cache.clear();
    cache.set(key, tokens);
  }
  return tokens;
}
/** Linear guesses a language with a model; this is highlight.js's own guess over the same languages. Blank code and weak
 *  guesses read as plaintext. */
function detect(text: string, loaded: () => void): string | undefined {
  const known = detections.get(text);
  if (known) return known;
  if (!text.trim() || text.length >= MAX_LENGTH) return "plaintext";
  if (text.startsWith("diff --git a/")) return "diff";
  if (!Object.keys(GRAMMARS).map((id) => ready(id, loaded)).every(Boolean)) return undefined;
  const result = lowlight.highlightAuto(text, { subset: [...new Set(Object.values(GRAMMARS).map(([name]) => name))] }),
    name = result.data?.language,
    id =
      name && (result.data?.relevance ?? 0) >= 5
        ? (Object.entries(GRAMMARS).find(([, [grammar]]) => grammar === name)?.[0] ?? "plaintext")
        : "plaintext";
  if (detections.size > 500) detections.clear();
  detections.set(text, id);
  return id;
}

export function highlight(text: string, language: string | null, guess: boolean, loaded: () => void): Highlight | undefined {
  if (language != null) {
    const id = codeLanguage(language)?.id;
    if (!id) return { tokens: [], language };
    const tokens = tokensFor(text, id, loaded);
    return tokens && { tokens, language: id };
  }
  const id = guess ? detect(text, loaded) : detections.get(text);
  if (!id) return undefined;
  const tokens = tokensFor(text, id, loaded);
  return tokens && { tokens, language: id };
}
