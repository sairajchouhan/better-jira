import { defineConfig } from "@playwright/test";

/** User journeys against the fixture server: `bun run test:e2e`. Each worker runs its own server (e2e/app.ts). */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  retries: 0,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
});
