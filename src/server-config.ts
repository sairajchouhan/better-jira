import { configuration, jiraAuth, type LocalSettings } from "./config";

export const settingsPath = ".better-jira.local.json";
export const localSettings: LocalSettings = await Bun.file(settingsPath)
  .json()
  .catch(() => ({}));
export const serverConfiguration = () => configuration(process.env, localSettings);
export const serverAuth = () => jiraAuth(process.env, localSettings);
