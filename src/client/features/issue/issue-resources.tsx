import { type Issue } from "@/shared/issue-model";
import { showNotification } from "@/client/state/app-notifications";
import { LoadingState } from "@/client/components/empty-state";
import { Text } from "@/client/components/text";
import { Dialog, ConfirmDialog } from "@/client/components/dialog";
import { Field, TextInput } from "@/client/components/field";
import { Button, IconButton } from "@/client/components/button";
import { SectionDisclosure } from "@/client/components/section-disclosure";
import { lazy, Suspense, useEffect, useState } from "react";
import { Icon } from "@/client/components/icons";
import { LinkIcon } from "@/client/components/link-icon";

import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { normalizeDocument } from "@/shared/document";
import { get, ME, set, useStore } from "@/client/state/store";
import { actions } from "@/client/state/issue-actions";
import { flushLocalChanges } from "@/client/state/local-database";
import { navigate, ui, placeURL } from "@/client/features/navigation/app-navigation";
import { AppLink } from "@/client/features/navigation/app-link";
import {
  issueResources,
  linkTitle,
  linkDescription,
  resourceURL,
  typedResourceURL,
  type IssueResource,
  type LinkPreview,
} from "@/shared/issue-resource";

const previewRequested = new Set<string>();
const resourceAge = (date: string) => {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(date)) / 60000),
  );
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}min ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : new Date(date).toLocaleDateString();
};
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

