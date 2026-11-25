import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectJiraAccount, normalizeSiteInput, saveInstanceSetup, verifySetupBoards } from "./setup-service";

describe("normalizeSiteInput", () => {
  test("accepts bare hostnames, https origins, and pasted Jira board URLs", () => {
    expect(normalizeSiteInput("team.atlassian.net")).toBe("https://team.atlassian.net");
    expect(normalizeSiteInput("https://team.atlassian.net/")).toBe("https://team.atlassian.net");
    expect(normalizeSiteInput("https://team.atlassian.net/jira/software/projects/ENG/boards/12")).toBe(
      "https://team.atlassian.net",
    );
  });

  test("rejects http URLs and empty input", () => {
    expect(() => normalizeSiteInput("http://team.atlassian.net")).toThrow(/https/);
    expect(() => normalizeSiteInput("   ")).toThrow(/Jira Cloud site/);
  });
});

describe("connectJiraAccount", () => {
  test("validates account and returns sorted boards", async () => {
    const fakeFetch = async (url: string) => {
      if (url.endsWith("/rest/api/3/myself")) {
        return Response.json({ accountId: "acc-1", displayName: "Alex Rivera" });
      }
      if (url.includes("/rest/agile/1.0/board")) {
        return Response.json({
          isLast: true,
          values: [
            { id: 12, name: "Platform", type: "kanban", location: { projectKey: "PLAT", projectName: "Platform" } },
            { id: 4, name: "Design", type: "simple", location: { projectKey: "DES" } },
          ],
        });
      }
      return new Response("Not found", { status: 404 });
    };

    const result = await connectJiraAccount(
      { site: "team.atlassian.net", email: "alex@team.com", token: "tok-123" },
      fakeFetch,
    );
    expect(result.site).toBe("https://team.atlassian.net");
    expect(result.user).toEqual({ id: "acc-1", name: "Alex Rivera", avatar: undefined });
    expect(result.boards.map((b) => b.id)).toEqual([4, 12]);
    expect(result.partial).toBe(false);
  });

  test("distinguishes invalid token on a valid Jira site from a non-Jira host on 401", async () => {
    const jira401 = async (url: string) => {
      if (url.endsWith("/rest/api/3/myself")) return new Response("Unauthorized", { status: 401 });
      if (url.endsWith("/rest/api/3/serverInfo")) return Response.json({ baseUrl: "https://team.atlassian.net" });
      return new Response("Not found", { status: 404 });
    };
    await expect(
      connectJiraAccount({ site: "https://team.atlassian.net", email: "a@b.com", token: "bad" }, jira401),
    ).rejects.toThrow(/rejected your email and API token \(401\)/);

    const notJira401 = async () => new Response("nope", { status: 401 });
    await expect(
      connectJiraAccount({ site: "https://wrong.example.com", email: "a@b.com", token: "bad" }, notJira401),
    ).rejects.toThrow(/doesn't answer as a Jira Cloud site/);
  });
});

describe("verifySetupBoards", () => {
  test("verifies numeric IDs and board links", async () => {
    const seen: string[] = [];
    const fakeFetch = async (url: string) => {
      seen.push(new URL(url).pathname);
      return Response.json({ id: 7, name: "Eng" });
    };
    const ids = await verifySetupBoards(
      {
        site: "https://team.atlassian.net",
        email: "a@b.com",
        token: "tok",
        boards: [7, "https://team.atlassian.net/jira/software/projects/ENG/boards/9"],
      },
      fakeFetch,
    );
    expect(ids).toEqual([7, 9]);
    expect(seen).toEqual([
      "/rest/agile/1.0/board/7",
      "/rest/agile/1.0/board/7/configuration",
      "/rest/agile/1.0/board/9",
      "/rest/agile/1.0/board/9/configuration",
    ]);
  });
});

describe("saveInstanceSetup", () => {
  test("writes 0600 credentials.env for new instances and writes settings.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "better-jira-setup-test-"));
    try {
      await saveInstanceSetup(
        { email: "alex@team.com", token: "new-secret" },
        { site: "https://team.atlassian.net", boards: [7], writes: true },
        dir,
      );

      const envText = await Bun.file(join(dir, "credentials.env")).text();
      expect(envText).toContain('JIRA_EMAIL="alex@team.com"');
      expect(envText).toContain('JIRA_TOKEN="new-secret"');
      expect(statSync(join(dir, "credentials.env")).mode & 0o777).toBe(0o600);

      const settings = await Bun.file(join(dir, "settings.json")).json();
      expect(settings).toEqual({ site: "https://team.atlassian.net", boards: [7], writes: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("preserves unrelated keys in an existing legacy .env when re-saving", async () => {
    const dir = mkdtempSync(join(tmpdir(), "better-jira-setup-legacy-"));
    try {
      await Bun.write(join(dir, ".env"), 'GITHUB_TOKEN="ghp_keep"\nJIRA_TOKEN="old"\n');
      await saveInstanceSetup(
        { email: "alex@team.com", token: "new-secret" },
        { site: "https://team.atlassian.net", boards: [7], writes: true },
        dir,
      );

      const envText = await Bun.file(join(dir, ".env")).text();
      expect(envText).toContain('GITHUB_TOKEN="ghp_keep"');
      expect(envText).toContain('JIRA_EMAIL="alex@team.com"');
      expect(envText).toContain('JIRA_TOKEN="new-secret"');
      expect(envText).not.toContain("old");
      expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
