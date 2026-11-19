import { join } from "node:path";
import { configuration, jiraAuth, withAddedBoard, type LocalSettings } from "./config";

const home = process.env.BETTER_JIRA_HOME;
/** The instance folder this server or setup runs on (instances/<name>), which scripts/instance.ts passes in BETTER_JIRA_HOME. */
export function instanceHome(): string {
  if (!home)
    throw new Error(
      "No instance is chosen. Run bun start <name>, bun run dev <name> or bun run setup <name>, with <name> a folder in instances/.",
    );
  return home;
}
export const settingsPath = () => join(instanceHome(), "settings.json");
export const localSettings: LocalSettings = home
  ? await Bun.file(join(home, "settings.json"))
      .json()
      .catch(() => ({}))
  : {};
export const serverConfiguration = () => configuration(process.env, localSettings);
export const serverAuth = () => jiraAuth(process.env, localSettings);
/** The mirror's SQLite file: the instance's own cache.db, unless JIRA_CACHE names another. */
export const cachePath = () => process.env.JIRA_CACHE || join(instanceHome(), "cache.db");
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
  localSettings.addedBoards = saved.addedBoards;
}
