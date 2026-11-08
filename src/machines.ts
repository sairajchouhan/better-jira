/**
 * Every state machine in better-jira lives in this file, so you can read which event leads where.
 * Each one can be pasted into https://stately.ai/viz to see it as a diagram.
 * Debug: run `localStorage.setItem("better-jira:debug","machines")` and reload. The console then logs
 * every event and the state it leads to, and `window.machines` holds the running actors.
 *
 *   ui       what is on screen: location (board, issue, view), overlay, toolbar, toast
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
import type { AdfDocument } from "./document";
import type { IssueDraft, Overlay, View } from "./store";

export type Toolbar = "display" | "filter" | "advanced";
export type Toast = { text: string; key?: string; undo?:boolean; detail?:string };
/** The screen state; store.ts copies it onto `get()` so components keep reading it with `useStore`. */
export type UiContext = {
  board: number;
  view: View;
  selected: string | null;
  /** The selected issue is open, beside the board or as a page. */
  panel: boolean;
  document: string|null;
  mine: boolean;
  sidebarHidden:boolean;
  query: string;
  overlay: Overlay;
  toolbar: Toolbar | null;
  draft: IssueDraft;
  /** A one-shot request to focus the description editor once it renders. */
  editDesc: boolean;
  toast: Toast | null;
};
export type UiEvent =
  /** Changes where you are. A new board resets its search, "only mine" and draft, and closes the toolbar. */
  | { type: "navigate"; board?: number; view?: View; selected?: string | null; panel?: boolean; document?:string|null }
  /** Escape with nothing on top: close the issue, else clear the search, else drop the selection. */
  | { type: "escape" }
  | {type:"sidebar.toggle"}
  | { type: "mine.set"; mine: boolean }
  | { type: "query.set"; query: string }
  | { type: "overlay.open"; overlay: NonNullable<Overlay>; draft?: IssueDraft }
  | { type: "overlay.close" }
  /** ⌘K: opens the palette, or closes it when it is the open overlay. */
  | { type: "palette.toggle" }
  | { type: "toolbar.open"; toolbar: Toolbar }
  | { type: "toolbar.toggle"; toolbar: Toolbar }
  | { type: "toolbar.close" }
  | { type: "description.edit" }
  | { type: "description.editDone" }
  | { type: "toast.show"; text: string; key?: string; undo?:boolean; detail?:string }
  | { type: "toast.dismiss" }
  /** Jira gave an issue created here its real key: the toast names and opens the new key, without restarting its timer. */
  | { type: "toast.rekey"; from: string; to: string };

