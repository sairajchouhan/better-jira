import { boardIDs, configuration, siteURL, type LocalSettings } from "../src/server/config";
import { JiraError, JiraTimeout } from "../src/server/jira";
import { jiraProblem, NotJiraAnswer } from "../src/server/jira-problem";

/** What setup does to the outside world, so a test can run the whole flow with a fake Jira and typed answers. */
export type SetupIO = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A typed answer; Enter keeps `existing`. */
  ask: (label: string, existing?: string) => Promise<string>;
  /** The API token, typed without echo; Enter keeps `saved`. */
  secret: (saved: string) => Promise<string>;
  log: (line: string) => void;
  /** Writes the credentials to .env and the site and boards to .better-jira.local.json. */
  save: (credentials: { email: string; token: string }, local: LocalSettings) => Promise<void>;
};
type Environment = Record<string, string | undefined>;

/** Jira's permissions an edit in better-jira needs, by what the teammate would see fail without it. */
const EDIT_PERMISSIONS: Record<string, string> = {
  EDIT_ISSUES: "edit issues",
  TRANSITION_ISSUES: "move issues between statuses",
  ADD_COMMENTS: "comment",
  CREATE_ISSUES: "create issues",
};
const READ_TIMEOUT_MS = 20_000;

/** A failure setup explains and stops on; its message is the whole explanation. */
export class SetupError extends Error {}

/**
 * `bun run setup`: asks for the site, email, token and boards, checks each against Jira with reads only, then saves.
 * `checking` (`--check`) asks nothing and saves nothing: it verifies what is saved. Throws a `SetupError` that says what to fix.
 */
export async function runSetup(
  checking: boolean,
  env: Environment,
  local: LocalSettings,
  io: SetupIO,
): Promise<void> {
  let site = env.JIRA_URL || local.site || "",
    email = env.JIRA_EMAIL || "",
    token = env.JIRA_TOKEN || "";
  if (checking && (!site || !email || !token))
    throw new SetupError(
      "Nothing to check yet: no Jira site, email or API token is saved. Run bun run setup first.",
    );
  if (!checking) {
    site = await answer(io, () => io.ask("Jira site, e.g. https://your-team.atlassian.net", site), siteURL);
    email = (await io.ask("Your Atlassian account email", email)).trim();
    if (!email.includes("@")) throw new SetupError("Enter the email you sign in to Jira with.");
    token = (await io.secret(token)).trim();
    if (!token)
      throw new SetupError(
        "An API token is needed. Create one at https://id.atlassian.com/manage-profile/security/api-tokens and run bun run setup again.",
      );
  }
  site = siteURL(site);
  const read = reader(site, email, token, io.fetch);
  const profile = await read<{ displayName?: string; accountId?: string }>("/rest/api/3/myself");
  if (!profile.accountId)
    throw new SetupError(
      `${new URL(site).host} answered without an account. Check the email and token are for this site.`,
    );
  io.log(`Connected to ${new URL(site).host} as ${profile.displayName ?? email}.`);

  let boards = env.JIRA_BOARDS ? boardIDs(env.JIRA_BOARDS) : (local.boards ?? []);
  if (!checking) {
    const listed = await listBoards(read);
    if (!listed.length)
      throw new SetupError(
        `Your account can't see any boards on ${new URL(site).host}. Ask your project's admin for access to your team's board, then run bun run setup again.`,
      );
    io.log("\nBoards you can see (id, type, name):");
    for (const b of listed) io.log(`  ${String(b.id).padStart(6)}  ${(b.type ?? "").padEnd(6)}  ${b.name}`);
    boards = await answer(
      io,
      () => io.ask("Your board IDs, separated by commas", boards.join(",")),
      (value) => boardIDs(value),
    );
  }
  if (!boards.length)
    throw new SetupError("No boards are chosen yet. Run bun run setup and enter your board IDs.");
  const config = configuration(
    { JIRA_URL: site, JIRA_EMAIL: email, JIRA_TOKEN: token, JIRA_BOARDS: boards.join(",") },
    local,
  );
  for (const id of config.setupBoards) {
    const board = await read<{ name: string; type?: string; location?: { projectKey?: string } }>(
      `/rest/agile/1.0/board/${id}`,
      id,
    );
    await read(`/rest/agile/1.0/board/${id}/configuration`, id);
    const project = board.location?.projectKey;
    io.log(`Verified board ${id}: ${board.name}${project ? ` (${project})` : ""}.`);
    if (project) {
      const missing = await missingEditPermissions(read, project);
      if (missing.length)
        io.log(
          `  Your account can't ${missing.join(", ")} in ${project}. better-jira shows the board, but those edits will fail in Jira.`,
        );
    }
  }
  if (checking) {
    io.log("Setup is valid: Jira accepts your token and you can read every board.");
    return;
  }
  await io.save({ email, token }, { ...local, site, boards });
  io.log(`\nSetup saved. Run bun start, then open http://localhost:${config.port}.`);
}

/** Asks until `parse` accepts the answer, saying why it didn't (three tries, then setup stops). */
async function answer<T>(
  io: SetupIO,
  ask: () => Promise<string>,
  parse: (value: string) => T,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const value = await ask();
    try {
      return parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 3) throw new SetupError(message);
      io.log(message);
    }
  }
}

type Read = <T = any>(path: string, board?: number) => Promise<T>;
/** A Jira GET with this account; any failure becomes a `SetupError` saying what to fix. */
function reader(site: string, email: string, token: string, fetch: SetupIO["fetch"]): Read {
  const auth = `Basic ${btoa(`${email}:${token}`)}`;
  return async (path, board) => {
    try {
      let response: Response;
      try {
        response = await fetch(`${site}${path}`, {
          headers: { Authorization: auth, Accept: "application/json" },
          signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "TimeoutError")
          throw new JiraTimeout("GET", path, READ_TIMEOUT_MS);
        throw error;
      }
      const text = await response.text();
      if (!response.ok) throw new JiraError("GET", path, response.status, text);
      try {
        return JSON.parse(text);
      } catch {
        throw new NotJiraAnswer(path);
      }
    } catch (error) {
      throw new SetupError(jiraProblem(error, site, board));
    }
  };
}

async function listBoards(read: Read) {
  const boards: { id: number; name: string; type?: string }[] = [];
  for (let startAt = 0; ; startAt += 50) {
    const page = await read<{ values?: typeof boards; isLast?: boolean }>(
      `/rest/agile/1.0/board?maxResults=50&startAt=${startAt}`,
    );
    boards.push(...(page.values ?? []));
    if (page.isLast !== false || (page.values ?? []).length < 50) return boards;
  }
}

/** The edits this account can't make in `project`, in words. A read: Jira's own permission check. */
async function missingEditPermissions(read: Read, project: string) {
  const answer = await read<{ permissions?: Record<string, { havePermission?: boolean }> }>(
    `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(project)}&permissions=${Object.keys(EDIT_PERMISSIONS).join(",")}`,
  );
  return Object.entries(EDIT_PERMISSIONS)
    .filter(([key]) => answer.permissions?.[key]?.havePermission === false)
    .map(([, words]) => words);
}
