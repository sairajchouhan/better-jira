import { execFileSync } from "node:child_process";

/** Builds the fixture server once per run, the way `bun start` builds the app. Playwright runs this under Node. */
export default () =>
  void execFileSync("bun", ["scripts/build-server.ts", "scripts/fixture-server.ts", "dist/fixture"], {
    stdio: "inherit",
  });
