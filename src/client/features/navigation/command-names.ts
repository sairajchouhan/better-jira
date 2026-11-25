import type { Issue } from "@/shared/issue-model";
import { epicOf } from "@/shared/epics";

/**
 * ⌘K's names for the registry's commands: Linear's action `name` outside a contextual menu (startup-root.CnUSfl4j.js), keyed by
 * our registry id. The registry `name` stays the shortcuts panel's wording (Linear's HelpCenter lists its own). Space, Epic and
 * Milestone stand for Linear's Team, Project and Milestone.
 */
export const COMMAND_NAMES: Readonly<Record<string, string>> = {
  // `?` (mAt) and ⌘/ (`SHOW_KEYBOARD_SHORTCUTS_HELP_CENTER`).
  help: "Help",
  shortcuts: "Open Keyboard Shortcuts Cheat Sheet",
  // The Open … pages (O then I, D, U, F, S, V).
  "open-issue": "Open issue…",
  "open-document": "Open document…",
  "open-user": "Open user…",
  "favorite-open": "Open favorite…",
  "team-open": "Open space…",
  "view-open": "Open view…",
  // The issue's Rename, description focus and subscribers, as live ⌘K lists them.
  rename: "Rename issue…",
  description: "Focus issue description",
  subscribers: "Change subscribers…",
  // ctrl L, as live ⌘K lists it.
  link: "Add link…",
  // zmt and uM (whose name has no contextual branch).
  "copy-id": "Copy issue ID",
  "copy-link": "Copy title as link",
  // ⇧F.
  "filter-last": "Clear last filter",
};

/** ⌘K's names while ⌥ is held, for the commands that copy differently then (`zmt`, `sM`, `uM` outside a contextual menu). */
export const COMMAND_ALT_NAMES: Readonly<Record<string, string>> = {
  "copy-id": "Copy issue ID as link",
  "copy-title": "Copy issue title without ID",
  "copy-link": "Copy title without ID as link",
};

type Lookup = (key: string) => Issue | undefined;

/** ⌘K's name for an issue command whose Linear name reads the targeted issue: set or change. Undefined for a command whose
 *  name doesn't depend on the issue. */
export function issueCommandName(id: string, issue: Issue | undefined, lookup: Lookup): string | undefined {
  switch (id) {
    case "assign":
      return "Assign to…";
    case "status":
      return "Change status…";
    case "priority":
      return issue?.priority ? "Change priority…" : "Set priority…";
    case "type":
      return "Change issue type…";
    // ydn: `Add labels…` on an issue without labels, else `Change or add labels…`.
    case "labels":
      return issue?.labels.length ? "Change or add labels…" : "Add labels…";
    case "due":
      return issue?.due ? "Change due date…" : "Set due date…";
    case "remind":
      return "Remind me about this issue…";
    // zBn: `Move to project…` once the issue is in one.
    case "project":
      return issue && epicOf(issue, lookup) ? "Move to epic…" : "Add to epic…";
    case "milestone":
      return issue?.milestones?.length ? "Move to milestone…" : "Add to milestone…";
  }
  return undefined;
}

/** A registry command's ⌘K name: its state-dependent `label` first ("Un-assign from me"), then Linear's name for the targeted
 *  issue ("Change priority…"), then its fixed ⌘K name, else the registry name. */
export const paletteName = (
  entry: { id: string; name: string; label?: () => string },
  issue: Issue | undefined,
  lookup: Lookup,
) => entry.label?.() ?? issueCommandName(entry.id, issue, lookup) ?? COMMAND_NAMES[entry.id] ?? entry.name;
