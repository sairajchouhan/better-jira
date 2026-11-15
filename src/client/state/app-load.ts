import { type User, type Issue, type Full, type Board, type JiraOptions } from "@/shared/issue-model";
/**
 * Loading the app: the account, boards, issues and saved views from the server, this account's saved local data over
 * them, then the poll, Jira sync and the window listeners. The app machine runs a load and keeps its error on
 * `loadError`; `load` starts one and resolves when it has settled.
 */
import {
  keyMoves,
  learnKeys,
  restartSync,
  resumeSync,
  unsentWrites,
} from "./jira-sync";
import { fetchJson, loadFull, onServerEvent, preloadFull, queryClient, startPoll } from "./server-data";
import {
  flushLocalChanges,
  localDataBlocked,
  openLocalData,
  queueSave,
  storage,
  unsavedLocalChanges,
} from "./local-database";
import { loadHistory, savedHistory } from "./undo-history";
import { resetLocalEdits, savedChanges } from "./local-edits";
import { navigate, startNavigation, ui } from "@/client/features/navigation/app-navigation";
import { liveFavorites } from "@/client/features/navigation/favorites";
import {
  loadSavedViews,
  refreshSavedViews,
  viewError,
} from "@/client/features/views/saved-views";
import { defaultPreferences, parsePreferences } from "@/shared/view-model";
import { createActor, fromPromise, waitFor } from "xstate";
import { appMachine, inspector, StillSyncing } from "./machines";
import { syncProgress, type SyncHealth } from "./sync-problem";
import {
  savedBoard,
  savedDefaults,
  savedOpenIn,
  savedViewPreferences,
  scopePreferences,
} from "./browser-preferences";
import { commit, get, set, ME } from "./store";

const app = createActor(appMachine.provide({ actors: { load: fromPromise(loadApplication) } }), {
  inspect: inspector("app"),
}).start();
app.subscribe(({ context }) => {
  if (context.error !== get().loadError || context.waiting !== get().loadWaiting)
    commit({ loadError: context.error, loadWaiting: context.waiting });
});
if (typeof window !== "undefined")
  Object.assign(window, { machines: { ui, app, storage }, queryClient, loadFull });

const settled = (s: ReturnType<typeof app.getSnapshot>) =>
  s.matches("ready") || s.matches("failed");
export async function load() {
  app.send({ type: "load" });
  await waitFor(app, settled);
}
/** The issue an issue page's address names (`/issue/KEY/…`), as Linear's `preloadTargetForPath` reads it. Jira keys
 *  need no decoding. */
const issueOfPath = (path: string) => path.match(/^\/issue\/([^/]+)/)?.[1];
/** Window listeners are added by the first load only; a storage retry loads again. */
let listening = false;
async function loadApplication() {
  const opened = issueOfPath(location.pathname);
  if (opened) preloadFull(opened);
  const client = await fetchJson<{
    site: string;
    user: User;
    writable?: boolean;
  }>("/api/client");
  if (!client.site || !client.user?.id || !client.user.name)
    throw new Error("Jira account setup is incomplete");
  Object.assign(ME, client.user);
  const namespace = `${client.site}/${client.user.id}`;
  scopePreferences(namespace);
  // Views load with the issues, so a view route paints as the view, never the plain board first.
  const [boards, remote, savedViews] = await Promise.all([
    fetchJson<Board[]>("/api/boards"),
    fetchJson<Issue[]>("/api/issues"),
    loadSavedViews(),
  ]);
  // A board shows once its first sync has read every issue; until then say how far it has got, or why it can't.
  if (!boards.length) {
    const health = await fetchJson<SyncHealth>("/api/sync");
    if (health.errors.length) throw new Error(health.errors.join(" "));
    throw new StillSyncing(syncProgress(health));
  }
  const { local, start: startSaving } = await openLocalData(namespace, {
    snapshot: () => ({ changes: savedChanges(), ...savedHistory(), keys: keyMoves() }),
    moved: learnKeys,
  });
  const defaults = savedDefaults();
  const preferences = savedViewPreferences();
  for (const b of boards)
    if (!preferences[b.id]) {
      const display = parsePreferences({ display: defaults[b.id] }).display;
      if (!defaults[b.id]) display.openIn = savedOpenIn();
      preferences[b.id] = { ...defaultPreferences(), display };
    }
  const last = savedBoard();
  const board = boards.some((b) => b.id === last) ? last : boards[0]!.id;
  const issues = new Map(remote.map((i) => [i.key, i])),
    full = new Map<string, Full>();
  resetLocalEdits();
  restartSync(local, remote, issues, full, client.writable === true);
  // Undo covers this tab's own edits only, as Linear's per-client history does; a reload keeps them (R2-inbox-D3).
  const history = loadHistory(local);
  set({
    boards,
    site: client.site,
    namespace,
    writable: client.writable === true,
    issues,
    full,
    defaults,
    preferences,
    savedViews,
    favorites: liveFavorites(savedViews),
    ...history,
  });
  navigate({ board, view: preferences[board]?.display.openIn ?? "side" });
  startSaving();
  resumeSync(local.changes);
  if (!listening) {
    listening = true;
    const reloadViews = () => void refreshSavedViews().catch(viewError);
    window.addEventListener("focus", reloadViews);
    // Another tab saved, renamed or deleted a view: re-read them now, not on the next focus (R3-views-filters-D-5).
    onServerEvent("views", reloadViews);
    startNavigation();
    window.addEventListener("beforeunload", (event) => {
      // Jobs waiting on another tab's create are saved, and replayed by whichever tab sends that create.
      if (unsavedLocalChanges() || unsentWrites()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
  }
  startPoll();
  if (get().writable)
    void import("@/client/features/issue/draft-uploads").then(({ keepDraftUploadsClean }) =>
      keepDraftUploadsClean(namespace, () => JSON.stringify(savedChanges()), {
        full: async (key) => {
          const response = await fetch(`/api/issues/${encodeURIComponent(key)}`);
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("Could not read the issue");
          return response.json();
        },
        uploaded: async (client) => {
          const response = await fetch(`/api/uploads/${encodeURIComponent(client)}`);
          if (response.status === 404) return undefined;
          if (!response.ok) throw new Error("Could not read the upload");
          return response.json();
        },
        remove: async (key, id) => {
          const response = await fetch(`/api/issues/${encodeURIComponent(key)}/ops`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ops: [{ op: "attachment.delete", id }],
              // Only places an issue no board holds yet (issue-store.ts `claim`).
              board: get().issues.get(key)?.boards[0],
            }),
          });
          const result = await response.json().catch(() => ({ error: "No answer" }));
          if (!response.ok || result.error) throw new Error(result.error);
        },
      }),
    );
  if (get().writable)
    fetchJson<JiraOptions>("/api/options", 5 * 60_000).then(
      (options) => set({ options }),
      () => {},
    );
  clockTimer ??= setInterval(() => set({ clock: Date.now() }), 60000);
}

let clockTimer: ReturnType<typeof setInterval> | undefined;
export async function retryLocalStorage() {
  if (localDataBlocked()) {
    app.send({ type: "reload" });
    await waitFor(app, settled);
  } else {
    queueSave();
    await flushLocalChanges();
  }
}
