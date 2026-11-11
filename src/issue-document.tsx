/* oxlint-disable react/immutability -- Session callbacks and mutable imperative models are intentionally owned outside React state. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { createContext, use, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Debouncer } from "@tanstack/pacer";
import { Command } from "cmdk";
import { Icon, StatusIcon } from "./icons";
import { Confirm, MenuSurface, MENU_INPUT, MENU_ITEM } from "./menu-surface";
import { DocumentBodyEditor } from "./rich-editor-loader";
import { Adf } from "./adf";
import { statusById } from "./board-catalog";
import { adfToMarkdown } from "./issue-copy";
import { normalizeDocument, type AdfDocument } from "./document";
import {
  actions,
  addIssueFiles,
  flushLocalChanges,
  get,
  ME,
  navigate,
  set,
  toggleFavorite,
  useStore,
  type Issue,
} from "./store";
import type { DocumentRevision, IssueResource } from "./issue-resource";
import { documentURL } from "./issue-resources";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { useCommand } from "./commands";
import { emojiOptions } from "./reactions";
import { reminderPresets, reminderTime } from "./reminder-display";
const BUTTON = "rounded px-2 py-1.5 text-[13px] text-fg-2 hover:bg-hover";
type Draft = { title: string; body: AdfDocument };
export function IssueDocument({ issue, id }: { issue: Issue; id: string }) {
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        const target =
          [...document.querySelectorAll<HTMLElement>("[data-resource-id]")].find(
            (node) => node.dataset.resourceId === id,
          ) ?? document.getElementById("issue-options");
        target?.focus();
      });
    },
    [id],
  );
  const resource = issue.resources?.find((r) => r.id === id && r.kind === "document");
  return resource ? (
    <DocumentEditor key={id} issue={issue} resource={resource} />
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <p role="status">Document not found</p>
      <button className={BUTTON} onClick={() => navigate({ document: null })}>
        Back to issue
      </button>
    </div>
  );
}
interface DocumentContextValue {
  state: { draft: Draft; revision: number };
  actions: {
    update: (patch: Partial<Draft>) => void;
    endSession: () => void;
    /** Merges media that finished uploading after the body was saved into Jira's current body. */
    mergeLateMedia: (merge: (current: unknown) => AdfDocument) => void;
    /** Saves the draft, copies the stored document and opens the copy if this one is still open. */
    duplicate: () => Promise<void>;
  };
  meta: { issue: Issue; resource: IssueResource };
}
const DocumentContext = createContext<DocumentContextValue | null>(null);
function useDocument() {
  const session = use(DocumentContext);
  if (!session) throw new Error("Document components require DocumentProvider");
  return session;
}

