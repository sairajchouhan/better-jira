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
