import type { AdfDocument } from "./document";
import type { IssueResource } from "./issue-resource";

export const activityFields = [
  "status",
  "priority",
  "assignee",
  "labels",
  "due",
  "parent",
  "type",
] as const;
export type ActivityField = (typeof activityFields)[number] | "relation";

export type CommentState = {
  resolved?: boolean;
  subscribed?: boolean;
  reactions?: string[];
  body?: AdfDocument;
  updated?: string;
  deleted?: boolean;
};
export type ImageCrop = { x: number; y: number; width: number; height: number };
export type ImageComment = { id: string; text: string; author: string; at: string };
/** `src` keeps a non-local image's source so its comments still show it after the image leaves the document, as in Linear. */
export type MediaEdit = { crop?: ImageCrop; comments?: ImageComment[]; src?: string };
/** `at` is the group's time; `updated` is when the group was last edited. */
export type PropertyActivity = {
  id: string;
  field: ActivityField;
  before: unknown;
  after: unknown;
  actor: { id: string; name: string };
  at: string;
  updated?: string;
};

export type User = { id: string; name: string; avatar?: string };
export type Issue = {
  key: string;
  board: number;
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee: User | null;
  labels: string[];
  parent?: string;
  rank?: string;
  comments: number;
  updated: string;
  resolved: string | null;
  created?: string;
  creator?: User | null;
  due?: string | null;
  project?: { key: string; name: string } | null;
  description?: string;
  /** Every comment's text, for search (BJ-27). */
  commentText?: string;
  links?: string[];
  resources?: IssueResource[];
  commentStates?: Record<string, CommentState>;
  reminder?: { at: string; delivered?: boolean } | null;
  activity?: PropertyActivity[];
  relations?: { key: string; kind: string }[];
  milestones?: { id: string; name: string }[];
  prCount?: number;
  statusSince?: string;
  started?: string;
  watchers?: User[];
  watchersComplete?: boolean;
  /** Whether this Jira user watches the issue, from the mirror list; `watchers` wins once loaded (R2-issue-fields-D9). */
  watching?: boolean;
  estimate?: number;
  projectLead?: User | null;
  attachments?: {
    id: string;
    name: string;
    url: string;
    type: string;
    size: number;
    missing?: boolean;
    mediaId?: string;
  }[];
  reactions?: string[];
  mediaEdits?: Record<string, MediaEdit>;
  descriptionHistory?: { text: string; document?: AdfDocument; at: string }[];
};
export type Status = { id: string; name: string; category: string };
export type Column = { name: string; statuses: Status[] };
export type Board = {
  id: number;
  name: string;
  columns: Column[];
  /** Added in the app, so the sidebar can remove it (BJ-24). */
  removable?: boolean;
};
/** Raw Jira issue: { key, fields: { description, comment, reporter, created, ... } } */
export type Full = {
  key: string;
  fields: any;
  /** Jira remote links, read with the full record. */ remotelinks?: {
    url: string;
    title: string;
  }[];
  /** Jira's description the unsent local one started from, kept so a replay after reload can still refuse to overwrite a newer Jira text (R2-D2). */
  descriptionBase?: AdfDocument;
  /** A description Jira refused (someone else's newer text, or invalid content), with Jira's reason; kept until the person picks a version or edits again. */
  descriptionRejected?: AdfDocument;
  descriptionError?: string;
};
export type IssueDraft = Partial<
  Pick<
    Issue,
    | "board"
    | "status"
    | "assignee"
    | "priority"
    | "labels"
    | "project"
    | "milestones"
    | "due"
    | "parent"
    | "type"
    | "rank"
    | "attachments"
    | "resources"
  >
> & {
  description?: string;
  descriptionDoc?: AdfDocument;
  /** Make a copy: the composer starts with this title and saves with "Save copy". */
  title?: string;
  copy?: boolean;
  subIssues?: string[];
  /** Linear "Create related": link the new issue to this one in the same undo step. */ related?: {
    key: string;
    kind: "related" | "blocked" | "blocking" | "parent";
  };
  /** Names one submit of a composer: a second call with it (a double click before React re-renders) creates nothing. */
  submission?: string;
  /** "Create issue from selection" (BJ-69): the editor waiting to swap its selected text for a reference to the new issue. */
  fromSelection?: string;
};
export type JiraOptions = {
  priorities: { id: string; name: string }[];
  users: User[];
  labels: string[];
  versions: Record<string, { id: string; name: string }[]>;
  types?: Record<string, { name: string; hierarchyLevel: number }[]>;
};
