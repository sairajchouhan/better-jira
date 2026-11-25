import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultCacheRoot, defaultConfigRoot, loadCredentialsEnv, parseEnvText, resolveInstancePaths } from "./env";
import { parseCliArgs } from "./index";

describe("CLI env & instance paths", () => {
  test("splits config (~/.config/better-jira) and cache (~/.cache/better-jira) with credentials.env", () => {
    const configRoot = defaultConfigRoot("/Users/alice", {});
    const cacheRoot = defaultCacheRoot("/Users/alice", {});
    expect(configRoot).toBe("/Users/alice/.config/better-jira");
    expect(cacheRoot).toBe("/Users/alice/.cache/better-jira");

    const paths = resolveInstancePaths({ configRoot, cacheRoot, env: {} });
    expect(paths.instance).toBe("default");
    expect(paths.instanceDir).toBe("/Users/alice/.config/better-jira/instances/default");
    expect(paths.cacheDir).toBe("/Users/alice/.cache/better-jira/instances/default");
    expect(paths.credentialsFile).toBe("/Users/alice/.config/better-jira/instances/default/credentials.env");
    expect(paths.cacheFile).toBe("/Users/alice/.cache/better-jira/instances/default/cache.db");
    expect(paths.tripsFile).toBe("/Users/alice/.cache/better-jira/instances/default/trips.jsonl");

    // Explicit --home keeps config and cache together in that folder.
    const explicit = resolveInstancePaths({ home: "/tmp/bj-test", env: {} });
    expect(explicit.instanceDir).toBe("/tmp/bj-test");
    expect(explicit.cacheDir).toBe("/tmp/bj-test");
    expect(explicit.cacheFile).toBe("/tmp/bj-test/cache.db");
  });

  test("parseEnvText handles quotes, export prefixes, and comments", () => {
    const parsed = parseEnvText(`
      # comment
      JIRA_EMAIL="alex@team.com"
      export JIRA_TOKEN='secret-tok'
      PLAIN=hello # inline comment
    `);
    expect(parsed).toEqual({
      JIRA_EMAIL: "alex@team.com",
      JIRA_TOKEN: "secret-tok",
      PLAIN: "hello",
    });
  });

  test("loadCredentialsEnv prefers credentials.env, falls back to .env, and never overwrites shell env", () => {
    const dir = mkdtempSync(join(tmpdir(), "bj-cli-env-"));
    try {
      writeFileSync(join(dir, ".env"), 'JIRA_EMAIL="legacy@team.com"\nJIRA_TOKEN="legacy-tok"\n');
      const env1: Record<string, string | undefined> = { JIRA_EMAIL: "shell@team.com" };
      expect(loadCredentialsEnv(dir, env1)).toBe(join(dir, ".env"));
      expect(env1.JIRA_EMAIL).toBe("shell@team.com");
      expect(env1.JIRA_TOKEN).toBe("legacy-tok");

      writeFileSync(join(dir, "credentials.env"), 'JIRA_EMAIL="new@team.com"\nJIRA_TOKEN="new-tok"\n');
      const env2: Record<string, string | undefined> = {};
      expect(loadCredentialsEnv(dir, env2)).toBe(join(dir, "credentials.env"));
      expect(env2.JIRA_EMAIL).toBe("new@team.com");
      expect(env2.JIRA_TOKEN).toBe("new-tok");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI argument parsing", () => {
  test("parses default start, flags, and subcommands", () => {
    expect(parseCliArgs([])).toMatchObject({ command: "start", instance: "default", noOpen: false });
    expect(parseCliArgs(["start", "--instance", "work", "--port", "3010", "--no-open"])).toMatchObject({
      command: "start",
      instance: "work",
      port: 3010,
      noOpen: true,
    });
    expect(parseCliArgs(["status"])).toMatchObject({ command: "status" });
    expect(parseCliArgs(["open"])).toMatchObject({ command: "open" });
    expect(() => parseCliArgs(["--port", "99999"])).toThrow(/between 1 and 65535/);
    expect(() => parseCliArgs(["bogus"])).toThrow(/Unknown command/);
  });
});
