import { compareText } from "./compare";

/** One Jira board available to add as a space in better-jira. */
export type AvailableBoard = {
  id: number;
  name: string;
  type?: string;
  projectKey?: string;
  projectName?: string;
  added?: boolean;
};

/** Result of listing Jira boards; `partial` is true when Jira has more pages beyond the interactive cap. */
export type AvailableBoardsResult = {
  boards: AvailableBoard[];
  partial: boolean;
};

/** Case-insensitive match across board name, project key/name, type, or board ID. */
export function filterAvailableBoards<T extends AvailableBoard>(boards: readonly T[], query: string): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return [...boards];
  return boards.filter(
    (b) =>
      b.name.toLowerCase().includes(term) ||
      (b.projectKey?.toLowerCase().includes(term) ?? false) ||
      (b.projectName?.toLowerCase().includes(term) ?? false) ||
      (b.type?.toLowerCase().includes(term) ?? false) ||
      String(b.id) === term,
  );
}

/** Deterministic alphabetical sort for board lists (added boards stay in alphabetical order with the rest). */
export function sortAvailableBoards<T extends AvailableBoard>(boards: readonly T[]): T[] {
  return [...boards].sort((a, b) => compareText(a.name, b.name) || a.id - b.id);
}
