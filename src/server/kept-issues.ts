/**
 * Whether the mirror has an issue, reading it from Jira the first time something asks for it by key (a link, a parent, the inbox,
 * an issue address): an issue no board holds is then kept on none (issue-store.ts), as Linear's `hydrateModel` loads a model its
 * sync didn't bring and keeps it. False when Jira has no such issue or hides it from this account (404); other failures reject.
 * Asks made while one read is out share it.
 */
export function keptIssues({
  has,
  read,
  save,
}: {
  has: (key: string) => boolean;
  read: (key: string) => Promise<unknown>;
  save: (raw: any) => void;
}) {
  const reading = new Map<string, Promise<boolean>>();
  return (key: string): Promise<boolean> => {
    if (has(key)) return Promise.resolve(true);
    let pending = reading.get(key);
    if (!pending) {
      pending = read(key)
        .then(
          (raw) => (save(raw), true),
          (error: unknown) => {
            if ((error as { status?: number } | null)?.status === 404) return false;
            throw error;
          },
        )
        .finally(() => reading.delete(key));
      reading.set(key, pending);
    }
    return pending;
  };
}

/**
 * Keeps every child Jira gives an issue through its `parent` field, whatever the types and wherever the child lives. A board's
 * sync brings only the children its filter holds, so a child in another project or on no configured board (an epic's work items
 * in a sibling project) is read here when its parent opens, kept on no board as `keptIssues` keeps a linked one, and saved again
 * when Jira changed it. A child kept on no board that Jira no longer lists under the parent (moved or deleted) is read again, or
 * dropped when Jira has it no more, so it leaves the parent's Sub-issues. A sub-task has no children, so it is never asked.
 * Resolves whether anything changed; asks made while one search is out share it.
 */
export function keptChildren({
  search,
  updated,
  save,
  keptUnder,
  read,
  remove,
}: {
  /** Jira's `parent = <key>` search, every page, with the mirror's fields. */
  search: (key: string) => Promise<any[]>;
  /** The mirror's `updated` for a key, "" when it lacks it. */
  updated: (key: string) => string;
  save: (raw: any) => void;
  /** The keys the mirror keeps on no board with `key` as their parent. */
  keptUnder: (key: string) => string[];
  /** One issue from Jira with the mirror's fields; rejects with `status` 404 when it is gone. */
  read: (key: string) => Promise<any>;
  remove: (key: string) => void;
}) {
  const reading = new Map<string, Promise<boolean>>();
  return (key: string, level?: number): Promise<boolean> => {
    if (typeof level === "number" && level < 0) return Promise.resolve(false);
    let pending = reading.get(key);
    if (!pending) {
      pending = search(key)
        .then(async (children) => {
          let changed = false;
          for (const child of children) {
            const held = updated(child.key);
            if (held && held >= (child.fields?.updated ?? "")) continue;
            save(child);
            changed = true;
          }
          const listed = new Set(children.map((c) => c.key as string));
          for (const left of keptUnder(key).filter((k) => !listed.has(k))) {
            await read(left).then(save, (error: unknown) => {
              if ((error as { status?: number } | null)?.status !== 404) throw error;
              remove(left);
            });
            changed = true;
          }
          return changed;
        })
        .finally(() => reading.delete(key));
      reading.set(key, pending);
    }
    return pending;
  };
}
