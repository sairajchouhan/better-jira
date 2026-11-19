import path from "node:path";
import { boardFromInput, boardIDs, configuration, siteURL, type LocalSettings } from "../src/server/config";
import { canWrite, JiraError, JiraTimeout } from "../src/server/jira";
import { jiraProblem, NotJiraAnswer, TOKEN_PAGE } from "../src/server/jira-problem";

/** What setup does to the outside world, so a test can run the whole flow with a fake Jira and typed answers. */
export type SetupIO = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** A typed answer; Enter keeps `existing`. */
  ask: (label: string, existing?: string) => Promise<string>;
  /** The API token, typed without echo; Enter keeps `saved`. */
  secret: (saved: string) => Promise<string>;
  log: (line: string) => void;
  /** Writes the credentials to the instance's .env and the site and boards to its settings.json. */
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
/** Up to this many boards are listed at once; more, and setup asks for a name to search. */
const LIST_LIMIT = 20;

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
  const profile = await read<{ displayName?: string; accountId?: string }>("/rest/api/3/myself").catch(
    async (error: SetupError) => {
      throw (error.cause as JiraError | undefined)?.status === 401 ? await rejected(site, io.fetch) : error;
    },
  );
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
    boards = await chooseBoards(io, site, listed, boards);
  }
  if (!boards.length)
    throw new SetupError("No boards are chosen yet. Run bun run setup and enter your board IDs.");
  const config = configuration(
    { PORT: env.PORT, JIRA_URL: site, JIRA_EMAIL: email, JIRA_TOKEN: token, JIRA_BOARDS: boards.join(",") },
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
  const host = new URL(site).host,
    name = profile.displayName ?? email;
  if (checking) {
    io.log("Setup is valid: Jira accepts your token and you can read every board.");
    io.log(writeMode(canWrite(site, local, { ...env, NODE_ENV: "production" }), host, name));
    return;
  }
  const writes = await answer(
    io,
    () => io.ask(`Send your edits to Jira? Changes you make in better-jira are saved to ${host} as ${name} (yes/no)`, local.writes === false ? "no" : "yes"),
    yesNo,
  );
  await io.save({ email, token }, { ...local, site, boards, writes });
  io.log(`\nSetup saved. ${writeMode(canWrite(site, { site, writes }, { ...env, NODE_ENV: "production" }), host, name)}`);
  io.log(`Run bun start ${instanceName(env.BETTER_JIRA_HOME)}, then open http://localhost:${config.port}.`);
}

/** How \`bun start\` names the instance at `home`: its name in instances/, else its path. */
const instanceName = (home = "") =>
  path.dirname(home) === path.resolve("instances") ? path.basename(home) : home || "<name>";

/** The mode \`bun start\` runs in, as setup's last word on it. The footer shows the same mode. */
const writeMode = (writes: boolean, host: string, name: string) =>
  writes
    ? `Edits go to Jira: bun start saves your changes to ${host} as ${name}, and the footer says "Edits write to Jira".`
    : `Edits stay local: bun start sends nothing to ${host}, and the footer says "Local only". Run bun run setup again to send edits to Jira.`;

const yesNo = (value: string) => {
  if (/^y(es)?$/i.test(value.trim())) return true;
  if (/^no?$/i.test(value.trim())) return false;
  throw new Error("Answer yes or no.");
};

/** A 401 from Jira: an unauthenticated read of the site's server info tells a wrong site from wrong credentials. */
async function rejected(site: string, fetch: SetupIO["fetch"]) {
  const host = new URL(site).host;
  const isJira = await fetch(`${site}/rest/api/3/serverInfo`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(READ_TIMEOUT_MS),
  }).then(
    async (r) => r.ok && typeof (await r.json())?.baseUrl === "string",
    () => false,
  );
  return new SetupError(
    isJira
      ? `${host} is a Jira site, but it rejected your email and API token (401). Use the email you sign in to Jira with, and an API token, not your password. A token may have expired or been revoked: create a new one at ${TOKEN_PAGE}, then run bun run setup again.`
      : `Jira rejected your email and API token (401), and ${host} doesn't answer as a Jira Cloud site. Check the site address first (https://your-team.atlassian.net), then the email and token.`,
  );
}

/** Lists the boards (or, past \`LIST_LIMIT\`, asks for a name to search) and asks for board IDs or links until they parse. */
async function chooseBoards(
  io: SetupIO,
  site: string,
  listed: { id: number; name: string; type?: string }[],
  saved: number[],
): Promise<number[]> {
  const show = (boards: typeof listed) => {
    io.log("\nBoards (id, type, name):");
    for (const b of boards.slice(0, LIST_LIMIT)) io.log(`  ${String(b.id).padStart(6)}  ${(b.type ?? "").padEnd(6)}  ${b.name}`);
    if (boards.length > LIST_LIMIT) io.log(`  …and ${boards.length - LIST_LIMIT} more. Type part of a name to narrow the list.`);
  };
  if (listed.length <= LIST_LIMIT) show(listed);
  else io.log(`\nYour account can see ${listed.length} boards. Type part of your board's name to find it, or paste its link.`);
  // Searches are free; five answers that name no board (a bad link, a search with no match, nothing) end setup.
  for (let misses = 0; ; ) {
    const value = await io.ask("Board IDs or links, separated by commas, or part of a board name to search", saved.join(","));
    const parts = value.split(/[,\s]+/).filter(Boolean);
    const looksLikeBoards = parts.length > 0 && parts.every((p) => /^\d+$/.test(p) || /^https?:/i.test(p));
    const term = value.trim().toLowerCase();
    const matches = !looksLikeBoards && term ? listed.filter((b) => b.name.toLowerCase().includes(term)) : [];
    let miss = "";
    if (looksLikeBoards)
      try {
        return boardIDs(parts.map((p) => boardFromInput(p, site)));
      } catch (error) {
        miss = (error as Error).message;
      }
    else if (matches.length) show(matches);
    else miss = term ? `No board's name contains "${value.trim()}".` : "Enter your board IDs or links.";
    if (!miss) continue;
    if (++misses >= 5) throw new SetupError(`${miss} Run bun run setup again with your board's ID or link.`);
    io.log(miss);
  }
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
      throw new SetupError(jiraProblem(error, site, board), { cause: error });
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
