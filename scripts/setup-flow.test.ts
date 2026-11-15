import { expect, test } from "bun:test";
import { runSetup, type SetupIO } from "./setup-flow";
import type { LocalSettings } from "../src/server/config";

const SITE = "https://acme-team.atlassian.net";
type Route = (path: string) => Response | Promise<Response>;
/** A made-up Jira: one account, two boards, full edit rights, unless `override` answers a path first. */
function fakeJira(override: Route = () => undefined as unknown as Response): Route {
  return (path) =>
    override(path) ??
    (path === "/rest/api/3/myself"
      ? Response.json({ accountId: "acc-1", displayName: "Ada Example" })
      : path.startsWith("/rest/agile/1.0/board?")
        ? Response.json({
            isLast: true,
            values: [
              { id: 12, name: "Payments", type: "kanban" },
              { id: 34, name: "Platform", type: "kanban" },
            ],
          })
        : /^\/rest\/agile\/1\.0\/board\/\d+$/.test(path)
          ? Response.json({ name: "Payments", type: "kanban", location: { projectKey: "PAY" } })
          : /^\/rest\/agile\/1\.0\/board\/\d+\/configuration$/.test(path)
            ? Response.json({ name: "Payments" })
            : path.startsWith("/rest/api/3/mypermissions")
              ? Response.json({
                  permissions: Object.fromEntries(
                    ["EDIT_ISSUES", "TRANSITION_ISSUES", "ADD_COMMENTS", "CREATE_ISSUES"].map((k) => [
                      k,
                      { havePermission: true },
                    ]),
                  ),
                })
              : new Response("not found", { status: 404 }));
}
function harness(route: Route, answers: string[] = [], token = "tok-123") {
  const log: string[] = [],
    saved: { credentials?: unknown; local?: LocalSettings } = {},
    asked: string[] = [];
  const io: SetupIO = {
    fetch: async (url) => route(url.slice(new URL(url).origin.length)),
    ask: async (label, existing = "") => {
      asked.push(label);
      return answers.shift() || existing;
    },
    secret: async () => token,
    log: (line) => log.push(line),
    save: async (credentials, local) => void Object.assign(saved, { credentials, local }),
  };
  return { io, log, saved, asked };
}
const run = (h: ReturnType<typeof harness>, checking = false, env = {}, local: LocalSettings = {}) =>
  runSetup(checking, env, local, h.io);

test("a fresh account: site, email, token and boards are asked, checked with reads and saved", async () => {
  const h = harness(fakeJira(), [SITE, "ada@example.invalid", "12"]);
  await run(h);
  expect(h.log).toContain("Connected to acme-team.atlassian.net as Ada Example.");
  expect(h.log.some((l) => l.includes("12") && l.includes("Payments"))).toBe(true);
  expect(h.log).toContain("Verified board 12: Payments (PAY).");
  expect(h.saved).toEqual({
    credentials: { email: "ada@example.invalid", token: "tok-123" },
    local: { site: SITE, boards: [12], writes: true },
  });
  // Setup states the mode bun start will run in for this site, as the footer does.
  expect(h.log.join("\n")).toContain('Edits go to Jira: bun start saves your changes to acme-team.atlassian.net as Ada Example, and the footer says "Edits write to Jira".');
  expect(h.log.at(-1)).toContain("Run bun start, then open http://localhost:3000.");
  expect(h.log.join("\n")).not.toMatch(/writes (are|remain) disabled|read-only/i);
});

test("answering no keeps edits local, saved for this site, and says so", async () => {
  const h = harness(fakeJira(), [SITE, "ada@example.invalid", "12", "no"]);
  await run(h);
  expect(h.saved.local).toEqual({ site: SITE, boards: [12], writes: false });
  expect(h.log.join("\n")).toContain('Edits stay local: bun start sends nothing to acme-team.atlassian.net, and the footer says "Local only".');
});

test("setup --check asks nothing, saves nothing and verifies the saved boards", async () => {
  const h = harness(fakeJira());
  await run(h, true, { JIRA_URL: SITE, JIRA_EMAIL: "ada@example.invalid", JIRA_TOKEN: "t" }, { boards: [12] });
  expect(h.asked).toEqual([]);
  expect(h.saved).toEqual({});
  expect(h.log.join("\n")).toContain("Setup is valid");
  // A settings file without setup's write answer: bun start stays local, and --check says so.
  expect(h.log.at(-1)).toContain("Edits stay local");
  const on = harness(fakeJira());
  await run(on, true, { JIRA_URL: SITE, JIRA_EMAIL: "a@example.invalid", JIRA_TOKEN: "t" }, { site: SITE, boards: [12], writes: true });
  expect(on.log.at(-1)).toContain("Edits go to Jira");
});

