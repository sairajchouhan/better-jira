import { adfToText } from "@/client/features/editor/document-text";
import { createActor, type ActorOptions, type AnyActorLogic } from "xstate";
import { normalizeDocument, type AdfDocument } from "@/shared/document";
import { autosaveMachine, inspector } from "@/client/state/machines";
import { DESCRIPTION_CONFLICT } from "@/shared/jira-ops";

/**
 * One issue description being edited: unsaved typing, its reload draft, and the conflict when Jira's text moves under
 * it. Typing saves 600ms after it stops and on flush; a reload in that window keeps it in localStorage
 * (`better-jira:description-draft:<namespace>:<key>`, as `{ doc, base }` or, from older pages, the bare document).
 */
export type DescriptionSnapshot = {
  /** Bumps whenever the document under the editor is replaced; remount the editor on it. */
  revision: number;
  /** What a remounted editor opens with: unsaved typing, or undefined for the store's copy. */
  draft: AdfDocument | undefined;
  /** Jira's text changed under unsaved typing; saves wait until `resolve`. */
  conflict: boolean;
};

/** The store and Jira, as the session sees them. Keys passed here are already moved to Jira's key. */
export type DescriptionPorts = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** The issue's description as the store holds it now. */
  read: (key: string) => unknown;
  /** Jira refused the last save because someone else changed the text. */
  refused: (key: string) => boolean;
  /** Stores a new version locally, to be sent to Jira. */
  write: (key: string, doc: AdfDocument) => void;
  /** Drops the refused or unsaved version into the description history. */
  discard: (key: string, unsaved?: AdfDocument) => void;
  /** Writes local changes to disk; resolves when written. */
  persist: () => Promise<unknown>;
  /** An issue created here moves to Jira's key once Jira made it. */
  currentKey: (key: string) => string;
  clock?: ActorOptions<AnyActorLogic>["clock"];
};

const textOf = (doc: string) => adfToText(JSON.parse(doc || "null"));
const stringify = (doc: unknown) => JSON.stringify(normalizeDocument(doc as AdfDocument));

/**
 * `key` is the issue's key when the editor opened; it stays the session's key (and draft key) after the issue moves to
 * Jira's key. `stored` is the store's normalized description JSON, or "" before the issue loaded. A session made before
 * the load takes the first text it is given as the one the editor shows: the editor mounts with it, so it is never
 * remounted for it (BJ-193).
 */
