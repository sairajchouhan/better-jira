/**
 * Compiles better-jira (CLI + server + bundled React/Tailwind web app) into a single self-contained native executable.
 * Usage:
 *   bun scripts/build-binary.ts [--target bun-darwin-arm64] [--out dist/bin/better-jira]
 */
import tailwind from "bun-plugin-tailwind";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";

type CompileTarget = Exclude<Bun.BuildConfig["compile"], boolean | string | undefined>["target"];

let target: CompileTarget | undefined;
let outfile = "dist/bin/better-jira";

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--target" && args[i + 1]) target = args[++i] as CompileTarget;
  else if (arg.startsWith("--target=")) target = arg.slice("--target=".length) as CompileTarget;
  else if (arg === "--out" && args[i + 1]) outfile = args[++i]!;
  else if (arg.startsWith("--out=")) outfile = arg.slice("--out=".length);
}

mkdirSync(path.dirname(outfile), { recursive: true });

const t0 = Date.now();
const result = await Bun.build({
  entrypoints: ["src/cli/index.ts"],
  compile: target ? { target, outfile } : { outfile },
  plugins: [tailwind],
  reactCompiler: true,
  minify: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const bytes = statSync(outfile).size;
console.log(
  `Built ${outfile} (${(bytes / 1024 / 1024).toFixed(1)} MB)${target ? ` for ${target}` : ""} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
);
