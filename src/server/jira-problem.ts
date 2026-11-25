import { JiraError, JiraTimeout } from "./jira";

/** Jira answered with something that isn't its API's JSON: a login page, a proxy's page, another site. */
export class NotJiraAnswer extends Error {
  constructor(readonly path: string) {
    super(`Jira GET ${path} answered with a web page, not JSON.`);
  }
}

export const TOKEN_PAGE = "https://id.atlassian.com/manage-profile/security/api-tokens";

/** What went wrong talking to Jira, in words a teammate can act on: the cause and the fix. `board` names the board the
 *  read was for, so a 403 or 404 says which board, not the account. Used by setup, the boot screen and the footer. */
export function jiraProblem(error: unknown, site: string, board?: number): string {
  const host = hostOf(site);
  if (error instanceof JiraTimeout)
    return `${host} didn't answer in time. Check your network or VPN.`;
  if (error instanceof NotJiraAnswer)
    return `${host} answered with a web page, not Jira's API. Check the site address is your Jira Cloud site (https://your-team.atlassian.net).`;
  if (!(error instanceof JiraError))
    return `Can't reach ${host}. Check the site address and your network.`;
  const { status } = error;
  if (status === 401)
    return `Jira rejected your email and API token (401). The token may have expired or been revoked: create a new one at ${TOKEN_PAGE}, then run bun run setup.`;
  if (status === 403)
    return board
      ? `Your Jira account can't read board ${board} (403). Ask the board's admin for access, or pick other boards with bun run setup.`
      : `Jira refused your account on ${host} (403). Check the account can use Jira there, then run bun run setup.`;
  if (status === 404)
    return board
      ? `Board ${board} doesn't exist on ${host}, or your account can't see it. Pick your boards with bun run setup.`
      : `${host} has no Jira Cloud API (404). Check the site address, e.g. https://your-team.atlassian.net.`;
  if (status === 429) return "Jira is limiting requests (429). Retry in a minute.";
  if (status >= 500)
    return `Jira on ${host} is having trouble (${status}). Retry in a few minutes; https://status.atlassian.com lists incidents.`;
  return `Jira returned ${status}: ${error.reason}`;
}

const hostOf = (site: string) => {
  try {
    return new URL(site).host;
  } catch {
    return site;
  }
};
