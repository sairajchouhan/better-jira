import { execFileSync } from "node:child_process";

/** Builds the fixture server the way `bun start` builds the app (React Compiler on), so every spec runs compiled code.
 *  Playwright runs this under Node, so no Bun globals. */
export default () =>
  void execFileSync(
    "bun",
    ["scripts/build-server.ts", "scripts/fixture-server.ts", "dist/fixture"],
    {
      stdio: "inherit",
    },
  );
