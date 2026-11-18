/** What the fixture server (scripts/fixture-server.ts) accepts on its control endpoints, shared with the e2e harness. */
import type { Op } from "../src/shared/jira-ops";

/** `POST /__fixture`: resets the fake Jira. Every field left out resets to its default. */
export type FixtureSettings = Partial<{
  /** Jira accepts writes and uploads; without it every op answers 405 and none is recorded. */
  writable: boolean;
  /** Jira keeps field edits (summary, priority, assignee, labels, due, milestones), so the mirror reads them back. */
  jiraEdits: boolean;
  /** Jira keeps comments posted, edited and deleted from the app. */
  jiraComments: boolean;
  /** Jira accepts new issues. */
  createSuccess: boolean;
  /** Jira refuses ops of these kinds ("fields", "comment", "create", "weblink"...), fields ops naming these fields
   *  ("summary", "parent"), or "upload" for attachment uploads, with `refuseText`. */
  refuse: string[];
  refuseText: string;
  clientFailures: number;
  detailFailures: number;
  syncErrors: string[];
  syncingReads: number;
  streaming: number;
  includeMedia: boolean;
  mediaInComment: boolean;
  mediaFailure: number;
  contentFailure: number;
  unmappedMedia: boolean;
  mediaDelay: number;
  mediaVariant: string;
  threadedComments: boolean;
  distinctCreator: boolean;
  subtask: boolean;
  epics: boolean;
  crossLinks: boolean;
  bulk: number;
  bulkVariety: number;
  sharedBoards: boolean;
  history: Record<string, unknown[]>;
  historyDelay: number;
  smartLinks: boolean;
  pullRequests: boolean;
  pullRequestDelay: number;
  /** The site's catalog in `/api/options`, beyond the values the issues hold. `versions` are project TEST's fix versions
   *  (Linear's milestones), with ids "10000", "10001"... in order. */
  catalog: Partial<{ priorities: string[]; labels: string[]; users: string[]; versions: string[] }>;
  inboxExtra: number;
  inboxExtraUnread: boolean;
  inboxRichOutside: boolean;
  inboxFail: boolean;
  inboxDelay: number;
  inboxWriteDelays: number[];
}>;

/** `POST /__fixture/refuse`: turns Jira's refusals on or off mid-test (see `refuse` above). */
export type Refusal = { refuse?: string[]; refuseText?: string };

/** `POST /__fixture/retry`: the next `count` op sends answer 503 `retry`, as the server does when Jira didn't answer.
 *  `applied`: Jira made the change anyway and only its answer was lost, so the resend must not make it twice. */
export type Unanswered = { count: number; applied?: boolean };

/**
 * `POST /__fixture/jira`: someone changes an issue in Jira, and the server tells open tabs ("changed"), as its poll does.
 * An unknown `key` with a `summary` is a new issue made in Jira. Answers `{ commentId }` when it added a comment.
 */
export type JiraChange = {
  key: string;
  summary?: string;
  /** A status id: "backlog", "todo", "doing", "review" or "done". */
  status?: string;
  priority?: string;
  /** A person id ("alex", "priya", "audit-me"), or null to unassign. */
  assignee?: string | null;
  labels?: string[];
  /** Plain text (blank lines split paragraphs) or an ADF document. */
  description?: string | object;
  /** A comment someone else posts in Jira; `author` defaults to "Alex". */
  comment?: { body: string; author?: string };
  /** Deletes the comment with this id. */
  deleteComment?: string;
  /** Deletes the issue (and its subtasks) in Jira. */
  delete?: boolean;
  /** The server hasn't polled the change yet: open tabs aren't told, so an edit they make starts from the old copy. */
  unseen?: boolean;
};

/** `POST /__fixture/inbox`: a new notification lands in Jira's bell as its issue's group head. */
export type InboxPush = {
  n: number;
  key: string;
  title: string;
  type?: string;
  message: string;
  category?: "direct" | "watching";
  read?: boolean;
  /** Who acted, when not the message's first word. */
  actor?: string;
  comment?: string;
  commentId?: string;
};

/** One write the app sent to Jira: the ops for one issue, as `GET /__fixture` lists them. */
export type JiraWrite = { key: string; ops: Op[] };
/** One request the fixture answered, as `GET /__fixture` lists them. */
export type FixtureRequest = { method: string; path: string; status: number };
/** One file Jira received from the app, as `GET /__fixture` lists them. */
export type FixtureUpload = { key: string; id: string; mediaId: string; name: string; type: string; size: number; client?: string };
