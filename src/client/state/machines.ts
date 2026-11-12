import { type IssueDraft } from "@/shared/issue-model";
/**
 * Every state machine in better-jira lives in this file, so you can read which event leads where.
 * Each one can be pasted into https://stately.ai/viz to see it as a diagram.
 * Debug: run `localStorage.setItem("better-jira:debug","machines")` and reload. The console then logs
 * every event and the state it leads to, and `window.machines` holds the running actors.
 *
 *   ui       what is on screen: location (board, issue, view), overlay, toolbar. Where you go is decided in
 *            navigation.ts; this machine holds the result for Escape and the toolbar, and owns overlay and toolbar.
 *   app      loading the mirror: idle → loading → ready | failed, retry with load
 *   storage  saving local edits: loading → saved ⇄ saving → failed; blocked while read-only
 *   sync     polling Jira properties: fetching → waiting (3s warming, 30s idle, 10s after an error) → fetching
 *   detail   one per issue: idle → loading → loaded | failed
 *   autosave one per description editor: clean → dirty → commit after 600ms of quiet or on flush (blur, unmount)
 *
 * Machines only decide what happens next. The work they trigger (fetching, saving) is passed in by store.ts with
 * `machine.provide(...)`, so these definitions stay free of I/O and can be tested on their own.
 */
import { assign, enqueueActions, fromPromise, setup, type InspectionEvent } from "xstate";
import type { AdfDocument } from "@/shared/document";
import type { Overlay, View } from "./store";

export type Toolbar = "display" | "filter" | "add-filter" | "advanced";
/** The screen state; store.ts copies it onto `get()` so components keep reading it with `useStore`. */
export type UiContext = {
  board: number;
  view: View;
  selected: string | null;
  /** The selected issue is open, beside the board or as a page. */
  panel: boolean;
  document: string | null;
  mine: boolean;
  /** The Inbox is the main view instead of the board. */
  inbox: boolean;
  sidebarHidden: boolean;
  query: string;
  overlay: Overlay;
  toolbar: Toolbar | null;
  /** The issue the open menu acts on (a sub-issue row, a right-clicked card); null means the selected issue. Cleared with the overlay. */
  target: string | null;
  /** Where a right-click on a card or list row opened Issue options; null opens it under its button. */
  issueOptionsPoint: { x: number; y: number } | null;
  draft: IssueDraft;
  /** Relation operation owned by the open overlay. */
  relation: string;
};
export type UiEvent =
  /** Shows where navigation.ts moved you. A new board resets its search and draft, and closes the toolbar. */
  | ({ type: "navigate" } & Partial<
      Pick<UiContext, "board" | "view" | "selected" | "panel" | "document" | "inbox" | "mine">
    >)
  /** Escape with nothing on top: close the issue, else clear the search, else drop the selection. */
  | { type: "escape" }
  | { type: "sidebar.toggle" }
  | { type: "mine.set"; mine: boolean }
  | { type: "query.set"; query: string }
  | {
      type: "overlay.open";
      overlay: NonNullable<Overlay>;
      draft?: IssueDraft;
      target?: string | null;
      point?: { x: number; y: number };
      kind?: string;
    }
  | { type: "overlay.close" }
  /** ⌘K: opens the palette, or closes it when it is the open overlay. */
  | { type: "palette.toggle" }
  | { type: "toolbar.open"; toolbar: Toolbar }
  | { type: "toolbar.toggle"; toolbar: Toolbar }
  | { type: "toolbar.close" };