/** A link row's title, and beside it the unfurled page's description when Linear would show one. */
function LinkText({ resource }: { resource: IssueResource }) {
  const description = linkDescription(resource);
  return (
    <>
      <a
        href={resourceURL(resource.url ?? "") ?? undefined}
        target="_blank"
        rel="noreferrer"
        className={`min-w-0 truncate font-medium text-fg ${description ? "max-w-[60%] shrink-0" : "flex-1"}`}
      >
        {linkTitle(resource)}
      </a>
      {description && (
        <span data-link-description className="min-w-0 flex-1 truncate text-fg-3">
          {description}
        </span>
      )}
    </>
  );
}

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
      requestAnimationFrame(() =>
        document.getElementById("issue-options")?.focus(),
      );
    },
    [],
  );
  const [url, setURL] = useState(resource?.url ?? ""),
    [title, setTitle] = useState(resource?.title ?? ""),
    [error, setError] = useState("");
  const label = resource
    ? "Edit link"
    : kind === "link"
      ? "Add link"
      : "Add pull request";
  return (
    <Dialog label={label} close={close} width={480}>
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
          if (!added) showNotification({ text: "Already linked" });
          else if (kind === "link")
            showNotification({ text: "URL successfully linked." });
          close();
        }}
      >
        <Dialog.Header>
          <Dialog.Title>{resource ? label : `${label} to ${issue.key}`}</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
        <Field>
          <Field.Label className="mb-1 block">
            <Text variant="mini" color="muted">
              URL
            </Text>
          </Field.Label>
          <TextInput
            autoFocus={!resource}
            disabled={!!resource}
            aria-label="Link URL"
            placeholder={kind === "link" ? "https://…" : "Pull request URL"}
            value={url}
            onChange={(e) => setURL(e.target.value)}
            className="w-full"
          />
        </Field>
        <Field className="mt-3">
          <Field.Label className="mb-1 block">
            <Text variant="mini" color="muted">
              Title (optional)
            </Text>
          </Field.Label>
          <TextInput
            data-autofocus={resource ? true : undefined}
            aria-label="Link title"
            placeholder=""
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-2"
          />
        </Field>
        {error && (
          <Text
            role="alert"
            className="mt-2"
            as="p"
            variant="mini"
            color="inherit"
          >
            {error}
          </Text>
        )}
        </Dialog.Body>
        <Dialog.Footer>
          <Button
            type="button"
            onClick={close}
            variant="borderless"
            size="medium"
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="medium">
            {resource ? "Save" : label}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog>
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
  const resources = issueResources(issue);
  const remove = (resource: IssueResource) => {
    if (resource.id.startsWith("legacy:"))
      actions.patch(issue.key, {
        links: issue.links?.filter((url) => url !== resource.url),
      });
    else actions.removeResource(issue.key, resource.id);
    setOptions(null);
    setRemoving(null);
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>(
          '[aria-label="Add resource to issue"]',
        ) ?? document.getElementById("issue-options")
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
          .then((response) =>
            response.ok ? response.json() : Promise.reject(),
          )
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
          { name: "Delete", icon: "trash", run: () => setRemoving(resource) },
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
            run: () => setRemoving(resource),
          },
        ];
  return (
    <section aria-label="Resources" className="issue-resources">
      <SectionDisclosure expanded={!collapsed} onExpandedChange={(open) => setCollapsed(!open)}>
        <div className="-ml-1.5 flex items-center pr-2 text-fg-3">
          <SectionDisclosure.Trigger label="Resources" />
          <span className="flex-1" />
          <IconButton
            label="Add resource to issue"
            aria-expanded={!!menu}
            onClick={(e) => setMenu(e.currentTarget)}
            variant="borderless"
            size="medium"
          >
            <Icon name="plus" />
          </IconButton>
        </div>
        <SectionDisclosure.Panel>
          {resources.map((resource) => (
            <div
              key={resource.id}
              onContextMenu={(event) => {
                event.preventDefault();
                setOptions({
                  anchor:
                    event.currentTarget.querySelector<HTMLElement>(
                      '[aria-label^="Options for "]',
                    ) ?? event.currentTarget,
                  resource,
                  point: { x: event.clientX, y: event.clientY },
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
              {/* Text has no anchor/time element variant; preserve native link and timestamp semantics. */}
              {resource.kind === "document" ? (
                <AppLink
                  data-resource-id={resource.id}
                  to={{ board: issue.board, selected: issue.key, document: resource.id, panel: true }}
                  className="min-w-0 flex-1 truncate font-medium text-fg"
                >
                  {resource.title || "New document"}
                </AppLink>
              ) : (
                <LinkText resource={resource} />
              )}
              <time
                aria-label={`Updated at ${new Date(resource.updated).toLocaleString()}`}
                dateTime={resource.updated}
                title={new Date(resource.updated).toLocaleString()}
                className="ml-auto text-fg-3"
              >
                {resourceAge(resource.updated)}
              </time>
              <IconButton
                label={`Options for ${resource.title || "New document"}`}
                className="-ml-1 shrink-0 opacity-0 group-hover/resource:opacity-100 focus:opacity-100 aria-expanded:opacity-100"
                aria-expanded={options?.resource.id === resource.id}
                onClick={(e) => setOptions({ anchor: e.currentTarget, resource })}
                variant="borderless"
                size="small"
              >
                <Icon name="dots" size={14} />
              </IconButton>
            </div>
          ))}
        </SectionDisclosure.Panel>
      </SectionDisclosure>
      {menu && (
        <ActionMenu
          label="Add resource"
          anchor={menu}
          highlight="first"
          close={() => setMenu(null)}
          entries={[
            { name: "Add link…", icon: "link", run: () => setForm("link") },
            {
              name: "Link pull request…",
              icon: "branch",
              run: () => setForm("pull-request"),
            },
            {
              name: "Add document…",
              icon: "file",
              run: () => createIssueDocument(issue),
            },
          ]}
        />
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
          <ConfirmDialog
            title={`Delete "${removing.title || "New document"}"?`}
            description="The document is removed from this issue. You can undo this."
            confirmLabel="Delete"
            onConfirm={() => remove(removing)}
            close={() => setRemoving(null)}
          />
        ) : (
          <ConfirmDialog
            title="Remove this link from the issue?"
            description="You cannot undo this action."
            confirmLabel="Remove"
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
      {form && (
        <ResourceForm issue={issue} kind={form} close={() => setForm(null)} />
      )}
    </section>
  );
}
/** The document's own address, for copying and opening in a new tab. */
export function documentURL(issue: Issue, id: string) {
  return placeURL({ to: "issue", key: issue.key, document: id });
}

const Document = lazy(() =>
  import("@/client/routes/issue-document").then((module) => ({
    default: module.IssueDocument,
  })),
);
export function IssueDocument(props: { issue: Issue; id: string }) {
  return (
    <Suspense fallback={<LoadingState>Loading document…</LoadingState>}>
      <Document {...props} />
    </Suspense>
  );
}
