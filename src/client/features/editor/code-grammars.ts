/**
 * The highlighter and its grammars, as loadables the idle walk fetches last. Linear bundles lowlight's grammars into its
 * start-up code (startup-root `jLe`), so every grammar is there before a code block shows; ours are 34 small chunks,
 * fetched after everything else. Kept out of code-highlight.ts so they are registered before it has loaded.
 */
import type { LanguageFn } from "highlight.js";
import { loadable, type Loadable } from "@/client/lib/loadable";

/** lowlight and the scope table (code-highlight.ts). */
export const highlighterChunk = loadable("code-highlight", () => import("./code-highlight"), "last");

const grammar = (name: string, load: () => Promise<{ default: LanguageFn }>): [string, Loadable<{ default: LanguageFn }>] => [
  name,
  loadable(`grammar:${name}`, load, "last"),
];
const xmlGrammar = grammar("xml", () => import("highlight.js/lib/languages/xml"));
/** Linear's language id → its highlight.js grammar (`jLe` names hljs's own where they differ). One loadable per file. */
export const GRAMMARS: Record<string, [string, Loadable<{ default: LanguageFn }>]> = {
  bash: grammar("bash", () => import("highlight.js/lib/languages/bash")),
  cpp: grammar("cpp", () => import("highlight.js/lib/languages/cpp")),
  csharp: grammar("csharp", () => import("highlight.js/lib/languages/csharp")),
  clojure: grammar("clojure", () => import("highlight.js/lib/languages/clojure")),
  dart: grammar("dart", () => import("highlight.js/lib/languages/dart")),
  diff: grammar("diff", () => import("highlight.js/lib/languages/diff")),
  elixir: grammar("elixir", () => import("highlight.js/lib/languages/elixir")),
  excel: grammar("excel", () => import("highlight.js/lib/languages/excel")),
  graphql: grammar("graphql", () => import("highlight.js/lib/languages/graphql")),
  golang: grammar("go", () => import("highlight.js/lib/languages/go")),
  haskell: grammar("haskell", () => import("highlight.js/lib/languages/haskell")),
  html: xmlGrammar,
  java: grammar("java", () => import("highlight.js/lib/languages/java")),
  javascript: grammar("javascript", () => import("highlight.js/lib/languages/javascript")),
  json: grammar("json", () => import("highlight.js/lib/languages/json")),
  kotlin: grammar("kotlin", () => import("highlight.js/lib/languages/kotlin")),
  makefile: grammar("makefile", () => import("highlight.js/lib/languages/makefile")),
  markdown: grammar("markdown", () => import("highlight.js/lib/languages/markdown")),
  ocaml: grammar("ocaml", () => import("highlight.js/lib/languages/ocaml")),
  perl: grammar("perl", () => import("highlight.js/lib/languages/perl")),
  php: grammar("php", () => import("highlight.js/lib/languages/php")),
  protobuf: grammar("protobuf", () => import("highlight.js/lib/languages/protobuf")),
  python: grammar("python", () => import("highlight.js/lib/languages/python")),
  r: grammar("r", () => import("highlight.js/lib/languages/r")),
  reasonml: grammar("reasonml", () => import("highlight.js/lib/languages/reasonml")),
  ruby: grammar("ruby", () => import("highlight.js/lib/languages/ruby")),
  rust: grammar("rust", () => import("highlight.js/lib/languages/rust")),
  scss: grammar("scss", () => import("highlight.js/lib/languages/scss")),
  swift: grammar("swift", () => import("highlight.js/lib/languages/swift")),
  sql: grammar("sql", () => import("highlight.js/lib/languages/sql")),
  verilog: grammar("verilog", () => import("highlight.js/lib/languages/verilog")),
  toml: grammar("ini", () => import("highlight.js/lib/languages/ini")),
  typescript: grammar("typescript", () => import("highlight.js/lib/languages/typescript")),
  xml: xmlGrammar,
  yaml: grammar("yaml", () => import("highlight.js/lib/languages/yaml")),
};
