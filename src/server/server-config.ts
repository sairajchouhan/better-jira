import { configuration, jiraAuth, withAddedBoard, type LocalSettings } from "./config";

export const settingsPath = ".better-jira.local.json";
export const localSettings: LocalSettings = await Bun.file(settingsPath)
  .json()
  .catch(() => ({}));
export const serverConfiguration = () => configuration(process.env, localSettings);
export const serverAuth = () => jiraAuth(process.env, localSettings);
/** Saves a board added in the app for this site (or, with `withoutAddedBoard`, its removal). Re-reads the file first: another
 *  server may have saved to it. A broken file throws, never overwritten. */
export async function saveAddedBoard(board: number, edit = withAddedBoard) {
  const file = Bun.file(settingsPath),
    saved = edit(
      (await file.exists()) ? await file.json() : {},
      serverAuth().site,
      board,
    );
  await Bun.write(settingsPath, JSON.stringify(saved, null, 2) + "\n");
  localSettings.addedBoards = saved.addedBoards;
}
