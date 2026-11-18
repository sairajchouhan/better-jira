import { test as base } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import type { Op } from "../src/shared/jira-ops";

export { expect } from "@playwright/test";

/** What `POST /__fixture` reads (scripts/fixture-server.ts). Every field left out resets to its default. */
export type FixtureSettings = Partial<{
  /** Jira accepts writes; without it every op answers 405 and none is recorded. */
  writable: boolean;
  /** Jira keeps field edits, so the mirror reads them back. */
  jiraEdits: boolean;
  /** Jira keeps comments posted, edited and deleted from the app. */
  jiraComments: boolean;
  /** Jira accepts new issues. */
  createSuccess: boolean;
  /** Jira refuses ops of these kinds ("fields", "comment", "create"...) or fields ops naming these fields, with `refuseText`. */
  refuse: string[];
  refuseText: string;
  clientFailures: number;
  detailFailures: number;
  syncErrors: string[];
  syncingReads: number;
  streaming: number;
  includeMedia: boolean;
  mediaInComment: boolean;
  mediaFailure: number;
  contentFailure: number;
  unmappedMedia: boolean;
  mediaDelay: number;
  mediaVariant: string;
  threadedComments: boolean;
  distinctCreator: boolean;
  subtask: boolean;
  epics: boolean;
  crossLinks: boolean;
  bulk: number;
  bulkVariety: number;
  sharedBoards: boolean;
  history: Record<string, unknown[]>;
  historyDelay: number;
  smartLinks: boolean;
  pullRequests: boolean;
  pullRequestDelay: number;
  catalog: Partial<{ priorities: string[]; labels: string[]; users: string[] }>;
  inboxExtra: number;
  inboxExtraUnread: boolean;
  inboxRichOutside: boolean;
  inboxFail: boolean;
  inboxDelay: number;
  inboxWriteDelays: number[];
}>;

/** One write the app sent to Jira: the ops for one issue, as `GET /__fixture` lists them. */
export type JiraWrite = { key: string; ops: Op[] };

type App = {
  /** Resets the fake Jira with these settings, then opens the app. */
  seed(settings?: FixtureSettings): Promise<void>;
  /** Every write the app has sent to Jira since the last seed. */
  jiraWrites(): Promise<JiraWrite[]>;
};

/** Starts the built fixture server on `port`; resolves once this child, not another process, is listening. */
function startServer(port: number) {
  const child = spawn("bun", ["dist/fixture/fixture-server.js"], {
    // FIXTURE_EXIT_ON_EOF: the server exits when this worker's pipe closes, even if the worker is killed.
    env: { ...process.env, NODE_ENV: "production", FIXTURE_PORT: String(port), FIXTURE_EXIT_ON_EOF: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const ready = new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout!.on("data", (chunk) => {
      out += chunk;
      if (out.includes("Disposable browser fixture on")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`Fixture server on port ${port} exited with ${code}`)));
  });
  return { child, ready };
}

const stop = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill();
  });

export const test = base.extend<{ app: App }, { fixtureUrl: string }>({
  fixtureUrl: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright reads fixture dependencies from this destructuring
    async ({}, use, info) => {
      const port = Number(process.env.E2E_PORT_BASE ?? 3200) + info.parallelIndex;
      // A worker that just stopped after a failure can hold the port for a moment while its replacement starts.
      for (let attempt = 1; ; attempt++) {
        const { child, ready } = startServer(port);
        try {
          await ready;
        } catch (error) {
          await stop(child);
          if (attempt === 20) throw error;
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        await use(`http://127.0.0.1:${port}`);
        await stop(child);
        return;
      }
    },
    { scope: "worker", timeout: 60_000 },
  ],
  app: async ({ page, fixtureUrl }, use) => {
    await use({
      async seed(settings = {}) {
        const reset = await fetch(`${fixtureUrl}/__fixture`, { method: "POST", body: JSON.stringify(settings) });
        if (!reset.ok) throw new Error(`Fixture reset failed: ${reset.status}`);
        await page.goto(fixtureUrl);
      },
      async jiraWrites() {
        const log = (await (await fetch(`${fixtureUrl}/__fixture`)).json()) as { writes: JiraWrite[] };
        return log.writes;
      },
    });
  },
});