const closed = { overlay: null, target: null, issueOptionsPoint: null } as const;
export const uiMachine = setup({
  types: {} as {
    context: UiContext;
    events: UiEvent;
    input: { board: number; view: View; sidebarHidden?: boolean };
  },
  guards: {
    documentOpen: ({ context }) => !!context.document,
    panelOpen: ({ context }) => context.panel,
    hasQuery: ({ context }) => !!context.query,
    paletteOpen: ({ context }) => context.overlay === "palette",
    sameToolbar: ({ context, event }) =>
      event.type === "toolbar.toggle" && context.toolbar === event.toolbar,
    /** The toolbar never stays open behind an overlay, over an issue page or over a document. */
    toolbarCovered: ({ context }) =>
      !!context.overlay || !!context.document || (context.panel && context.view === "page"),
  },
}).createMachine({
  id: "ui",
  type: "parallel",
  context: ({ input }) => ({
    board: input.board,
    view: input.view,
    selected: null,
    panel: false,
    document: null,
    mine: false,
    inbox: false,
    sidebarHidden: input.sidebarHidden ?? false,
    query: "",
    overlay: null,
    toolbar: null,
    target: null,
    issueOptionsPoint: null,
    draft: {},
    relation: "related",
  }),
  on: {
    navigate: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const { type: _, ...screen } = event;
        const changed = (screen.board !== undefined && screen.board !== context.board) ||
          (screen.mine !== undefined && screen.mine !== context.mine);
        enqueue.assign({ ...screen, ...(changed ? { query: "", draft: {} } : {}) });
        if (changed) enqueue.raise({ type: "toolbar.close" });
      }),
    },
    escape: [
      { guard: "documentOpen", actions: assign({ document: null }) },
      { guard: "panelOpen", actions: assign({ panel: false }) },
      { guard: "hasQuery", actions: assign({ query: "" }) },
      { actions: assign({ selected: null }) },
    ],
    "sidebar.toggle": {
      actions: assign({ sidebarHidden: ({ context }) => !context.sidebarHidden }),
    },
    "mine.set": { actions: assign({ mine: ({ event }) => event.mine, inbox: false }) },
    "query.set": { actions: assign({ query: ({ event }) => event.query }) },
  },
  states: {
    overlay: {
      initial: "closed",
      states: {
        closed: {
          on: {
            "overlay.open": {
              target: "open",
              actions: assign(({ event }) => ({
                overlay: event.overlay,
                relation: event.kind ?? "related",
                ...(event.draft ? { draft: event.draft } : {}),
                ...(event.target !== undefined ? { target: event.target } : {}),
                ...(event.point ? { issueOptionsPoint: event.point } : {}),
              })),
            },
            "palette.toggle": { target: "open", actions: assign({ overlay: "palette" }) },
          },
        },
        open: {
          on: {
            "overlay.open": {
              actions: assign(({ event }) => ({
                overlay: event.overlay,
                relation: event.kind ?? "related",
                ...(event.draft ? { draft: event.draft } : {}),
                ...(event.target !== undefined ? { target: event.target } : {}),
                ...(event.point ? { issueOptionsPoint: event.point } : {}),
              })),
            },
            "overlay.close": { target: "closed", actions: assign(closed) },
            "palette.toggle": [
              { guard: "paletteOpen", target: "closed", actions: assign(closed) },
              { actions: assign({ overlay: "palette" }) },
            ],
          },
        },
      },
    },
    toolbar: {
      initial: "closed",
      states: {
        closed: {
          on: {
            "toolbar.open": {
              target: "open",
              actions: assign({ toolbar: ({ event }) => event.toolbar }),
            },
            "toolbar.toggle": {
              target: "open",
              actions: assign({ toolbar: ({ event }) => event.toolbar }),
            },
          },
        },
        open: {
          always: { guard: "toolbarCovered", target: "closed", actions: assign({ toolbar: null }) },
          on: {
            "toolbar.open": { actions: assign({ toolbar: ({ event }) => event.toolbar }) },
            "toolbar.toggle": [
              { guard: "sameToolbar", target: "closed", actions: assign({ toolbar: null }) },
              { actions: assign({ toolbar: ({ event }) => event.toolbar }) },
            ],
            "toolbar.close": { target: "closed", actions: assign({ toolbar: null }) },
          },
        },
      },
    },
  },
});

/** `load` runs the whole mirror load; store.ts provides it. */
/** Loading retries on its own with backoff (1 s, 2 s, 4 s … up to 30 s), so a server that comes back is picked up without a click (sync D4). */
export const LOAD_RETRY_MS = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
export const appMachine = setup({
  types: {} as {
    context: { error: string; attempt: number };
    events: { type: "load" } | { type: "reload" };
  },
  actors: { load: fromPromise<void>(async () => {}) },
  delays: { retry: ({ context }) => LOAD_RETRY_MS(context.attempt - 1) },
}).createMachine({
  id: "app",
  initial: "idle",
  context: { error: "", attempt: 0 },
  states: {
    idle: { on: { load: "loading" } },
    loading: {
      entry: assign({ error: "" }),
      invoke: {
        src: "load",
        onDone: { target: "ready", actions: assign({ attempt: 0 }) },
        onError: {
          target: "failed",
          actions: assign({
            attempt: ({ context }) => context.attempt + 1,
            error: ({ event }) =>
              // fetch's own error: the request never got an answer.
              event.error instanceof TypeError
                ? "Can't reach the better-jira server."
                : event.error instanceof Error
                  ? event.error.message
                  : "Could not load the Jira mirror.",
          }),
        },
      },
    },
    ready: { on: { reload: "loading" } },
    failed: { after: { retry: "loading" }, on: { load: "loading", reload: "loading" } },
  },
});

