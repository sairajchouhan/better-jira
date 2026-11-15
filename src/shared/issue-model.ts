import type { AdfDocument } from "./document";
import type { IssueResource } from "./issue-resource";
import type { Relation } from "./relations";
import type { PullRequest } from "./pull-requests";

export const activityFields = [
  "status",
  "priority",
  "assignee",
  "labels",
  "due",
  "parent",
  "type",
] as const;
/** Fields only Jira's history carries (BJ-13): Linear ones this app doesn't edit, and Jira-only ones ("field" is any other). */
export const historyFields = [
  "title",
  "description",
  "estimate",
  "cycle",
  "project",
  "epic",
  "milestone",
  "team",
  "component",
  "resolution",
  "flag",
  "attachment",
  "weblink",
  "field",
] as const;
export type ActivityField =
  | (typeof activityFields)[number]
  | "relation"
  | (typeof historyFields)[number];

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
/** Who made a change: a person, or an app (Jira Automation) whose name and avatar Jira gives. */
export type Actor = { id: string; name: string; avatar?: string; app?: boolean };
/** `at` is the group's time; `updated` is when the group was last edited. */
export type PropertyActivity = {
  id: string;
  field: ActivityField;
  before: unknown;
  after: unknown;
  actor: Actor;
  at: string;
  updated?: string;
  /** When this edit set its value. A later description edit moves the open group's `at` (where the row sits), never
   *  this, so Jira's changelog entry for the edit is still matched to it (#3). Absent on events from older builds. */
  made?: string;
};

export type User = { id: string; name: string; avatar?: string };
export type Issue = {
  key: string;
  /** Every configured board that holds the issue, in the sidebar's order; none for an issue only linked from one. Ask
   *  `onBoard` / `boardFor` (board-membership.ts), never index it. */
  boards: number[];
  summary: string;
  status: string;
  type?: string;
  priority?: string;
  assignee: User | null;
  labels: string[];
  parent?: string;
  /** Jira's hierarchy level of this issue's type (Initiative 2, Epic 1, Task 0, Sub-task -1); absent on fixture and local issues. */
  level?: number;
  /** Jira's hierarchy level of the parent's type, so an epic parent the mirror doesn't hold is still known (shared/epics.ts). */
  parentLevel?: number;
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
  /** Jira's title for a web link in `links`, by URL, where it has one beyond the URL. */
  linkTitles?: Record<string, string>;
  resources?: IssueResource[];
  commentStates?: Record<string, CommentState>;
  reminder?: { at: string; delivered?: boolean } | null;
  activity?: PropertyActivity[];
  relations?: Relation[];
  milestones?: { id: string; name: string }[];
  prCount?: number;
  /** The state Jira's Development field summarises the PRs by (one PR's own state). */
  prStatus?: PullRequest["status"];
  statusSince?: string;
  started?: string;
  watchers?: User[];
  watchersComplete?: boolean;
  /** Whether this Jira user watches the issue, from the mirror list; `watchers` wins once loaded (R2-issue-fields-D9). */
  watching?: boolean;
  estimate?: number;
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
  /** The Jira project the board is located in (its configuration's `location`), so an empty board can still create. */
  project?: { key: string; name: string } | null;
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
  /** The board the new issue is made on. */
  board?: number;
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
  /** People the view's assignee filter names when it names several: the assignee picker lists them under Suggested
   *  (Linear's `filterOverrides.assignee.secondary`). Never saved to the issue. */
  suggestedAssignees?: User[];
  /** Epics the view's project filter names: the composer's project picker lists them first (Linear's
   *  `filterOverrides.project.secondary`). Never saved to the issue. */
  suggestedEpics?: string[];
};
export type JiraOptions = {
  priorities: { id: string; name: string }[];
  users: User[];
  labels: string[];
  versions: Record<string, { id: string; name: string }[]>;
  types?: Record<string, { name: string; hierarchyLevel: number }[]>;
};
