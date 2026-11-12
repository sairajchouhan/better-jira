# src/

Two entries: `server/index.ts` (the Bun server) and `client/index.html` → `client/main.tsx` (the app).

| Folder | Holds |
|---|---|
| `server/` | Bun only: the HTTP entry, the Jira client and writes, the SQLite mirror, proxies, link previews, config. Never imported by the client. |
| `shared/` | Modules both entries import at runtime: the ADF document model, view model, saved-view model, Jira ops, issue properties and resources, attachment media, people, inbox model. No React; no runtime import from `client/` (domain types still come from `client/state/store.ts`). |
| `client/` | `main.tsx` (mounts the app), `App.tsx` (picks the screen), `index.html`, `index.css` (theme tokens and global styles). |
| `client/routes/` | One top-level screen per route: board, issue, document, inbox, view editor. |
| `client/features/` | One folder per feature: `editor` (rich editor, ProseMirror plugins, slash/emoji/mention menus, code blocks, tables), `issue` (detail controls, sub-issues, properties, activity, attachments), `media`, `comments`, `views` (saved views, view toolbar, views sidebar and directory), `filters`, `navigation` (routing state, sidebar, palette, shortcuts, favorites, recents), `reminders`. |
| `client/components/` | Shared UI primitives, each with its CSS: button, dialog, field, select, switch, tabs, toast, tooltip, keycap, menu, icons, empty state, … They don't use the store at runtime. |
| `client/state/` | The store, xstate machines, local storage and IndexedDB data, outbox, sync, undo, issue actions, app notifications. |
| `client/lib/` | Small pure helpers with no React and no store (fuzzy score, due dates). |

## Where a new file goes

1. Does the server import it? Only the server → `server/`. Server and client → `shared/`.
2. A new screen → `client/routes/`.
3. A UI primitive with no store or feature knowledge → `client/components/`.
4. App-wide state, persistence or sync → `client/state/`.
5. A pure helper used by more than one feature → `client/lib/`.
6. Everything else belongs to a feature: `client/features/<feature>/`. Start a new feature folder only when it has at least two files.

## Rules

- Tests sit next to the file they test (`x.ts` + `x.test.ts`); CSS sits next to its component.
- Imports: `./x` within a folder, `@/…` (maps to `src/…`) across folders. No barrel `index.ts` files.
- No folders deeper than `client/features/<feature>/`.