export function descriptionSession(
  { key, namespace, stored }: { key: string; namespace: string; stored: string },
  ports: DescriptionPorts,
) {
  const draftKey = `better-jira:description-draft:${namespace}:${key}`;
  // `shown` is the text the editor started from (the base of unsaved typing), undefined until the issue loaded; `typed`
  // is the typing not yet saved.
  let shown: string | undefined = stored || undefined,
    typed: AdfDocument | null = null,
    conflict = false,
    resolving = false,
    snapshot: DescriptionSnapshot = { revision: 0, draft: undefined, conflict: false };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DescriptionSnapshot> = {}) => {
    snapshot = { ...snapshot, conflict, ...patch };
    for (const listener of listeners) listener();
  };
  const remount = () => publish({ revision: snapshot.revision + 1, draft: typed ?? undefined });
  const show = (doc: string) => {
    shown = doc;
    remount();
  };
  // The editor mounted with the store's first text when the issue loaded, so that is what it shows.
  const opened = (stored: string) => {
    if (shown === undefined && stored) shown = stored;
  };
  const held = () => resolving || conflict || ports.refused(ports.currentKey(key));
  const forget = () => {
    try {
      ports.storage.removeItem(draftKey);
    } catch {
      /* best effort */
    }
  };
  const autosave = createActor(
    autosaveMachine.provide({
      actions: {
        keepDraft: (_, doc) => {
          try {
            // With the text it started from, so a reload can tell whether Jira changed meanwhile.
            ports.storage.setItem(draftKey, JSON.stringify({ doc, base: shown }));
          } catch {
            /* autosave still runs */
          }
        },
        commit: (_, doc) => {
          if (!doc || held()) return;
          shown = stringify(doc);
          typed = null;
          ports.write(ports.currentKey(key), doc);
          void ports.persist().then(() => {
            if (autosave.getSnapshot().matches("clean")) forget();
          });
        },
      },
    }),
    // An explicit `clock: undefined` would replace xstate's default timers, so it is only passed when given.
    { inspect: inspector(`autosave ${key}`), ...(ports.clock && { clock: ports.clock }) },
  ).start();

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    /** Whether saves wait for the person to pick a version. */
    held,

    /** The editor's document changed. */
    edit(doc: AdfDocument) {
      typed = doc;
      autosave.send({ type: "change", doc });
    },
    /** Saves pending typing now (blur, unmount). */
    flush() {
      autosave.send({ type: "flush" });
    },
    /** Keeps the typed (or refused) version, or takes Jira's. Typing not yet saved is kept or dropped, never committed on the way. */
    resolve(keep: boolean) {
      resolving = true;
      autosave.send({ type: "flush" });
      const at = ports.currentKey(key);
      if (keep) {
        const doc = typed ?? normalizeDocument(JSON.parse(shown ?? "null"));
        shown = stringify(doc);
        typed = null;
        conflict = false;
        resolving = false;
        ports.write(at, doc);
        void ports.persist();
        publish();
      } else {
        forget();
        // The discarded text goes to the description history, and nothing of it is sent later (R2-D1).
        ports.discard(at, typed ?? undefined);
        typed = null;
        conflict = false;
        resolving = false;
        show(stringify(ports.read(at) ?? ""));
      }
    },

    /**
     * The store's description is `stored`. Undo, redo, a rolled-back save, a restored revision or someone else's edit
     * replaces the document under the editor; only unsaved typing asks first (R2-D1). A focused editor (`inside`) with
     * nothing unsaved takes Jira's text too, but not a mere media id swap after its own save. Returns true when the
     * focused editor was replaced and should get focus back. Safe to call again with the same input.
     */
    observe(stored: string, inside: boolean): boolean {
      opened(stored);
      if (!stored || stored === shown || conflict) return false;
      if (autosave.getSnapshot().matches("dirty") && textOf(stored) !== textOf(shown ?? "")) {
        conflict = true;
        publish();
      } else if (!inside) show(stored);
      else if (textOf(stored) !== textOf(shown ?? "")) {
        show(stored);
        return true;
      }
      return false;
    },
    /** Jira's copy was restored over this issue: the editor takes it, unsaved typing included. */
    restored() {
      shown = "";
      typed = null;
      conflict = false;
      publish();
    },
    /**
     * The issue loaded with `stored`. A reload in the autosave window left typing in the draft: save it, unless Jira's
     * text changed since it started (R2-D1, R2-D2).
     */
    recover(stored: string) {
      opened(stored);
      try {
        const raw = ports.storage.getItem(draftKey);
        if (!raw) return;
        const saved = JSON.parse(raw),
          doc: AdfDocument = saved?.type === "doc" ? saved : saved.doc,
          base: string | undefined = saved?.type === "doc" ? undefined : saved.base;
        if (textOf(JSON.stringify(doc)) === textOf(stored)) forget();
        else if (held() || (base && textOf(base) !== textOf(stored))) {
          typed = doc;
          if (!held()) conflict = true;
          remount();
        } else {
          autosave.send({ type: "change", doc });
          autosave.send({ type: "flush" });
          remount();
        }
      } catch {
        /* ignore a broken draft */
      }
    },
    /** Media that finished uploading after its editor closed joins the description as it is now. */
    lateMedia(merge: (current: unknown) => AdfDocument) {
      const at = ports.currentKey(key);
      ports.write(at, merge(ports.read(at)));
    },
  };
}
export type DescriptionSession = ReturnType<typeof descriptionSession>;

/**
 * The bar over a description Jira didn't take, and whether saves wait until a version is picked. `conflict` is the
 * session's (Jira moved under unsaved typing); `rejected` and `error` are the refused version and Jira's reason kept in the
 * store. A conflict counts wherever its text sits in the reason (a created issue's catch-up wraps it), and a refused
 * version whose reason is gone is still never shown as saved (QA-3 D3).
 */
export function descriptionNotice(conflict: boolean, rejected: boolean, error: string | undefined) {
  const reason = error || (rejected ? DESCRIPTION_CONFLICT : undefined),
    refusedConflict = !!reason?.includes(DESCRIPTION_CONFLICT);
  return {
    held: conflict || refusedConflict,
    message: conflict
      ? "Jira's copy of this description changed. Your edits aren't saved."
      : refusedConflict
        ? "Someone changed this description in Jira. Your version isn't saved."
        : reason &&
          `Jira didn't save this description (${reason.replace(/^description:\s*/i, "").replace(/\.$/, "")}). Edit it to try again, or use Jira's version.`,
  };
}
