import { sortAvailableBoards, type AvailableBoard, type AvailableBoardsResult } from "@/shared/available-board";

export type JiraRead = (path: string) => Promise<unknown>;

type RawJiraBoard = {
  id?: number;
  name?: string;
  type?: string;
  location?: {
    projectKey?: string;
    projectName?: string;
    key?: string;
    name?: string;
  };
};

type RawBoardPage = {
  values?: RawJiraBoard[];
  isLast?: boolean;
};

const PAGE_SIZE = 50;

/**
 * Lists boards visible to this Jira account via `/rest/agile/1.0/board`.
 * When `maxPages` is set and Jira reports further pages, returns `partial: true` so callers can fall back to server-side `?name=` search.
 */
export async function listJiraBoards(
  read: JiraRead,
  options: { name?: string; maxPages?: number } = {},
): Promise<AvailableBoardsResult> {
  const name = options.name?.trim() || "";
  const maxPages = options.maxPages ?? Infinity;
  const byId = new Map<number, AvailableBoard>();
  let partial = false;

  for (let pageIndex = 0, startAt = 0; ; pageIndex++, startAt += PAGE_SIZE) {
    const query = new URLSearchParams({ maxResults: String(PAGE_SIZE), startAt: String(startAt) });
    if (name) query.set("name", name);
    const page = (await read(`/rest/agile/1.0/board?${query.toString()}`)) as RawBoardPage;
    const values = page.values ?? [];
    for (const raw of values) {
      const id = Number(raw.id);
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const projectKey = raw.location?.projectKey ?? raw.location?.key;
      const projectName = raw.location?.projectName ?? raw.location?.name;
      byId.set(id, {
        id,
        name: String(raw.name ?? `Board ${id}`),
        ...(typeof raw.type === "string" && raw.type ? { type: raw.type } : {}),
        ...(typeof projectKey === "string" && projectKey ? { projectKey } : {}),
        ...(typeof projectName === "string" && projectName ? { projectName } : {}),
      });
    }
    const done = page.isLast !== false || values.length < PAGE_SIZE;
    if (done) break;
    if (pageIndex + 1 >= maxPages) {
      partial = true;
      break;
    }
  }

  return { boards: sortAvailableBoards([...byId.values()]), partial };
}
