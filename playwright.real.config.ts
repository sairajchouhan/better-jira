import { defineConfig } from "@playwright/test";

/** User journeys against a real personal sandbox Jira (`bun run test:real`). It builds this checkout and runs it on
 *  the personal instance on its own port and cache (scripts/personal-jira.ts serve), and each test reads Jira back over REST
 *  and puts back what it changed (e2e-real/jira.ts). One test at a time: they share a Jira. */
export const PORT = 3052;

export default defineConfig({
  testDir: "e2e-real",
  testMatch: "*.real.ts",
  globalSetup: "./e2e-real/global-setup.ts",
  outputDir: "test-results-real",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `rm -f dist/real-jira-cache.db* && bun scripts/personal-jira.ts serve ${PORT} dist/real-jira-cache.db dist/real-jira`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