export const uiMachine = setup({
  types: {} as { context: UiContext; events: UiEvent; input: { board: number; view: View } },
  guards: {
    documentOpen: ({context}) => !!context.document,
    panelOpen: ({ context }) => context.panel,
    hasQuery: ({ context }) => !!context.query,
    paletteOpen: ({ context }) => context.overlay === "palette",
    sameToolbar: ({ context, event }) => event.type === "toolbar.toggle" && context.toolbar === event.toolbar,
    /** The toolbar never stays open behind an overlay or over an issue page. */
    toolbarCovered: ({ context }) => !!context.overlay || (context.panel && context.view === "page"),
  },
}).createMachine({
  id: "ui",
  type: "parallel",
  context: ({ input }) => ({ board: input.board, view: input.view, selected: null, panel: false, document:null, mine: false, sidebarHidden:false, query: "", overlay: null, toolbar: null, draft: {}, editDesc: false, toast: null }),
  on: {
    navigate: {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const changed = event.board !== undefined && event.board !== context.board;
        enqueue.assign({
          ...(changed ? { board: event.board, query: "", mine: false, draft: {} } : {}),
          ...(event.view ? { view: event.view } : {}),
          ...(event.selected !== undefined ? { selected: event.selected } : {}),
          ...(event.panel !== undefined ? { panel: event.panel } : {}),
          document:!(event.panel??context.panel)||!(event.selected!==undefined?event.selected:context.selected)?null:event.document!==undefined?event.document:(changed||event.selected!==undefined&&event.selected!==context.selected?null:context.document),
        });
        if (changed) enqueue.raise({ type: "toolbar.close" });
      }),
    },
    escape: [
      { guard: "documentOpen", actions: assign({ document:null }) },
      { guard: "panelOpen", actions: assign({ panel: false }) },
      { guard: "hasQuery", actions: assign({ query: "" }) },
      { actions: assign({ selected: null }) },
    ],
    "sidebar.toggle":{actions:assign({sidebarHidden:({context})=>!context.sidebarHidden})},
    "mine.set": { actions: assign({ mine: ({ event }) => event.mine }) },
    "query.set": { actions: assign({ query: ({ event }) => event.query }) },
    "description.edit": { actions: assign({ panel: true, editDesc: true }) },
    "description.editDone": { actions: assign({ editDesc: false }) },
  },
  states: {
    overlay: {
      initial: "closed",
      states: {
        closed: {
          on: {
            "overlay.open": { target: "open", actions: assign(({ event }) => ({ overlay: event.overlay, ...(event.draft ? { draft: event.draft } : {}) })) },
            "palette.toggle": { target: "open", actions: assign({ overlay: "palette" }) },
          },
        },
        open: {
          on: {
            "overlay.open": { actions: assign(({ event }) => ({ overlay: event.overlay, ...(event.draft ? { draft: event.draft } : {}) })) },
            "overlay.close": { target: "closed", actions: assign({ overlay: null }) },
            "palette.toggle": [{ guard: "paletteOpen", target: "closed", actions: assign({ overlay: null }) }, { actions: assign({ overlay: "palette" }) }],
          },
        },
      },
    },
    toolbar: {
      initial: "closed",
      states: {
        closed: {
          on: {
            "toolbar.open": { target: "open", actions: assign({ toolbar: ({ event }) => event.toolbar }) },
            "toolbar.toggle": { target: "open", actions: assign({ toolbar: ({ event }) => event.toolbar }) },
          },
        },
        open: {
          always: { guard: "toolbarCovered", target: "closed", actions: assign({ toolbar: null }) },
          on: {
            "toolbar.open": { actions: assign({ toolbar: ({ event }) => event.toolbar }) },
            "toolbar.toggle": [{ guard: "sameToolbar", target: "closed", actions: assign({ toolbar: null }) }, { actions: assign({ toolbar: ({ event }) => event.toolbar }) }],
            "toolbar.close": { target: "closed", actions: assign({ toolbar: null }) },
          },
        },
      },
    },
    toast: {
      initial: "hidden",
      states: {
        hidden: { on: { "toast.show": { target: "shown", actions: assign({ toast: ({ event }) => ({ text: event.text, ...(event.key ? { key: event.key } : {}),...(event.undo?{undo:true}:{}),...(event.detail?{detail:event.detail}:{}) }) }) } } },
        shown: {
          after: { 5000: { target: "hidden", actions: assign({ toast: null }) } },
          on: {
            "toast.show": { target: "shown", reenter: true, actions: assign({ toast: ({ event }) => ({ text: event.text, ...(event.key ? { key: event.key } : {}),...(event.undo?{undo:true}:{}),...(event.detail?{detail:event.detail}:{}) }) }) },
            "toast.dismiss": { target: "hidden", actions: assign({ toast: null }) },
            "toast.rekey": { actions: assign({ toast: ({ context, event }) => context.toast?.key === event.from ? { ...context.toast, key: event.to, text: context.toast.text.replace(new RegExp(`${event.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g"), event.to) } : context.toast }) },
          },
        },
      },
    },
  },
});

/** `load` runs the whole mirror load; store.ts provides it. */
export const appMachine = setup({
  types: {} as { context: { error: string }; events: { type: "load" } | { type: "reload" } },
  actors: { load: fromPromise<void>(async () => {}) },
}).createMachine({
  id: "app",
  initial: "idle",
  context: { error: "" },
  states: {
    idle: { on: { load: "loading" } },
    loading: {
      entry: assign({ error: "" }),
      invoke: {
        src: "load",
        onDone: "ready",
        onError: { target: "failed", actions: assign({ error: ({ event }) => (event.error instanceof Error ? event.error.message : "Could not load the Jira mirror. Retry.") }) },
      },
    },
    ready: { on: { reload: "loading" } },
    failed: { on: { load: "loading", reload: "loading" } },
  },
});

/** `save` writes the latest local snapshot; edits made while it runs trigger one more save. */
export const storageMachine = setup({
  types: {} as {
    context: { message?: string; recovered?: boolean; dirty: boolean };
    events: { type: "opened"; message?: string; recovered?: boolean } | { type: "blocked"; message: string } | { type: "change" } | { type: "dismiss" };
  },
  actors: { save: fromPromise<void>(async () => {}) },
}).createMachine({
  id: "storage",
  initial: "loading",
  context: { dirty: false },
  // Loading the app opens the database again, whatever state storage was in.
  on: {
    opened: { target: ".saved", actions: assign(({ event }) => ({ message: event.message, recovered: event.recovered, dirty: false })) },
    blocked: { target: ".blocked", actions: assign(({ event }) => ({ message: event.message, recovered: undefined, dirty: false })) },
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
          { target: "saved", actions: assign(({ context }) => ({ message: context.recovered ? context.message : undefined })) },
        ],
        onError: {
          target: "failed",
          actions: assign(({ event }) => ({ recovered: undefined, message: event.error instanceof Error ? event.error.message : "Local changes could not be saved. Keep this tab open and retry." })),
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
  types: {} as { context: { doc: AdfDocument | null }; events: { type: "change"; doc: AdfDocument } | { type: "flush" } },
  actions: { keepDraft: (_, _doc: AdfDocument) => {}, commit: (_, _doc: AdfDocument | null) => {} },
}).createMachine({
  id: "autosave",
  initial: "clean",
  context: { doc: null },
  states: {
    clean: { on: { change: { target: "dirty", actions: [assign({ doc: ({ event }) => event.doc }), { type: "keepDraft", params: ({ event }) => event.doc }] } } },
    dirty: {
      after: { 600: { target: "clean", actions: [{ type: "commit", params: ({ context }) => context.doc }, assign({ doc: null })] } },
      on: {
        change: { target: "dirty", reenter: true, actions: [assign({ doc: ({ event }) => event.doc }), { type: "keepDraft", params: ({ event }) => event.doc }] },
        flush: { target: "clean", actions: [{ type: "commit", params: ({ context }) => context.doc }, assign({ doc: null })] },
      },
    },
  },
});

let debugging = false;
try { debugging = localStorage.getItem("better-jira:debug") === "machines"; } catch { /* no storage, no logging */ }
/** Pass as `inspect` to createActor; logs each event and resulting state when debugging is on. */
export function inspector(name: string) {
  return debugging ? (e: InspectionEvent) => { if (e.type === "@xstate.snapshot" && "value" in e.snapshot) console.debug(`[${name}] ${e.event.type} →`, JSON.stringify(e.snapshot.value)); } : undefined;
}