function DocumentProvider({
  issue,
  resource,
  children,
}: {
  issue: Issue;
  resource: IssueResource;
  children: ReactNode;
}) {
  const draftKey = `better-jira:resource-draft:${get().namespace}:${issue.key}:${resource.id}`;
  const read = (): Draft => {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (value && typeof value.title === "string")
        return { title: value.title, body: normalizeDocument(value.body) };
    } catch {}
    return { title: resource.title, body: normalizeDocument(resource.body) };
  };
  const [draft, setDraft] = useState(read),
    pending = useRef(draft),
    session = useRef(crypto.randomUUID()),
    [revision, setRevision] = useState(0);
  // Saves 600ms after the last keystroke; `latest` lets the debouncer call this render's flush.
  const latest = useRef(() => {}),
    [saveSoon] = useState(() => new Debouncer(() => latest.current(), { wait: 600 }));
  const stored = JSON.stringify({ title: resource.title, body: normalizeDocument(resource.body) }),
    saved = useRef(stored),
    observed = useRef(stored);
  const flush = () => {
    saveSoon.cancel();
    const value = pending.current,
      signature = JSON.stringify(value);
    saved.current = signature;
    actions.editResource(issue.key, resource.id, value, session.current);
    void flushLocalChanges().then(() => {
      if (
        get().storage.status === "saved" &&
        saved.current === signature &&
        JSON.stringify(pending.current) === signature
      )
        try {
          localStorage.removeItem(draftKey);
        } catch {}
    });
  };
  const update = (patch: Partial<Draft>) => {
    const next = { ...pending.current, ...patch };
    pending.current = next;
    setDraft(next);
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {
      set({ perf: "Could not retain this document draft across reloads" });
    }
    saveSoon.maybeExecute();
  };
  latest.current = flush;
  const endSession = () => {
    flush();
    session.current = crypto.randomUUID();
  };
  const storedResource = () =>
    get()
      .issues.get(issue.key)
      ?.resources?.find((r) => r.id === resource.id);
  const mergeLateMedia = (merge: (current: unknown) => AdfDocument) => {
    const current = storedResource();
    if (current) actions.editResource(issue.key, resource.id, { body: merge(current.body) });
    void flushLocalChanges();
  };
  const duplicate = async () => {
    endSession();
    const current = storedResource();
    if (!current) return;
    const id = crypto.randomUUID();
    actions.resource(issue.key, {
      ...structuredClone(current),
      id,
      title: `${pending.current.title || "New document"} (copy)`,
      updated: new Date().toISOString(),
      history: [],
    });
    await flushLocalChanges();
    if (get().document === resource.id) navigate({ document: id });
  };
  // Every path flushes through `latest`, so a flush on unmount or page hide uses the current issue key and draft.
  useEffect(() => {
    const flushLatest = () => latest.current();
    flushLatest();
    window.addEventListener("pagehide", flushLatest);
    return () => {
      flushLatest();
      window.removeEventListener("pagehide", flushLatest);
    };
  }, []);
  useEffect(() => {
    if (stored === observed.current) return;
    observed.current = stored;
    if (stored === saved.current) return;
    saveSoon.cancel();
    const next: Draft = JSON.parse(stored);
    pending.current = next;
    saved.current = stored;
    setDraft(next);
    setRevision((n) => n + 1);
    try {
      localStorage.setItem(draftKey, JSON.stringify(next));
    } catch {}
  }, [stored, draftKey, saveSoon]);
  return (
    <DocumentContext
      value={{
        state: { draft, revision },
        actions: { update, endSession, mergeLateMedia, duplicate },
        meta: { issue, resource },
      }}
    >
      {children}
    </DocumentContext>
  );
}

function DocumentEditor({ issue, resource }: { issue: Issue; resource: IssueResource }) {
  return (
    <DocumentProvider issue={issue} resource={resource}>
      <DocumentContent />
    </DocumentProvider>
  );
}

function DocumentContent() {
  const { meta: { issue, resource } } = useDocument();
  return (
    <div className="flex min-w-0 flex-1 flex-col" data-document={resource.id}>
      <DocumentHeader />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[854px] px-6 py-16 text-[15px]">
          <DocumentIcon resource={resource} issue={issue} />
          {resource.showAuthors && (
            <p className="mb-2 text-[12px] text-fg-3" data-document-author>
              {resource.editedBy?.name ?? resource.owner?.name ?? ME.name}
            </p>
          )}
          <DocumentTitle />
          <DocumentBody />
        </div>
      </div>
    </div>
  );
}

function DocumentTitle() {
  const { state: { draft }, actions: { update, endSession } } = useDocument();
  const titleInput = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = titleInput.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
      input.scrollTop = 0;
    };
    resize();
    let width = -1,
      frame = 0;
    // Observe width only and resize outside the observer delivery, avoiding height feedback.
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next === undefined || next === width) return;
      width = next;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(resize);
    });
    if (input.parentElement) observer.observe(input.parentElement);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The title's text changes its height, so a new title resizes the input.
  }, [draft.title]);
  return (
    <textarea
      ref={titleInput}
      rows={1}
      autoFocus={!draft.title}
      aria-label="Document title"
      placeholder="New document"
      value={draft.title}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          document.getElementById("resource-document")?.focus();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.blur();
        }
      }}
      onChange={(event) => update({ title: event.target.value.replace(/[\r\n]+/g, " ") })}
      onBlur={endSession}
      className="mb-6 block w-full resize-none overflow-hidden bg-transparent text-[24px] leading-[32px] tracking-[-0.16px] [font-variation-settings:'opsz'_32] font-semibold outline-none"
    />
  );
}

