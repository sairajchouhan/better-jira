import { type Board, type Issue, type IssueDraft } from "@/shared/issue-model";
import { subIssueParent } from "@/shared/epics";
import { get, ME, issueBoard } from "@/client/state/store";
import { childrenByParent } from "./sub-issue-model";
import { discardLateMedia, documentHasMedia, normalizeDocument, type AdfDocument } from "@/shared/document";
import { adfToText } from "@/client/features/editor/adf";
import { statusType } from "@/shared/inbox-model";
import { createAssignee, type AutoAssignPreferences } from "@/shared/auto-assign";
import { savedAutomations } from "@/client/state/browser-preferences";
import { defaultChildType, defaultIssueType } from "@/shared/issue-properties";


/** Where one issue's inline sub-issue draft is kept across reloads. */
const subIssueDraftPrefix = (namespace: string) => `better-jira:sub-issue-draft:v1:${namespace}:`;
export const subIssueDraftKey = (namespace: string, parent: string) => `${subIssueDraftPrefix(namespace)}${parent}`;

/** Drops a deleted parent's inline sub-issue draft and cancels any late media still resolving for it. Returns whether a draft existed. */
export function removeSubIssueDraft(namespace: string, parent: string): boolean {
  discardLateMedia(`${parent}:sub-issue`);
  try {
    const draft = subIssueDraftKey(namespace, parent);
    if (localStorage.getItem(draft) === null) return false;
    localStorage.removeItem(draft);
    return true;
  } catch {
    return false;
  }
}

/** Drops stored sub-issue drafts whose parent issue no longer exists (e.g. deleted in Jira while the tab was closed). */
export function pruneSubIssueDrafts(namespace: string, liveKeys: { has(key: string): boolean }) {
  const prefix = subIssueDraftPrefix(namespace);
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (storageKey?.startsWith(prefix)) {
        const parent = storageKey.slice(prefix.length);
        if (parent && !liveKeys.has(parent)) stale.push(parent);
      }
    }
    for (const parent of stale) removeSubIssueDraft(namespace, parent);
  } catch {}
}

export type SubIssueDraft = {
  title: string;
  description: AdfDocument;
  files: NonNullable<Issue["attachments"]>;
  properties: IssueDraft;
};
/**
 * A new sub-issue's properties. Linear's `Issue.create` with a parent sets `priority = priority || parent.priority`
 * (startup-entry `w2.create`, `ye.priority=s||f.priority`), so the inline composer starts at the parent's priority
 * (R3-create-D10); the project is the parent's (`createSubIssue`: `project:n.project?.value`). The assignee is the
 * parent's only when that is you, or when every existing sub-issue (`children`) has it (`f.assignee===e?ye.assignee=e:
 * f.children.length>0&&f.children.elements.every(e=>e.assignee===f.assignee)`); else you with "Auto-assign to self" on (the
 * same `Issue.create`, right after: shared/auto-assign.ts), else none. The status follows the parent's state type (see
 * `subIssueStatus`).
 */
export const subIssueDefaults = (
  parent: Issue,
  board: Board,
  children: readonly Issue[] = [],
  automations: AutoAssignPreferences = savedAutomations(),
): IssueDraft => ({
  ...subIssueParent(parent),
  project: parent.project,
  assignee:
    parent.assignee &&
    ((!!ME.id && parent.assignee.id === ME.id) ||
      (children.length > 0 && children.every((child) => child.assignee?.id === parent.assignee!.id)))
      ? parent.assignee
      : (createAssignee(undefined, ME, automations) ?? null),
  priority: parent.priority,
  status: subIssueStatus(parent, board),
  labels: [],
});
/**
 * What every new sub-issue of `parent` starts with, wherever it is made: the inline composer, Create sub-issue (⌘⇧O) when it
 * opens the composer, New sub-issue from comment, and the composer's pending sub-issues. One path, so none of them skips the
 * status, priority or assignee Linear's `w2.create` gives an issue with a parent (BJ-232). A parent on no board the app holds
 * keeps only its link. Its type is the one Jira creates under `parent` (`defaultChildType`).
 */
export function newSubIssueDraft(parent: Issue): IssueDraft {
  const state = get(),
    board = parent.boards.length ? issueBoard(parent) : undefined;
  // The type Jira will create, so a sub-issue never shows Task until Jira answers (BJ-348).
  const type =
    defaultChildType(state, parent) ?? defaultIssueType(state.options.types?.[parent.project?.key ?? ""]);
  return {
    ...(board
      ? subIssueDefaults(parent, board, childrenByParent(state.issues).get(parent.key) ?? [])
      : { ...subIssueParent(parent), project: parent.project }),
    type,
  };
}
/**
 * A new sub-issue's status from its parent's state type, as Linear's `w2.create` with a parent: started, unstarted or
 * completed → the team's default unstarted state (`defaultActiveState`); triage → the triage state, else backlog;
 * backlog, canceled or duplicate → the default backlog state (`switch(f.state.type){case jo.started:case jo.unstarted:case
 * jo.completed:ye.state=ye.team.defaultActiveState;…}`). A status in a Backlog column is a backlog state, as the Backlog tab
 * reads it; a type the board has none of falls back to its first unstarted status.
 */
