import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { CREDENTIALS_FILENAME } from "@/server/server-config";

const INSTANCE_NAME_RE = /^\w[\w.-]*$/;

/** Root folder for standalone CLI config (`~/.config/better-jira`, or `$XDG_CONFIG_HOME/better-jira`). */
export function defaultConfigRoot(homeDir: string = homedir(), env: Record<string, string | undefined> = process.env): string {
  if (env.BETTER_JIRA_CONFIG_DIR?.trim()) return resolve(env.BETTER_JIRA_CONFIG_DIR.trim());
  if (env.XDG_CONFIG_HOME?.trim()) return join(resolve(env.XDG_CONFIG_HOME.trim()), "better-jira");
  return join(homeDir, ".config", "better-jira");
}

/** Root folder for rebuildable cache (`~/.cache/better-jira`, or `$XDG_CACHE_HOME/better-jira`). */
export function defaultCacheRoot(homeDir: string = homedir(), env: Record<string, string | undefined> = process.env): string {
  if (env.BETTER_JIRA_CACHE_DIR?.trim()) return resolve(env.BETTER_JIRA_CACHE_DIR.trim());
  if (env.XDG_CACHE_HOME?.trim()) return join(resolve(env.XDG_CACHE_HOME.trim()), "better-jira");
  return join(homeDir, ".cache", "better-jira");
}

export type InstancePaths = {
  instance: string;
  configRoot: string;
  cacheRoot: string;
  instanceDir: string;
  cacheDir: string;
  credentialsFile: string;
  settingsFile: string;
  cacheFile: string;
  tripsFile: string;
};

/** Resolves an instance's config (`~/.config/better-jira`) and rebuildable cache (`~/.cache/better-jira`). */
export function resolveInstancePaths(options: {
  instance?: string;
  home?: string;
  configRoot?: string;
  cacheRoot?: string;
  env?: Record<string, string | undefined>;
} = {}): InstancePaths {
  const env = options.env ?? process.env;
  const instance = options.instance?.trim() || "default";
  if (!INSTANCE_NAME_RE.test(instance)) {
    throw new Error(`Invalid instance name "${instance}": use letters, digits, ".", "-" and "_".`);
  }
  const configRoot = options.configRoot ? resolve(options.configRoot) : defaultConfigRoot(homedir(), env);
  const cacheRoot = options.cacheRoot ? resolve(options.cacheRoot) : defaultCacheRoot(homedir(), env);
  const explicitHome = options.home?.trim() || env.BETTER_JIRA_HOME?.trim();
  const instanceDir = explicitHome ? resolve(explicitHome) : join(configRoot, "instances", instance);
  const cacheDir = explicitHome ? instanceDir : join(cacheRoot, "instances", instance);
  const preferredCreds = join(instanceDir, CREDENTIALS_FILENAME);
  const legacyCreds = join(instanceDir, ".env");
  const credentialsFile = existsSync(preferredCreds) || !existsSync(legacyCreds) ? preferredCreds : legacyCreds;
  const settingsFile = join(instanceDir, "settings.json");
  const cacheFile = env.JIRA_CACHE?.trim() ? resolve(env.JIRA_CACHE.trim()) : join(cacheDir, "cache.db");
  const tripsFile = env.JIRA_TRIPS?.trim() ? resolve(env.JIRA_TRIPS.trim()) : join(cacheDir, "trips.jsonl");
  return {
    instance,
    configRoot,
    cacheRoot,
    instanceDir,
    cacheDir,
    credentialsFile,
    settingsFile,
    cacheFile,
    tripsFile,
  };
}

/** Parses `.env` / `credentials.env` lines (`KEY=val`, `export KEY="val"`, `'val'`, comments). */
export function parseEnvText(text: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    let value = rawValue.trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      try {
        value = JSON.parse(value) as string;
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(" #");
      if (comment !== -1) value = value.slice(0, comment).trimEnd();
    }
    parsed[key!] = value;
  }
  return parsed;
}

/** Loads `<instanceDir>/credentials.env` (or legacy `.env`) into `env` without overwriting explicit shell vars. */
export function loadCredentialsEnv(instanceDir: string, env: Record<string, string | undefined> = process.env): string | null {
  const preferred = join(instanceDir, CREDENTIALS_FILENAME);
  const legacy = join(instanceDir, ".env");
  const target = existsSync(preferred) ? preferred : existsSync(legacy) ? legacy : null;
  if (!target) return null;
  const entries = parseEnvText(readFileSync(target, "utf8"));
  for (const [key, value] of Object.entries(entries)) {
    if (env[key] === undefined) env[key] = value;
  }
  return target;
}

/** Reads the saved `port` from `<instanceDir>/settings.json`, if present. */
export function readSavedPort(instanceDir: string): number | undefined {
  try {
    const data = JSON.parse(readFileSync(join(instanceDir, "settings.json"), "utf8")) as { port?: unknown };
    return typeof data.port === "number" && Number.isSafeInteger(data.port) && data.port >= 1 && data.port <= 65535
      ? data.port
      : undefined;
  } catch {
    return undefined;
  }
}
