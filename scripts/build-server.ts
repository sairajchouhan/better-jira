/** Bundles a server and the HTML it imports, with the React Compiler on: `bun scripts/build-server.ts [entry] [outdir]`.
 *  Defaults to the app server (src/index.ts → dist/app); the browser suite builds scripts/fixture-server.ts the same way.
 *  Run the output from the repo root: Bun.serve resolves the bundled HTML's files from the cwd, so they are named with
 *  `outdir` in their path rather than relative to it. */
import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";
import path from "node:path";

const [entry = "src/index.ts", out = "dist/app"] = process.argv.slice(2);
const outdir = path.relative(".", out);
await rm(outdir, { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [entry],
  outdir: ".",
  naming: {
    entry: `${outdir}/[name].[ext]`,
    chunk: `${outdir}/[name]-[hash].[ext]`,
    asset: `${outdir}/[name]-[hash].[ext]`,
  },
  publicPath: "/",
  target: "bun",
  reactCompiler: true,
  plugins: [tailwind],
  minify: process.env.BUILD_MINIFY !== "0",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