function DocumentBody() {
  const {
    state: { draft, revision },
    actions: { update, endSession, mergeLateMedia },
    meta: { issue, resource },
  } = useDocument();
  return (
    <DocumentBodyEditor
      key={revision}
      id="resource-document"
      scope={`${issue.key}:document:${resource.id}`}
      onLateMedia={mergeLateMedia}
      initial={draft.body}
      label="Document content"
      placeholder="Write something…"
      issueKey={issue.key}
      attachments={issue.attachments}
      onFiles={(files) => addIssueFiles(issue.key, files)}
      onChange={(body) => update({ body })}
      onBlur={endSession}
    />
  );
}

function DocumentHeader() {
  const {
    state: { draft },
    actions: { endSession: flush, duplicate },
    meta: { issue, resource },
  } = useDocument();
  const favorite = useStore((s) => s.favorites.includes(`document:${resource.id}`));
  const [deleting, setDeleting] = useState(false),
    [options, setOptions] = useState<HTMLElement | null>(null),
    [metadata, setMetadata] = useState<HTMLElement | null>(null),
    [people, setPeople] = useState<{ anchor: HTMLElement; kind: "owner" | "subscribers" } | null>(
      null,
    ),
    [history, setHistory] = useState(false),
    [reminding, setReminding] = useState<"presets" | "custom" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const restoreHeaderFocus = () =>
    requestAnimationFrame(() =>
      root.current?.querySelector<HTMLButtonElement>('[aria-label="Document options"]')?.focus(),
    );
  const title = draft.title || "New document",
    url = documentURL(issue, resource.id);
  const markdown = () => `# ${draft.title || "New document"}\n\n${adfToMarkdown(draft.body)}`;
  const copy = async (kind: "url" | "title" | "link" | "markdown") => {
    try {
      await navigator.clipboard.writeText(
        kind === "url"
          ? url
          : kind === "title"
            ? title
            : kind === "link"
              ? `[${title.replace(/[[\]\\]/g, "\\$&")}](${url})`
              : markdown(),
      );
      set({
        perf: `Copied document ${kind === "markdown" ? "content as Markdown" : kind === "link" ? "title as link" : kind}`,
      });
    } catch {
      set({ perf: "Could not access the clipboard" });
    }
  };
  const latestCopy = useRef(copy);
  latestCopy.current = copy; // shortcuts copy the live draft title and body
  const rename = () =>
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Document title"]');
      input?.focus();
      input?.select();
    });
  const download = () => {
    const blob = new Blob([markdown()], { type: "text/markdown;charset=utf-8" }),
      href = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = href;
    a.download = `${title.replace(/[/\\:*?"<>|\u0000-\u001f]/g, "-")}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 60000);
  };
  const reminders: ActionEntry[] = [
    ...reminderPresets().map((preset) => ({
      name: preset.label,
      icon: "clock" as const,
      shortcut: reminderTime(preset.at),
      run: () => actions.remind(issue.key, preset.at, resource.id),
    })),
    { name: "Custom…", icon: "calendar", run: () => setReminding("custom") },
  ];
  const entries: ActionEntry[] = [
    { name: "Duplicate", icon: "copy", run: () => void duplicate() },
    { name: "Rename…", icon: "pencil", shortcut: "⇧R", run: rename },
    {
      name: favorite ? "Remove from favorites" : "Favorite",
      icon: favorite ? "starred" : "star",
      divider: true,
      shortcut: "⌥F",
      run: () => toggleFavorite(`document:${resource.id}`),
    },
    {
      name: "Copy",
      icon: "copy",
      children: [
        { name: "Copy URL", icon: "link", shortcut: "⌘⇧,", run: () => void copy("url") },
        { name: "Copy title", icon: "copy", shortcut: "⌘⇧'", run: () => void copy("title") },
        { name: "Copy title as link", icon: "link", shortcut: "⌘C", run: () => void copy("link") },
        {
          name: "Copy content as Markdown",
          icon: "file",
          shortcut: "⌘⌥C",
          run: () => void copy("markdown"),
        },
      ],
    },
    {
      name: "Download",
      icon: "download",
      children: [
        { name: "Download as markdown", icon: "file", run: download },
        { name: "Download as PDF", icon: "download", run: () => window.print() },
      ],
    },
    { name: "Remind me", icon: "clock", shortcut: "⇧H", children: reminders },
    {
      name: resource.showAuthors ? "Hide author names" : "Show author names",
      icon: "user",
      divider: true,
      shortcut: "⇧A",
      run: () =>
        actions.documentProperties(issue.key, resource.id, { showAuthors: !resource.showAuthors }),
    },
    {
      name: "Show document history",
      icon: "undo",
      run: () => {
        flush();
        setHistory(true);
      },
    },
    { name: "Delete", icon: "trash", danger: true, run: () => setDeleting(true) },
  ];
  useCommand("document-action", (name) => {
    if (!root.current?.closest("[data-document]")) return;
    if (name === "rename") rename();
    if (name === "remind") setReminding("presets");
    if (name === "favorite") toggleFavorite(`document:${resource.id}`);
    if (name === "authors")
      actions.documentProperties(issue.key, resource.id, { showAuthors: !resource.showAuthors });
    if (name.startsWith("copy-"))
      void latestCopy.current(
        (
          {
            "copy-url": "url",
            "copy-title": "title",
            "copy-link": "link",
            "copy-markdown": "markdown",
          } as const
        )[name as "copy-url"],
      );
    if (name === "subscribers") setPeople({ anchor: root.current!, kind: "subscribers" });
    return true;
  });
  const status = statusById(
    get().boards.find((b) => b.id === issue.board),
    issue.status,
  ) ?? { name: issue.status, category: "new" };
  return (
    <>
      <header
        ref={root}
        className="document-header flex h-11 shrink-0 items-center gap-1 border-b border-line px-3 text-[13px] text-fg-3"
      >
        <button
          aria-label="Back to issue"
          title={issue.summary}
          className={`${BUTTON} flex shrink-0 items-center gap-2`}
          onClick={() => navigate({ document: null })}
        >
          <StatusIcon status={status} />
          {issue.key}
        </button>
        <span aria-hidden>›</span>
        <Icon name="file" size={14} />
        <span className="min-w-0 truncate text-fg-2">{title}</span>
        <button
          role="switch"
          aria-label={favorite ? "Remove document from favorites" : "Add document to favorites"}
          aria-checked={favorite}
          className={`${BUTTON} ${favorite ? "text-[#f2c94c]" : ""}`}
          onClick={() => toggleFavorite(`document:${resource.id}`)}
        >
          <Icon name={favorite ? "starred" : "star"} size={15} />
        </button>
        <button
          aria-label="Document options"
          aria-haspopup="dialog"
          className={BUTTON}
          onClick={(e) => {
            flush();
            setOptions(e.currentTarget);
          }}
        >
          <Icon name="dots" />
        </button>
        <span className="min-w-0 flex-1" />
        <button
          aria-label={`Document display options and metadata; Edited ${new Date(resource.updated).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          title={`Edited by ${resource.editedBy?.name ?? resource.owner?.name ?? ME.name} at ${new Date(resource.updated).toLocaleString()}`}
          className={`${BUTTON} flex shrink-0 items-center gap-1`}
          onClick={(e) => setMetadata(e.currentTarget)}
        >
          <Icon name="display" size={14} />
          <span className="hidden sm:inline">
            Edited{" "}
            {new Date(resource.updated).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </button>
        <button aria-label="Copy document URL" className={BUTTON} onClick={() => void copy("url")}>
          <Icon name="link" />
        </button>
        <button
          aria-label="Change document subscribers"
          className={BUTTON}
          onClick={(e) => setPeople({ anchor: e.currentTarget, kind: "subscribers" })}
        >
          <Icon name="bell" />
        </button>
      </header>
      {options && (
        <ActionMenu
          anchor={options}
          entries={entries}
          label="Document options"
          close={() => setOptions(null)}
        />
      )}
      {reminding === "presets" && (
        <ActionMenu
          anchor={root.current?.querySelector<HTMLElement>('[aria-label="Document options"]')}
          entries={reminders}
          label="Remind me"
          close={() => setReminding((r) => (r === "presets" ? null : r))}
        />
      )}
      {reminding === "custom" && (
        <MenuSurface
          label="Remind me"
          anchor={
            root.current?.querySelector<HTMLElement>('[aria-label="Document options"]') ?? undefined
          }
          close={() => setReminding(null)}
          width={320}
        >
          <form
            className="p-2 text-[13px]"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("at");
              if (typeof value === "string" && Date.parse(value) > Date.now()) {
                actions.remind(issue.key, new Date(value).toISOString(), resource.id);
                setReminding(null);
              }
            }}
          >
            <label className="block">
              Custom reminder
              <input
                autoFocus
                name="at"
                aria-label="Custom reminder time"
                type="datetime-local"
                required
                className="mt-2 w-full rounded border border-line-2 bg-card p-2"
              />
            </label>
            <button className="mt-2 rounded bg-accent px-3 py-1 text-white">Set reminder</button>
          </form>
        </MenuSurface>
      )}
      {metadata && (
        <MenuSurface
          label="Document display options and metadata"
          anchor={metadata}
          close={() => setMetadata(null)}
          width={320}
        >
          <label className="flex items-center gap-2 p-2">
            <input
              type="checkbox"
              checked={!!resource.showAuthors}
              onChange={(e) =>
                actions.documentProperties(issue.key, resource.id, {
                  showAuthors: e.target.checked,
                })
              }
            />
            Show author names
          </label>
          <p className="px-2 pt-3 text-[12px] text-fg-3">Owned by</p>
          <button
            aria-label={`Owned by: ${resource.owner?.name ?? ME.name}. Change document owner`}
            className={`${BUTTON} w-full text-left`}
            onClick={(e) => {
              setMetadata(null);
              setPeople({ anchor: root.current ?? e.currentTarget, kind: "owner" });
            }}
          >
            {resource.owner?.name ?? ME.name}
          </button>
          <p className="p-2 text-[12px] text-fg-3">
            Last edit by {resource.editedBy?.name ?? resource.owner?.name ?? ME.name}
            <br />
            <time dateTime={resource.updated}>{new Date(resource.updated).toLocaleString()}</time>
          </p>
          <button
            className={`${BUTTON} w-full text-left`}
            onClick={() => {
              flush();
              setMetadata(null);
              setHistory(true);
            }}
          >
            Show document history
          </button>
        </MenuSurface>
      )}
      {people && (
        <DocumentPeople
          issue={issue}
          resource={resource}
          kind={people.kind}
          anchor={people.anchor}
          close={() => {
            setPeople(null);
            restoreHeaderFocus();
          }}
        />
      )}
      {history && (
        <DocumentHistory
          issue={issue}
          resource={resource}
          close={() => {
            setHistory(false);
            restoreHeaderFocus();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete "${title}"?`}
          detail="The document is removed from this issue. You can undo this."
          action="Delete"
          onConfirm={() => {
            setDeleting(false);
            flush();
            actions.removeResource(issue.key, resource.id);
            navigate({ document: null });
          }}
          close={() => setDeleting(false)}
        />
      )}
    </>
  );
}

function DocumentPeople({
  issue,
  resource,
  kind,
  anchor,
  close,
}: {
  issue: Issue;
  resource: IssueResource;
  kind: "owner" | "subscribers";
  anchor: HTMLElement;
  close: () => void;
}) {
  const issues = useStore((s) => s.issues),
    [query, setQuery] = useState("");
  const users = [
    ...new Map(
      [
        ME,
        ...(resource.subscribers ?? []),
        ...(resource.owner ? [resource.owner] : []),
        ...[...issues.values()].flatMap((i) => [
          ...(i.assignee ? [i.assignee] : []),
          ...(i.watchers ?? []),
        ]),
      ].map((user) => [user.id, user]),
    ).values(),
  ];
  return (
    <MenuSurface
      label={kind === "owner" ? "Change document owner" : "Change document subscribers"}
      anchor={anchor}
      close={close}
      width={280}
    >
      <Command loop>
        <Command.Input
          autoFocus
          placeholder={kind === "owner" ? "Change owner…" : "Change subscribers…"}
          aria-label={kind === "owner" ? "Find document owner" : "Find document subscribers"}
          value={query}
          onValueChange={setQuery}
          className={MENU_INPUT}
        />
        <Command.List className="p-1">
          <Command.Empty>No people found</Command.Empty>
          {users.map((user) => {
            const checked =
              kind === "owner"
                ? (resource.owner?.id ?? ME.id) === user.id
                : !!resource.subscribers?.some((u) => u.id === user.id);
            return (
              <Command.Item
                key={user.id}
                value={user.name}
                className={MENU_ITEM}
                onSelect={() => {
                  if (kind === "owner") {
                    actions.documentProperties(issue.key, resource.id, { owner: user });
                    close();
                  } else
                    actions.documentProperties(issue.key, resource.id, {
                      subscribers: checked
                        ? resource.subscribers?.filter((u) => u.id !== user.id)
                        : [...(resource.subscribers ?? []), user],
                    });
                }}
              >
                <input
                  type="checkbox"
                  aria-label={user.name}
                  tabIndex={-1}
                  checked={checked}
                  readOnly
                  className="pointer-events-none"
                />
                <span>{user.name}</span>
              </Command.Item>
            );
          })}
        </Command.List>
      </Command>
    </MenuSurface>
  );
}

const documentIcons = [
  "file",
  "layers",
  "list",
  "board",
  "calendar",
  "comment",
  "link",
  "pencil",
  "star",
  "check",
] as const;
// Linear's named icon palette (measured on the synthetic document, 2026-11-08); its icon art is Linear's own, so ours keeps the app icon set.
const iconColors = [
  ["Grey", "#bec2c8"],
  ["Dark Grey", "#95a2b3"],
  ["Purple", "#5e6ad2"],
  ["Teal", "#26b5ce"],
  ["Green", "#4cb782"],
  ["Yellow", "#f0bf00"],
  ["Orange", "#f2994a"],
  ["Pink", "#f7c8c1"],
  ["Red", "#eb5757"],
] as const;
const iconName = (resource: IssueResource) =>
  documentIcons.find((name) => name === resource.icon?.name) ?? "file";
function DocumentIcon({ resource, issue }: { resource: IssueResource; issue: Issue }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null),
    [tab, setTab] = useState<"icons" | "emojis">("icons"),
    [query, setQuery] = useState("");
  const color = resource.icon?.color ?? "#8b8b91",
    emoji = resource.icon?.name.startsWith("emoji:") ? resource.icon.name.slice(6) : null;
  const paint = (next: string) =>
    actions.documentProperties(issue.key, resource.id, {
      icon: { name: resource.icon?.name ?? "file", color: next },
    });
  const choose = (name: string) => {
    actions.documentProperties(issue.key, resource.id, { icon: { name, color } });
    setAnchor(null);
  };
  return (
    <>
      <button
        aria-label="Document icon"
        className="mx-1 mt-1.5 mb-3 grid size-6 place-items-center rounded hover:bg-hover"
        style={{ color }}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        {emoji ? (
          <span className="text-[18px]">{emoji}</span>
        ) : (
          <Icon name={iconName(resource)} size={18} />
        )}
      </button>
      {anchor && (
        <MenuSurface
          label="Choose document icon"
          anchor={anchor}
          close={() => setAnchor(null)}
          width={320}
        >
          <div className="mb-2 flex gap-1" role="tablist" aria-label="Icon type">
            {(["icons", "emojis"] as const).map((value) => (
              <button
                role="tab"
                aria-selected={tab === value}
                key={value}
                className={`${BUTTON} aria-selected:bg-sel`}
                onClick={() => {
                  setTab(value);
                  setQuery("");
                }}
              >
                {value === "icons" ? "Icons" : "Emojis"}
              </button>
            ))}
          </div>
          <input
            autoFocus
            aria-label="Search document icons"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={MENU_INPUT}
          />
          {tab === "icons" && (
            <div className="my-2 flex gap-2" aria-label="Icon color">
              {iconColors.map(([label, color]) => (
                <button
                  key={color}
                  aria-label={label}
                  title={label}
                  aria-pressed={resource.icon?.color === color}
                  className="size-5 rounded-full border border-transparent aria-pressed:border-fg"
                  style={{ background: color }}
                  onClick={() => paint(color)}
                />
              ))}
              <input
                type="color"
                aria-label="Set custom color"
                value={color}
                className="size-5 cursor-default rounded-full border-0 bg-transparent p-0"
                onChange={(event) => paint(event.target.value)}
              />
            </div>
          )}
          <div className="grid grid-cols-5 gap-1">
            {tab === "icons"
              ? documentIcons
                  .filter((name) => name.includes(query.toLowerCase()))
                  .map((name) => (
                    <button
                      key={name}
                      aria-label={`Use ${name} icon`}
                      className={`${BUTTON} grid h-10 place-items-center`}
                      onClick={() => choose(name)}
                    >
                      <Icon name={name} size={20} />
                    </button>
                  ))
              : emojiOptions
                  .filter(
                    (option) =>
                      !query ||
                      option.emoji.includes(query) ||
                      option.name.includes(query.toLowerCase()),
                  )
                  .map(({ emoji }) => (
                    <button
                      key={emoji}
                      aria-label={`Use ${emoji} emoji`}
                      className={`${BUTTON} text-[24px]`}
                      onClick={() => choose(`emoji:${emoji}`)}
                    >
                      {emoji}
                    </button>
                  ))}
          </div>
        </MenuSurface>
      )}
    </>
  );
}

function DocumentHistory({
  issue,
  resource,
  close,
}: {
  issue: Issue;
  resource: IssueResource;
  close: () => void;
}) {
  const current: DocumentRevision = {
    title: resource.title,
    body: normalizeDocument(resource.body),
    at: resource.updated,
    author: resource.editedBy ?? resource.owner ?? ME,
  };
  const versions = [current, ...[...(resource.history ?? [])].reverse()],
    [selected, setSelected] = useState(0),
    version = versions[selected] ?? current;
  return (
    <MenuSurface
      label={`History for ${resource.title || "New document"}`}
      close={close}
      width={1100}
    >
      <div className="mb-4 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-medium">
          History for {resource.title || "New document"}
        </h2>
        <button aria-label="Close document history" className={BUTTON} onClick={close}>
          <Icon name="close" />
        </button>
      </div>
      <div className="document-history-grid grid min-h-64 grid-cols-[minmax(0,1fr)_240px] gap-4">
        <div className="min-w-0">
          <h3 className="mb-4 text-[24px] font-semibold">{version.title || "New document"}</h3>
          <div aria-label="Document version content" className="rich-content">
            <Adf node={version.body} issueKey={issue.key} attachments={issue.attachments} />
          </div>
          <div className="mt-6 flex items-center justify-between gap-3 text-[12px] text-fg-3">
            <time dateTime={version.at}>{new Date(version.at).toLocaleString()}</time>
            <button
              disabled={selected === 0}
              aria-label={
                selected === 0
                  ? "This is the current version, you cannot restore it"
                  : "Restore this document version"
              }
              className={`${BUTTON} border border-line-2 disabled:opacity-40`}
              onClick={() => {
                actions.editResource(
                  issue.key,
                  resource.id,
                  { title: version.title, body: version.body },
                  undefined,
                  true,
                );
                close();
              }}
            >
              Restore
            </button>
          </div>
        </div>
        <div className="space-y-1 border-l border-line-2 pl-3" aria-label="Document versions">
          {versions.map((version, index) => (
            <button
              key={`${version.at}:${index}`}
              aria-pressed={index === selected}
              className={`${BUTTON} w-full text-left aria-pressed:bg-sel`}
              onClick={() => setSelected(index)}
            >
              <time dateTime={version.at}>{new Date(version.at).toLocaleString()}</time>
              {index === 0 && <span className="ml-2 text-[11px] text-fg-3">Current</span>}
              <span className="block text-[12px] text-fg-3">{version.author.name}</span>
            </button>
          ))}
        </div>
      </div>
    </MenuSurface>
  );
}