export function subIssueStatus(parent: Pick<Issue, "status">, board: Board): string | undefined {
  const typed = board.columns.flatMap((column) =>
    column.statuses.map((status) => ({
      id: status.id,
      type: /backlog/i.test(column.name) ? "Backlog" : statusType(status),
    })),
  );
  const first = (type: string) => typed.find((status) => status.type === type)?.id;
  const active = first("Unstarted") ?? board.columns[0]?.statuses[0]?.id;
  switch (typed.find((status) => status.id === parent.status)?.type) {
    case "Triage":
      return first("Triage") ?? first("Backlog") ?? active;
    case "Backlog":
    case "Canceled":
    case "Duplicate":
      return first("Backlog") ?? active;
    default:
      return active;
  }
}
/**
 * The next draft's properties after a create: ⌘↵ starts from the one just created (its status, priority, assignee and
 * labels), ⌘⇧↵ from the defaults. Linear's sub-issue composer: `n.shiftKey||…?l(Cm(t.team,h,t)):l(Cm(t.team,h,t,r))`, and
 * `createSubIssue` with a previous issue takes `assignee`, `labels`, `priority` and `state` from it.
 */
export const nextSubIssueProperties = (created: IssueDraft, defaults: IssueDraft, fromDefaults: boolean): IssueDraft =>
  fromDefaults
    ? defaults
    : {
        ...defaults,
        status: created.status,
        priority: created.priority,
        assignee: created.assignee,
        labels: created.labels,
      };
/** Whether the draft holds anything typed or attached, so closing it asks first and reopening keeps it. */
export const subIssueDraftFilled = ({ title, description, files }: SubIssueDraft) =>
  !!title.trim() || files.length > 0 || JSON.stringify(description).includes('"text"') || documentHasMedia(description);
/**
 * The draft a closed sub-issue composer reopens with (BJ-235). Linear's sub-issues section keeps the issue its composer made
 * last (IssueDetailsPaneSidebar `[re,C]=useState()`, set by `onCreate:e=>{C(e),…}` on ⌘↵ and ⌘⇧↵ alike) and mounts every new
 * composer from it (`ym`: `useState(()=>Cm(t.team,o,t,r))`); only Escape or Discard drops it (`oe=()=>{…,C(void 0)}`), while
 * collapsing the section closes the composer and keeps it. A draft with content comes back as it was (Linear's `localDraft`).
 */
export const reopenedSubIssueDraft = (
  draft: SubIssueDraft,
  previous: IssueDraft | undefined,
  defaults: IssueDraft,
): SubIssueDraft =>
  !previous || subIssueDraftFilled(draft)
    ? draft
    : { ...draft, properties: nextSubIssueProperties(previous, defaults, false) };
export const emptySubIssueDraft = (properties: IssueDraft): SubIssueDraft => ({
  title: "",
  description: normalizeDocument(""),
  files: [],
  properties,
});
export function readSubIssueDraft(key: string, initial: IssueDraft): SubIssueDraft {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value.title !== "string") return emptySubIssueDraft(initial);
    const properties: IssueDraft = { ...initial },
      saved = value.properties;
    if (saved && typeof saved === "object") {
      if (typeof saved.status === "string") properties.status = saved.status;
      if (typeof saved.priority === "string") properties.priority = saved.priority;
      if (saved.due === null || (typeof saved.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.due))) properties.due = saved.due;
      if (
        saved.assignee === null ||
        (saved.assignee &&
          typeof saved.assignee.id === "string" &&
          typeof saved.assignee.name === "string")
      )
        properties.assignee = saved.assignee;
      if (
        Array.isArray(saved.labels) &&
        saved.labels.every((label: unknown) => typeof label === "string")
      )
        properties.labels = saved.labels;
    }
    const files = Array.isArray(value.files)
      ? value.files
          .filter(
            (file: any) =>
              file &&
              typeof file.id === "string" &&
              typeof file.name === "string" &&
              typeof file.type === "string" &&
              Number.isFinite(file.size),
          )
          .map((file: any) => ({
            id: file.id,
            name: file.name,
            type: file.type,
            size: file.size,
            url: "",
          }))
      : [];
    return {
      title: value.title,
      description: normalizeDocument(value.description),
      files,
      properties,
    };
  } catch {
    return emptySubIssueDraft(initial);
  }
}
export function saveSubIssueDraft(key: string, value: SubIssueDraft) {
  const hasContent =
    !!value.title ||
    !!adfToText(value.description).trim() ||
    documentHasMedia(value.description) ||
    value.files.length;
  if (hasContent)
    localStorage.setItem(
      key,
      JSON.stringify({ ...value, files: value.files.map(({ url, ...file }) => file) }),
    );
  else localStorage.removeItem(key);
}
