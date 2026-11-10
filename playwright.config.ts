import { defineConfig } from "@playwright/test";

/** Browser suite: `bun run test:e2e`. Each worker starts its own fixture server on port 3200 (or E2E_PORT_BASE) + its index. */
export default defineConfig({
  testDir: "e2e",
  testMatch: "*.pw.ts",
  fullyParallel: true,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 6, // measured best on an 8-core Mac; more workers contend for CPU
  timeout: 90_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? "dot" : [["list"]],
  use: {
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
});
