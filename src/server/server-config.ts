import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configuration, jiraAuth, withAddedBoard, type LocalSettings } from "./config";

/** Preferred per-instance credentials filename (owner-only 0600); legacy `.env` is still read if present. */
export const CREDENTIALS_FILENAME = "credentials.env";

/** The instance folder this server or setup runs on (e.g. `~/.config/better-jira/instances/default` or `instances/<name>`). */
export function instanceHome(): string {
  const home = process.env.BETTER_JIRA_HOME;
  if (!home)
    throw new Error(
      "No instance is chosen. Run better-jira start, or bun start <name> / bun run setup <name>.",
    );
  return home;
}
export const settingsPath = () => join(instanceHome(), "settings.json");

/** Resolves the instance's credentials file: `credentials.env` for new instances, or existing `.env` for legacy repo instances. */
export function credentialsPath(home: string = instanceHome()): string {
  const preferred = join(home, CREDENTIALS_FILENAME);
  if (existsSync(preferred)) return preferred;
  const legacy = join(home, ".env");
  if (existsSync(legacy)) return legacy;
  return preferred;
}

function readSettingsSync(home?: string): LocalSettings {
  if (!home) return {};
  try {
    return JSON.parse(readFileSync(join(home, "settings.json"), "utf8")) as LocalSettings;
  } catch {
    return {};
  }
}

export const localSettings: LocalSettings = readSettingsSync(process.env.BETTER_JIRA_HOME);

/** Replaces the in-memory `localSettings` snapshot in place so every module sees newly saved setup settings immediately. */
export function reloadLocalSettings(next: LocalSettings) {
  for (const key of Object.keys(localSettings) as (keyof LocalSettings)[]) delete localSettings[key];
  Object.assign(localSettings, next);
}

/** Re-reads `<BETTER_JIRA_HOME>/settings.json` from disk into `localSettings` (used by the CLI after setting `BETTER_JIRA_HOME`). */
export function loadLocalSettingsFromDisk() {
  reloadLocalSettings(readSettingsSync(process.env.BETTER_JIRA_HOME));
}
export const serverConfiguration = () => configuration(process.env, localSettings);
export const serverAuth = () => jiraAuth(process.env, localSettings);
/** True when `BETTER_JIRA_HOME` and Jira site/credentials/boards are all valid and ready to start the mirror. */
export function isConfigured(): boolean {
  try {
    instanceHome();
    serverConfiguration();
    return true;
  } catch {
    return false;
  }
}
/** Port to bind even before setup is complete. */
export function configuredPort(): number {
  const port = Number(process.env.PORT || localSettings.port || 3000);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : 3000;
}
/** Non-secret defaults shown to the browser setup wizard (never includes the API token). */
export function instanceSetupDefaults() {
  return {
    site: process.env.JIRA_URL || localSettings.site || "",
    email: process.env.JIRA_EMAIL || "",
    hasToken: Boolean(process.env.JIRA_TOKEN?.trim()),
    boards: localSettings.boards ?? [],
    writes: localSettings.writes !== false,
  };
}
/** The mirror's SQLite file: the instance's own cache.db, unless JIRA_CACHE names another. */
export const cachePath = () => process.env.JIRA_CACHE || join(instanceHome(), "cache.db");
/** Where the trips to Jira this instance's browsers send are kept (shared/jira-trips.ts): the instance's trips.jsonl, unless
 *  JIRA_TRIPS names another file. */
export const tripsPath = () => process.env.JIRA_TRIPS || join(instanceHome(), "trips.jsonl");
/** Saves a board added in the app for this site (or, with `withoutAddedBoard`, its removal). Re-reads the file first: another
 *  server may have saved to it. A broken file throws, never overwritten. */
export async function saveAddedBoard(board: number, edit = withAddedBoard) {
  const file = Bun.file(settingsPath()),
    saved = edit(
      (await file.exists()) ? await file.json() : {},
      serverAuth().site,
      board,
    );
  await Bun.write(file, JSON.stringify(saved, null, 2) + "\n");
  localSettings.boards = saved.boards;
  localSettings.addedBoards = saved.addedBoards;
  localSettings.removedBoards = saved.removedBoards;
}
