import { test as base } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import type {
  FixtureRequest,
  FixtureSettings,
  FixtureUpload,
  InboxPush,
  JiraChange,
  JiraWrite,
} from "../scripts/fixture-controls";

export type { FixtureSettings, JiraWrite } from "../scripts/fixture-controls";

export { expect } from "@playwright/test";

export type App = {
  /** Resets the fake Jira with these settings, then opens the app. */
  seed(settings?: FixtureSettings): Promise<void>;
  /** Every write the app has sent to Jira since the last seed (a resend shows twice). */
  jiraWrites(): Promise<JiraWrite[]>;
  /** Every API request the fake Jira answered since the last seed, except saved views, the event stream, avatars and
   *  adding or removing a board. */
  requests(): Promise<FixtureRequest[]>;
  /** Every file the app uploaded to Jira since the last seed. */
  uploads(): Promise<FixtureUpload[]>;
  /** What Jira holds for `key` now: its slim and full records, both null once deleted or never made. */
  jiraIssue(key: string): Promise<{ issue: any; full: any }>;
  /** Every issue Jira holds now. */
  jiraIssues(): Promise<any[]>;
  /** Jira refuses ops of these kinds or fields from now on (none: stops refusing), with `text`. */
  refuse(kinds: string[], text?: string): Promise<void>;
  /** The next `count` writes get no answer from Jira (503 retry); `applied`: Jira made them and only the answer was lost. */
  unanswered(count: number, options?: { applied?: boolean }): Promise<void>;
  /** Someone changes an issue in Jira, and open tabs are told. Answers the id of a comment it added. */
  changeInJira(change: JiraChange): Promise<{ commentId?: string }>;
  /** A new notification lands in Jira's bell, and open tabs are told. */
  pushInbox(notification: InboxPush): Promise<void>;
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
    /** A control endpoint's JSON answer; anything else (an unrouted path answers the app's HTML) fails the test. */
    const call = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`${fixtureUrl}${path}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
      if (!response.ok || !response.headers.get("content-type")?.includes("json"))
        throw new Error(`Fixture ${path} answered ${response.status}`);
      return response.json() as Promise<T>;
    };
    const log = () =>
      call<{ writes: JiraWrite[]; requests: FixtureRequest[]; uploads: FixtureUpload[] }>("/__fixture");
    await use({
      async seed(settings = {}) {
        await call("/__fixture", settings);
        await page.goto(fixtureUrl);
      },
      jiraWrites: async () => (await log()).writes,
      requests: async () => (await log()).requests,
      uploads: async () => (await log()).uploads,
      jiraIssue: (key) => call(`/__fixture/jira?key=${encodeURIComponent(key)}`),
      jiraIssues: async () => (await call<{ issues: any[] }>("/__fixture/jira")).issues,
      refuse: async (kinds, text) => void (await call("/__fixture/refuse", { refuse: kinds, refuseText: text })),
      unanswered: async (count, { applied } = {}) => void (await call("/__fixture/retry", { count, applied })),
      changeInJira: (change) => call("/__fixture/jira", change),
      pushInbox: async (notification) => void (await call("/__fixture/inbox", notification)),
    });
  },
});
