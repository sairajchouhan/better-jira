import { loadable } from "@/client/lib/loadable";
import { type Issue } from "@/shared/issue-model";
/**
 * This account's saved local data in IndexedDB: the edits Jira hasn't taken, the undo history, the files they hold and
 * the numbers local keys and comment ids are made from. Saving runs through the storage machine, which reports its
 * state on `storage` and pauses editing (`canEdit`) while the saved data is unreadable. What is saved is whatever the
 * `contents` given to `openLocalData` returns; this module never looks inside it.
 */
import { createActor, fromPromise, waitFor } from "xstate";
import { inspector, storageMachine } from "./machines";
import { emptyLocalState, LocalDatabase, type LocalState } from "./local-data";
import { commit, get, set } from "./store";

type Opened =
  | { type: "opened"; message?: string; recovered?: boolean }
  | { type: "blocked"; message: string };
/** What to save, and where to report the key moves other tabs saved. */
export type LocalContents = {
  snapshot: () => Omit<LocalState, "version" | "sequence">;
  moved: (keys: Record<string, string>) => void;
};

let database: LocalDatabase | undefined;
let contents: LocalContents | undefined;
let localSeq = 0;
const localSnapshot = (): LocalState => ({ version: 1, sequence: localSeq, ...contents!.snapshot() });

/** Exported for the `window.machines` debug handle only. */
export const storage = createActor(
  storageMachine.provide({
    actors: {
      save: fromPromise(async () => {
        localSeq = Math.max(localSeq, await database!.save(localSnapshot()));
        contents!.moved(database!.moved);
      }),
    },
  }),
  { inspect: inspector("storage") },
).start();
storage.subscribe((s) => {
  const status =
    s.matches("failed") || s.matches("blocked")
      ? "error"
      : (s.value as "loading" | "saving" | "saved");
  commit({
    canEdit: !s.matches("blocked"),
    storage: {
      status,
      ...(s.context.message ? { message: s.context.message } : {}),
      ...(s.context.recovered ? { recovered: true } : {}),
    },
  });
});

/** Opens `namespace`'s saved data (closing any open before) and returns it. Saving starts at `start`, once what was loaded
 *  is in the store; an unreadable database loads as empty and leaves editing paused. */
export async function openLocalData(namespace: string, saved: LocalContents) {
  contents = saved;
  let local = emptyLocalState(),
    opened: Opened;
  try {
    database?.close();
    database = await LocalDatabase.open(namespace);
    const result = await database.load();
    local = result.state;
    opened = result.readOnly
      ? {
          type: "blocked",
          message:
            "Saved data uses an unsupported version. Local editing is paused; existing data has been preserved.",
        }
      : {
          type: "opened",
          recovered: result.recovered || result.missingFiles > 0,
          message: result.recovered
            ? "Some local records needed recovery. A copy of the original data was kept."
            : result.missingFiles
              ? "Some saved files could not be restored."
              : undefined,
        };
  } catch {
    opened = {
      type: "blocked",
      message:
        "Could not read saved local data. Local editing is paused. Retry local storage; existing data has not been deleted.",
    };
  }
  localSeq = local.sequence;
  numbers = { next: 0, end: 0 };
  if (opened.type === "opened") await reserveNumbers();
  return { local, start: () => void storage.send(opened) };
}

/** Ignored until storage has opened, and while it is blocked; see storageMachine. */
export const queueSave = () => storage.send({ type: "change" });
/** Resolves once no save is running. */
export async function flushLocalChanges() {
  await waitFor(storage, (s) => !s.matches("saving"));
}
export const dismissRecoveryNotice = () => storage.send({ type: "dismiss" });
/** The saved data could not be read: only reopening it (a reload) resumes editing. */
export const localDataBlocked = () => storage.getSnapshot().matches("blocked");
/** A save is running or failed, so leaving the page now would lose edits. */
export function unsavedLocalChanges() {
  const s = storage.getSnapshot();
  return s.matches("saving") || s.matches("failed");
}

// --- Other tabs: what they saved, and claiming the changes of tabs that closed (see outbox.ts) ---
/** Whether there is shared saved data at all (other tabs can leave changes in it). */
export const localDataOpen = () => database !== undefined;
export const storedChanges = async () => database?.stored();
export async function claimChanges(tab: string, live: Set<string>, only?: Set<string>) {
  const claimed = await database!.claim(tab, live, only);
  return { claimed, changes: (await database!.stored()).changes };
}

// --- Local numbers ---
/** Local numbers (PREFIX-NEWn keys, local comment ids) come from blocks this tab reserves in IndexedDB, one transaction per
 * block, so two tabs never mint the same one (sync review 2). */
const NUMBER_BLOCK = 50;
let numbers = { next: 0, end: 0 },
  reserving: Promise<void> | undefined;
function reserveNumbers() {
  return (reserving ??= (async () => {
    try {
      const first = await database!.reserve(NUMBER_BLOCK, localSeq);
      numbers = { next: first, end: first + NUMBER_BLOCK };
    } catch {
    } finally {
      reserving = undefined;
    }
  })());
}
/** A number no other tab has used or will use. */
export function nextSeq() {
  let n: number;
  if (numbers.next < numbers.end) n = numbers.next++;
  // No shared storage, so no other tab to clash with: count on.
  else if (!database) n = localSeq + 1;
  // ponytail: the block ran out before the next one arrived (dozens of creates within one IndexedDB write); a random number
  // well past the blocks stands in. Reserve larger blocks if this ever shows.
  else n = 1_000_000 + Math.floor(Math.random() * 9_000_000);
  if (database && numbers.end - numbers.next < NUMBER_BLOCK / 2) void reserveNumbers();
  localSeq = Math.max(localSeq, n);
  return n;
}

// --- Files ---
export async function localFileURL(id: string) {
  return database?.fileURL(id);
}
/** Keeps a copy of a Jira attachment, so undoing its removal can upload it again. */
export async function retainJiraFile(id: string, file: Blob) {
  await database?.retainFile(id, file);
}
/** Where new files are kept. Throws when local file storage is unavailable. */
export function localFiles() {
  const db = database;
  if (!db || !get().canEdit)
    throw new Error("Local file storage is unavailable. Retry local storage first.");
  return (files: File[]) => db.addFiles(files);
}
export async function addLocalFiles(files: File[]) {
  return localFiles()(files);
}
/** The saved files' URLs again (blob URLs end with the page); a file the database lost is marked missing. */
export async function restoreLocalFiles(files: NonNullable<Issue["attachments"]>) {
  return Promise.all(
    files.map(async (file) => {
      const url = await database?.fileURL(file.id);
      return { ...file, url: url ?? "", missing: !url };
    }),
  );
}
/** The backup's zip writer: rarely used, so last in the idle walk (Linear's `preloadOrder:"last"`). */
const backupArchiveChunk = loadable("backup-archive", () => import("./backup-archive"), "last");
/** Downloads everything saved here, files included, as one archive. */
export async function downloadLocalBackup() {
  try {
    const { backupArchive } = await backupArchiveChunk.load();
    const data = {
      version: 2,
      namespace: get().namespace,
      state: localSnapshot(),
      recovery: await database?.recoveryCopies(),
    };
    const url = URL.createObjectURL(backupArchive(data, (await database?.fileBlobs()) ?? [])),
      a = document.createElement("a");
    a.href = url;
    a.download = "better-jira-local-backup.tar";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    set({ perf: "Could not export the local backup" });
  }
}