test("setup --check before setup says to run setup, not a config error", async () => {
  await expect(run(harness(fakeJira()), true)).rejects.toThrow("Run bun run setup first");
});

const failing = async (route: Route, answers = [SITE, "ada@example.invalid", "12"]) => {
  const h = harness(route, answers);
  const error = await run(h).then(
    () => undefined,
    (e: Error) => e,
  );
  expect(h.saved).toEqual({});
  return error?.message ?? "";
};

test("a 401 says whether the site or the email and token are wrong, and where to make a new token", async () => {
  const unauthorized = (serverInfo: Response) =>
    fakeJira((p) =>
      p === "/rest/api/3/myself"
        ? new Response("", { status: 401 })
        : p === "/rest/api/3/serverInfo"
          ? serverInfo
          : undefined!,
    );
  const credentials = await failing(unauthorized(Response.json({ baseUrl: SITE })));
  expect(credentials).toContain("acme-team.atlassian.net is a Jira site, but it rejected your email and API token (401)");
  expect(credentials).toContain("an API token, not your password");
  expect(credentials).toContain("id.atlassian.com/manage-profile/security/api-tokens");
  const wrongSite = await failing(unauthorized(new Response("", { status: 404 })));
  expect(wrongSite).toContain("doesn't answer as a Jira Cloud site. Check the site address first");
});

test("a wrong site (404, or a web page instead of the API) says to check the address", async () => {
  expect(await failing(() => new Response("nope", { status: 404 }))).toContain("has no Jira Cloud API (404)");
  expect(await failing(() => new Response("<html>login</html>", { status: 200 }))).toContain(
    "answered with a web page",
  );
});

test("no network says it can't reach the site; a stalled Jira says it didn't answer", async () => {
  expect(
    await failing(() => {
      throw new TypeError("fetch failed");
    }),
  ).toContain("Can't reach acme-team.atlassian.net");
  expect(
    await failing(() => {
      throw new DOMException("timed out", "TimeoutError");
    }),
  ).toContain("didn't answer in time");
});

test("an account that sees no boards is told to ask for access", async () => {
  const message = await failing(
    fakeJira((p) => (p.startsWith("/rest/agile/1.0/board?") ? Response.json({ isLast: true, values: [] }) : undefined!)),
  );
  expect(message).toContain("can't see any boards");
});

test("a board the account can't read names that board", async () => {
  const message = await failing(
    fakeJira((p) => (p.startsWith("/rest/agile/1.0/board/34") ? new Response("", { status: 403 }) : undefined!)),
    [SITE, "ada@example.invalid", "12,34"],
  );
  expect(message).toContain("can't read board 34 (403)");
});

test("a bad site or board answer is asked again, saying why", async () => {
  const h = harness(fakeJira(), ["http://acme.example", SITE, "ada@example.invalid", "https://other.atlassian.net/jira/boards/3", "12"]);
  await run(h);
  expect(h.log.some((l) => l.includes("https"))).toBe(true);
  expect(h.log).toContain("That board is on other.atlassian.net, but better-jira is connected to acme-team.atlassian.net.");
  expect(h.saved.local).toMatchObject({ site: SITE, boards: [12] });
});

test("boards are chosen by link as Add board does, and a long list is searched by name", async () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ id: 100 + i, name: `Team ${i}`, type: "kanban" }));
  const h = harness(
    fakeJira((p) =>
      p.startsWith("/rest/agile/1.0/board?") ? Response.json({ isLast: true, values: [...many, { id: 12, name: "Payments", type: "kanban" }] }) : undefined!,
    ),
    [SITE, "ada@example.invalid", "paym", `${SITE}/jira/software/projects/PAY/boards/12, 34`],
  );
  await run(h);
  expect(h.log).toContain("\nYour account can see 46 boards. Type part of your board's name to find it, or paste its link.");
  expect(h.log.some((l) => l.includes("Team 0"))).toBe(false);
  expect(h.log.some((l) => l.includes("12") && l.includes("Payments"))).toBe(true);
  expect(h.saved.local).toMatchObject({ boards: [12, 34] });
});

test("a project where the account can't edit is named, with what will fail", async () => {
  const h = harness(
    fakeJira((p) =>
      p.startsWith("/rest/api/3/mypermissions")
        ? Response.json({ permissions: { EDIT_ISSUES: { havePermission: false }, ADD_COMMENTS: { havePermission: true } } })
        : undefined!,
    ),
    [SITE, "ada@example.invalid", "12"],
  );
  await run(h);
  expect(h.log.join("\n")).toContain("Your account can't edit issues in PAY");
});