/** `save` writes the latest local snapshot; edits made while it runs trigger one more save. */
export const storageMachine = setup({
  types: {} as {
    context: { message?: string; recovered?: boolean; dirty: boolean };
    events:
      | { type: "opened"; message?: string; recovered?: boolean }
      | { type: "blocked"; message: string }
      | { type: "change" }
      | { type: "dismiss" };
  },
  actors: { save: fromPromise<void>(async () => {}) },
}).createMachine({
  id: "storage",
  initial: "loading",
  context: { dirty: false },
  // Loading the app opens the database again, whatever state storage was in.
  on: {
    opened: {
      target: ".saved",
      actions: assign(({ event }) => ({
        message: event.message,
        recovered: event.recovered,
        dirty: false,
      })),
    },
    blocked: {
      target: ".blocked",
      actions: assign(({ event }) => ({
        message: event.message,
        recovered: undefined,
        dirty: false,
      })),
    },
    /** Hides the "some data needed recovery" notice. */
    dismiss: { actions: assign({ recovered: undefined }) },
  },
  states: {
    loading: {},
    saved: { on: { change: "saving" } },
    saving: {
      entry: assign({ dirty: false }),
      invoke: {
        src: "save",
        onDone: [
          { guard: ({ context }) => context.dirty, target: "saving", reenter: true },
          {
            target: "saved",
            actions: assign(({ context }) => ({
              message: context.recovered ? context.message : undefined,
            })),
          },
        ],
        onError: {
          target: "failed",
          actions: assign(({ event }) => ({
            recovered: undefined,
            message:
              event.error instanceof Error
                ? event.error.message
                : "Local changes could not be saved. Keep this tab open and retry.",
          })),
        },
      },
      on: { change: { actions: assign({ dirty: true }) } },
    },
    /** A save failed; the edits are still unsaved, and the next change or a retry saves again. */
    failed: { on: { change: "saving" } },
    /** Saved data could not be read or uses a newer version; editing stays paused until a reload opens it. */
    blocked: {},
  },
});

/** One per description editor. `keepDraft` stores each change for reload recovery; `commit` saves the document. */
export const autosaveMachine = setup({
  types: {} as {
    context: { doc: AdfDocument | null };
    events: { type: "change"; doc: AdfDocument } | { type: "flush" };
  },
  actions: { keepDraft: (_, _doc: AdfDocument) => {}, commit: (_, _doc: AdfDocument | null) => {} },
}).createMachine({
  id: "autosave",
  initial: "clean",
  context: { doc: null },
  states: {
    clean: {
      on: {
        change: {
          target: "dirty",
          actions: [
            assign({ doc: ({ event }) => event.doc }),
            { type: "keepDraft", params: ({ event }) => event.doc },
          ],
        },
      },
    },
    dirty: {
      after: {
        600: {
          target: "clean",
          actions: [
            { type: "commit", params: ({ context }) => context.doc },
            assign({ doc: null }),
          ],
        },
      },
      on: {
        change: {
          target: "dirty",
          reenter: true,
          actions: [
            assign({ doc: ({ event }) => event.doc }),
            { type: "keepDraft", params: ({ event }) => event.doc },
          ],
        },
        flush: {
          target: "clean",
          actions: [
            { type: "commit", params: ({ context }) => context.doc },
            assign({ doc: null }),
          ],
        },
      },
    },
  },
});

let debugging = false;
try {
  debugging = localStorage.getItem("better-jira:debug") === "machines";
} catch {
  /* no storage, no logging */
}
/** Pass as `inspect` to createActor; logs each event and resulting state when debugging is on. */
export function inspector(name: string) {
  return debugging
    ? (e: InspectionEvent) => {
        if (e.type === "@xstate.snapshot" && "value" in e.snapshot)
          console.debug(`[${name}] ${e.event.type} →`, JSON.stringify(e.snapshot.value));
      }
    : undefined;
}
