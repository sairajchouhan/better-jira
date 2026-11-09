import { lazy, Suspense, useEffect, useState } from "react";
import { Command } from "cmdk";
import { Icon } from "./icons";
import { Confirm, MenuSurface } from "./menu-surface";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { normalizeDocument } from "./document";
import {
  actions,
  flushLocalChanges,
  get,
  ME,
  navigate,
  set,
  ui,
  useStore,
  type Issue,
} from "./store";
import {
  linkTitle,
  resourceURL,
  typedResourceURL,
  type IssueResource,
  type LinkPreview,
} from "./issue-resource";

const previewRequested = new Set<string>();
/** A link's site icon, falling back to the link icon when it does not load. */
function LinkIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      data-link-icon
      alt=""
      src={src}
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-full object-contain"
    />
  ) : (
    <Icon name="link" />
  );
}

const resourceAge = (date: string) => {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}min ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : new Date(date).toLocaleDateString();
};
const BUTTON = "rounded px-2 py-1.5 text-[13px] text-fg-2 hover:bg-hover";
const INPUT =
  "w-full rounded border border-line-2 bg-transparent px-3 py-2 outline-none focus:border-accent";
export async function createIssueDocument(issue: Issue) {
  const id = crypto.randomUUID();
  actions.resource(issue.key, {
    id,
    kind: "document",
    title: "",
    updated: new Date().toISOString(),
    body: normalizeDocument(""),
    owner: { ...ME },
    editedBy: { ...ME },
    subscribers: [{ ...ME }],
  });
  await flushLocalChanges();
  if (get().selected !== issue.key || !get().panel) return;
  ui.send({ type: "overlay.close" });
  navigate({ selected: issue.key, panel: true, document: id });
}
/** With `resource`, edits its title like Linear's Edit… (the URL is read-only). */
export function ResourceForm({
  issue,
  kind,
  close,
  resource,
}: {
  issue: Issue;
  kind: "link" | "pull-request";
  close: () => void;
  resource?: IssueResource;
}) {
  useEffect(
    () => () => {
      requestAnimationFrame(() => document.getElementById("issue-options")?.focus());
    },
    [],
  );
  const [url, setURL] = useState(resource?.url ?? ""),
    [title, setTitle] = useState(resource?.title ?? ""),
    [error, setError] = useState("");
  const label = resource ? "Edit link" : kind === "link" ? "Add link" : "Add pull request";
  return (
    <MenuSurface label={label} close={close} width={480}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (resource) {
            actions.editResource(issue.key, resource.id, {
              title: title.trim() || resource.url || "",
            });
            close();
            return;
          }
          const href = typedResourceURL(url);
          if (!href) {
            setError("Enter an http or https URL");
            return;
          }
          const at = new Date().toISOString();
          const added = actions.resource(issue.key, {
            id: crypto.randomUUID(),
            kind,
            title: title.trim() || href,
            url: href,
            updated: at,
            created: at,
          });
          if (!added) ui.send({ type: "toast.show", text: "Already linked" });
          else if (kind === "link")
            ui.send({ type: "toast.show", text: "URL successfully linked." });
          close();
        }}
      >
        <h2 className="mb-4 font-medium">{resource ? label : `${label} to ${issue.key}`}</h2>
        <label className="mb-1 block text-[12px] text-fg-3">URL</label>
        <input
          autoFocus={!resource}
          disabled={!!resource}
          aria-label="Link URL"
          placeholder={kind === "link" ? "https://…" : "Pull request URL"}
          value={url}
          onChange={(e) => setURL(e.target.value)}
          className={INPUT}
        />
        <label className="mb-1 mt-3 block text-[12px] text-fg-3">Title (optional)</label>
        <input
          data-autofocus={resource ? true : undefined}
          aria-label="Link title"
          placeholder=""
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={`${INPUT} mt-2`}
        />
        {error && (
          <p role="alert" className="mt-2 text-[12px]">
            {error}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={close} className={BUTTON}>
            Cancel
          </button>
          <button type="submit" className={`${BUTTON} bg-accent text-white`}>
            {resource ? "Save" : label}
          </button>
        </div>
      </form>
    </MenuSurface>
  );
}
export function IssueResources({ issue }: { issue: Issue }) {
  useStore((s) => s.clock);
  const [collapsed, setCollapsed] = useState(false),
    [menu, setMenu] = useState<HTMLElement | null>(null),
    [options, setOptions] = useState<{
      anchor: HTMLElement;
      resource: IssueResource;
      point?: { x: number; y: number };
    } | null>(null),
    [form, setForm] = useState<"link" | "pull-request" | null>(null),
    [editing, setEditing] = useState<IssueResource | null>(null),
    [removing, setRemoving] = useState<IssueResource | null>(null);
  const resources: IssueResource[] = [
    ...(issue.resources ?? []),
    ...(issue.links ?? []).map((url) => ({
      id: `legacy:${url}`,
      kind: "link" as const,
      title: url,
      url,
      updated: issue.updated,
    })),
  ];
  const remove = (resource: IssueResource) => {
    if (resource.id.startsWith("legacy:"))
      actions.patch(issue.key, { links: issue.links?.filter((url) => url !== resource.url) });
    else actions.removeResource(issue.key, resource.id);
    setOptions(null);
    setRemoving(null);
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>('[aria-label="Add resource to issue"]') ??
        document.getElementById("issue-options")
      )?.focus(),
    );
  };
  const copy = async (resource: IssueResource) => {
    try {
      const url =
        resource.kind === "document"
          ? documentURL(issue, resource.id)
          : resourceURL(resource.url ?? "");
      if (!url) throw new Error();
      await navigator.clipboard.writeText(url);
      set({ perf: "Copied resource link" });
    } catch {
      set({ perf: "Could not copy resource link" });
    }
    setOptions(null);
  };
  // Unfurl links once (Linear shows the site icon, page description and title); a failed fetch retries next session.
  useEffect(() => {
    for (const r of issue.resources ?? [])
      if (
        r.kind !== "document" &&
        r.url &&
        r.preview === undefined &&
        !previewRequested.has(r.id)
      ) {
        previewRequested.add(r.id);
        void fetch(`/api/link-preview?url=${encodeURIComponent(r.url)}`)
          .then((response) => (response.ok ? response.json() : Promise.reject()))
          .then((preview: LinkPreview | null) =>
            actions.linkPreview(issue.key, r.id, preview ?? {}),
          )
          .catch(() => {});
      }
  }, [issue.key, issue.resources]);
  if (!resources.length && !menu && !options && !form && !editing) return null;
  // Linear's row menus (RAJ-52, 2026-11-07): links Open link / Copy link / Edit… / Remove…, documents Open document / Copy URL / Delete; both removals confirm.
  const entries = (resource: IssueResource): ActionEntry[] =>
    resource.kind === "document"
      ? [
          {
            name: "Open document",
            icon: "file",
            run: () => navigate({ document: resource.id, panel: true }),
          },
          { name: "Copy URL", icon: "link", run: () => void copy(resource) },
          { name: "Delete", icon: "trash", danger: true, run: () => setRemoving(resource) },
        ]
      : [
          {
            name: "Open link",
            icon: "external",
            run: () => {
              const url = resourceURL(resource.url ?? "");
              if (url) window.open(url, "_blank", "noopener");
            },
          },
          { name: "Copy link", icon: "link", run: () => void copy(resource) },
          ...(resource.id.startsWith("legacy:")
            ? []
            : [
                {
                  name: "Edit…",
                  icon: "pencil" as const,
                  divider: true,
                  run: () => setEditing(resource),
                },
              ]),
          {
            name: "Remove…",
            icon: "trash",
            divider: true,
            danger: true,
            run: () => setRemoving(resource),
          },
        ];
  return (
    <section aria-label="Resources" className="issue-resources">
      <div className="-ml-1.5 flex items-center pr-2 text-fg-3">
        <button
          aria-label={collapsed ? "Expand resources section" : "Collapse resources section"}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
          className="mr-auto flex h-6 items-center gap-0.5 rounded-full pr-[13px] pl-1.5 text-[12px] font-medium text-fg-3 hover:bg-hover"
        >
          <span className={`grid size-4 place-items-center ${collapsed ? "" : "rotate-90"}`}>
            <Icon name="chevron" size={14} />
          </span>
          <span>Resources</span>
        </button>
        <button
          aria-label="Add resource to issue"
          aria-expanded={!!menu}
          onClick={(e) => setMenu(e.currentTarget)}
          className="grid size-7 place-items-center rounded-full bg-card text-fg-3 hover:bg-hover"
        >
          <Icon name="plus" />
        </button>
      </div>
      {!collapsed &&
        resources.map((resource) => (
          <div
            key={resource.id}
            onContextMenu={(event) => {
              event.preventDefault();
              setOptions({
                anchor:
                  event.currentTarget.querySelector<HTMLElement>('[aria-label^="Options for "]') ??
                  event.currentTarget,
                resource,
                point: { x: event.clientX + 4, y: event.clientY - 1 },
              });
            }}
            data-open={options?.resource.id === resource.id || undefined}
            className="resource-row group/resource"
          >
            {resource.kind === "link" ? (
              <LinkIcon src={resource.preview?.icon} />
            ) : (
              <Icon name={resource.kind === "document" ? "file" : "branch"} />
            )}
            {resource.kind === "document" ? (
              <a
                data-resource-id={resource.id}
                href={documentURL(issue, resource.id)}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  navigate({ document: resource.id, panel: true });
                }}
                className="min-w-0 flex-1 truncate font-medium text-fg"
              >
                {resource.title || "New document"}
              </a>
            ) : (
              <>
                <a
                  href={resourceURL(resource.url ?? "") ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className={`min-w-0 truncate font-medium text-fg ${resource.preview?.description ? "max-w-[60%] shrink-0" : "flex-1"}`}
                >
                  {linkTitle(resource)}
                </a>
                {resource.preview?.description && (
                  <span data-link-description className="min-w-0 flex-1 truncate text-fg-3">
                    {resource.preview.description}
                  </span>
                )}
              </>
            )}
            <time
              aria-label={`Updated at ${new Date(resource.updated).toLocaleString()}`}
              dateTime={resource.updated}
              title={new Date(resource.updated).toLocaleString()}
              className="ml-auto text-fg-3"
            >
              {resourceAge(resource.updated)}
            </time>
            <button
              aria-label={`Options for ${resource.title || "New document"}`}
              aria-expanded={options?.resource.id === resource.id}
              onClick={(e) => setOptions({ anchor: e.currentTarget, resource })}
              className="resource-options"
            >
              <Icon name="dots" size={14} />
            </button>
          </div>
        ))}
      {menu && (
        <MenuSurface label="Add resource" anchor={menu} close={() => setMenu(null)} width={240}>
          <Command loop>
            <Command.Input
              autoFocus
              placeholder="Filter…"
              aria-label="Find resource action"
              className="mb-2 w-full bg-transparent p-2 outline-none"
            />
            <Command.List>
              {(["link", "pull-request", "document"] as const).map((kind) => (
                <Command.Item
                  key={kind}
                  className={`${BUTTON} data-[selected=true]:bg-sel`}
                  onSelect={() => {
                    setMenu(null);
                    if (kind === "document") createIssueDocument(issue);
                    else setForm(kind);
                  }}
                >
                  {kind === "link"
                    ? "Add link…"
                    : kind === "document"
                      ? "Add document…"
                      : "Link pull request…"}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </MenuSurface>
      )}
      {options && (
        <ActionMenu
          label="Resource options"
          anchor={options.anchor}
          point={options.point}
          align="end"
          close={() => setOptions(null)}
          entries={entries(options.resource)}
        />
      )}
      {removing &&
        (removing.kind === "document" ? (
          <Confirm
            title={`Delete "${removing.title || "New document"}"?`}
            detail="The document is removed from this issue. You can undo this."
            action="Delete"
            onConfirm={() => remove(removing)}
            close={() => setRemoving(null)}
          />
        ) : (
          <Confirm
            title="Remove this link from the issue?"
            detail="You cannot undo this action."
            action="Remove"
            onConfirm={() => remove(removing)}
            close={() => setRemoving(null)}
          />
        ))}
      {editing && (
        <ResourceForm
          issue={issue}
          kind={editing.kind === "pull-request" ? "pull-request" : "link"}
          resource={editing}
          close={() => setEditing(null)}
        />
      )}
      {form && <ResourceForm issue={issue} kind={form} close={() => setForm(null)} />}
    </section>
  );
}
export function documentURL(issue: Issue, id: string) {
  const url = new URL(location.origin);
  url.searchParams.set("board", String(issue.board));
  url.searchParams.set("issue", issue.key);
  url.searchParams.set("document", id);
  return url.href;
}

const Document = lazy(() =>
  import("./issue-document").then((module) => ({ default: module.IssueDocument })),
);
export function IssueDocument(props: { issue: Issue; id: string }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-fg-3">
          Loading document…
        </p>
      }
    >
      <Document {...props} />
    </Suspense>
  );
}
