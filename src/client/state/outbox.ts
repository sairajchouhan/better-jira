import { type Full, type Issue } from "@/shared/issue-model";
import { DESCRIPTION_CONFLICT, mergeOps, opsFor, renameCommentIds, namesKey, renameIds, type Op, type Side } from "@/shared/jira-ops";
import { withoutLocalMedia } from "./jira-media";
import type { LocalChange } from "./local-data";


/**
 * The Jira write outbox: the user's edits that Jira doesn't have yet.
 *
 * Changes go in (`queue`, then `flush`); the outbox turns them into one job per issue, merges a job's later edits into it
 * while it waits, orders creates before the writes that name them, holds status changes and comment deletes, sends one
 * job at a time, retries what Jira couldn't settle with backoff, follows new issues to the keys Jira gives them, and
 * waits for (or takes over) issues other tabs are creating. What happens comes out through `OutboxEvents`.
 *
 * Seams: the server's write route, time, and the saved data and lock this browser's tabs share are passed in
 * (`OutboxPorts`). The store passes the browser's; tests pass fakes.
 */

/** `hold`: a status change waits until then, so rapid changes reach Jira as one transition (R2-issue-fields-D13). */
type Job = {
  key: string;
  board: number;
  ops: Op[];
  started?: boolean;
  cancelled?: boolean;
  hold?: number;
  /** Jira couldn't tell yet whether an earlier send went through: tries so far, and when to send it again. */
  tries?: number;
  retryAt?: number;
};
/** The server's answer to a write. */
export type WriteResult = {
  error?: string;
  key?: string;
  created?: Record<string, string>;
  others?: Issue[];
  issue?: Issue | null;
  full?: Full | null;
};
/** A write Jira answered. `created`: app ids (the issue's key, new comment ids) → Jira's; `refused`: a create Jira refused;
 *  `describes`: the write carried a description. */
export type Answer = {
  key: string;
  ops: Op[];
  result: WriteResult;
  created: Map<string, string>;
  refused: boolean;
  describes: boolean;
};
export type OutboxPorts = {
  /** `POST /api/issues/:key/ops`. Rejects when the server can't be reached; a 503 means Jira couldn't settle the write yet. */
  post(key: string, body: object): Promise<Response>;
  /** Uploads the files a job places and returns the ops to send (jira-media's prepareOps). Rejects if an upload fails. */
  prepare(key: string, ops: Op[]): Promise<Op[]>;
  clock: {
    now(): number;
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(timer: unknown): void;
  };
  tabs: {
    /** This tab, as saved changes and tab locks name it. */
    id: string;
    /** The saved data every tab shares; undefined when there is none. */
    stored(): Promise<{ keys: Record<string, string>; created: Set<string> } | undefined>;
    /** Saves this tab's own edits, and waits for the save. */
    save(): Promise<void>;
    /** Runs `fn` holding the browser-wide outbox lock, with the ids of the tabs still open. Absent without Web Locks. */
    exclusive?: (fn: (live: Set<string>) => Promise<void>) => Promise<void>;
    /** Takes the saved changes of closed tabs (`only` these keys) for this tab; returns the keys taken and the saved changes. */
    claim(
      live: Set<string>,
      only?: Set<string>,
    ): Promise<{ claimed: Set<string>; changes: LocalChange[] }>;
  };
};
export type OutboxEvents = {
  /** The number of queued writes changed. */
  pending(count: number): void;
  /** A status line for the footer. */
  status(text: string): void;
  /** Jira couldn't settle `key`'s write; it goes again later. `shown`: it has failed often enough to show as an error. */
  retrying(key: string, text: string, shown: boolean): void;
  /** A job of only attachment changes left nothing to send: its files were uploaded before they were placed. */
  uploadsOnly(key: string): void;
  answered(answer: Answer): void;
  /** Another tab saved the Jira key of an issue it created. */
  moved(from: string, to: string): void;
  /** Another tab discarded an issue it was creating (or Jira refused it): its edits here go with it. */
  discarded(key: string): void;
  /** A closed tab's create, now this tab's to send: show the saved copy and `queue` it. */
  takeOver(change: LocalChange): void;
};

// ponytail: fixed backoff (5 s doubling to 1 min) and error after 4 tries; tune if outages need other pacing.
const RETRY_WAIT = 5000,
  RETRY_WAIT_MAX = 60_000,
  RETRY_SHOWN = 4,
  UNREACHABLE_WAIT = 5000;
// ponytail: fixed 400 ms debounce on status writes; tune if single status edits must settle faster.
const STATUS_HOLD = 400;
/**
 * Jira can't restore a deleted comment's id, time or thread, so a comment delete waits out the undo window and ⌘Z
 * simply cancels it, leaving the comment where it was (R1-D16). The comment is hidden locally meanwhile.
 */
const COMMENT_UNDO_WINDOW = 8000;

// ponytail: the outbox lives in memory; closing the tab with writes pending is guarded by beforeunload only.
export function createOutbox(ports: OutboxPorts, events: OutboxEvents) {
  const { clock, tabs } = ports;
  const sleep = (ms: number) => new Promise<void>((resolve) => clock.setTimeout(resolve, ms));
  const outbox: Job[] = [];
  /** App ids (new issue keys, new comment ids) that Jira has since replaced. Kept apart: comment ids are plain numbers. */
  const jiraKeys = new Map<string, string>(),
    jiraComments = new Map<string, string>();
  const heldDeletes = new Map<string, unknown>();
  /** Which open tab sends each saved change (absent: this tab). */
  const owners = new Map<string, string>();
  /** Issues another open tab made and is still creating in Jira, with that tab's id: edits here wait for the Jira key it gets. */
  const othersCreating = new Map<string, string>();
  const currentKey = (key: string) => jiraKeys.get(key) ?? key;
  const drop = (key: string) => {
    for (let i = outbox.length - 1; i >= 0; i--) if (outbox[i]!.key === key) outbox.splice(i, 1);
  };

  function holdCommentDeletes(key: string, board: number | undefined, ops: Op[]): Op[] {
    if (board === undefined) return ops;
    return ops.filter((op) => {
      if (op.op === "comment" && heldDeletes.has(op.ref)) {
        clock.clearTimeout(heldDeletes.get(op.ref));
        heldDeletes.delete(op.ref);
        return false;
      }
      if (op.op !== "comment.delete") return true;
      clock.clearTimeout(heldDeletes.get(op.id));
      heldDeletes.set(
        op.id,
        clock.setTimeout(() => {
          heldDeletes.delete(op.id);
          outbox.push({ key: currentKey(key), board, ops: [op] });
          flush();
        }, COMMENT_UNDO_WINDOW),
      );
      return false;
    });
  }

  /** Whether `job` is for, or names, an issue another tab is still creating in Jira. */
  const waitsForCreate = (job: Job) =>
    othersCreating.size > 0 &&
    [...othersCreating.keys()].some(
      (key) => currentKey(job.key) === key || namesKey(job.ops, key),
    );

  function learnKeys(keys: Record<string, string> = {}) {
    let learned = false;
    for (const [from, to] of Object.entries(keys))
      if (!jiraKeys.has(from)) {
        jiraKeys.set(from, to);
        learned = true;
        events.moved(from, to);
      }
    return learned;
  }

  /**
   * Waits for the tabs creating issues this tab's jobs name: takes up the Jira keys they saved; sends a create itself once
   * its tab has closed; and lets go of an issue its tab discarded (sync check 7, sync review 3).
   */
  async function waitForCreators() {
    const stored = await tabs.stored().catch(() => undefined);
    if (!stored) {
      othersCreating.clear();
      return;
    }
    learnKeys(stored.keys);
    for (const key of othersCreating.keys())
      if (jiraKeys.has(key)) othersCreating.delete(key);
      else if (!stored.created.has(key)) {
        // Discarded in the tab that made it (or Jira refused the create): its edits here go with it.
        othersCreating.delete(key);
        drop(key);
        events.discarded(key);
      }
    if (othersCreating.size && tabs.exclusive) {
      // This tab's own edits go into the saved copy first, so a create sent from that copy carries them.
      await tabs.save();
      await tabs.exclusive(async (live) => {
        const orphaned = new Set(
          [...othersCreating].flatMap(([key, tab]) => (live.has(tab) ? [] : [key])),
        );
        if (!orphaned.size) return;
        // Its tab closed before Jira had it. Exactly one open tab claims it and sends the create (sync review 2-3).
        const { claimed, changes } = await tabs.claim(live, orphaned);
        for (const key of orphaned) {
          const change = changes.find((c) => c.key === key);
          if (!claimed.has(key)) {
            // Another open tab claimed it: wait for that tab's create instead.
            if (change?.tab) othersCreating.set(key, change.tab);
            continue;
          }
          owners.delete(key);
          othersCreating.delete(key);
          drop(key);
          if (!change?.issue) continue;
          // The saved copy merges every tab's edits: the create carries them all, and this tab shows it. The create's
          // client id is the issue's, so if the closed tab's send did reach Jira this one gets the same issue back.
          events.takeOver(change);
          // First: jobs waiting on it (links, parents, ranks naming it) must find its Jira key (sync review 2-5).
          const index = outbox.findIndex((job) => job.key === key && job.ops[0]?.op === "create");
          if (index > 0) outbox.unshift(...outbox.splice(index, 1));
        }
      });
    }
    events.pending(outbox.length);
    if (othersCreating.size) {
      events.status(
        `Waiting for another tab to create ${[...othersCreating.keys()].join(", ")} in Jira…`,
      );
      await sleep(1000);
    }
  }

  /** An unreachable server means nothing reached Jira: the same ops go again until it answers. */
  async function reach(post: (ops: Op[]) => Promise<Response>, ops: Op[]) {
    for (;;)
      try {
        return await post(ops);
      } catch {
        events.status("Can't reach the better-jira server. Retrying the Jira write…");
        await sleep(UNREACHABLE_WAIT);
      }
  }
  let flushing = false,
    wake: (() => void) | undefined;
  /** Sends queued jobs one at a time until none is left. */
  async function run() {
    // A write made while the loop waits on a retry goes now.
    if (flushing) return wake?.();
    flushing = true;
    try {
      while (outbox.length) {
        // A job for an issue another tab is still creating waits for its Jira key; one Jira couldn't settle yet waits for
        // its retry, and its issue's later jobs behind it. Every other issue's jobs go on (sync review 3, 3-2).
        const now = clock.now(),
          cooling = new Set(
            outbox.flatMap((job) => (job.retryAt! > now ? [currentKey(job.key)] : [])),
          );
        const index = outbox.findIndex(
          (job) => !waitsForCreate(job) && !cooling.has(currentKey(job.key)),
        );
        if (index < 0) {
          if (outbox.some(waitsForCreate)) await waitForCreators();
          else {
            // The issue's later jobs, behind the one cooling, have no retry time of their own: they don't make the wait 0 ms.
            const next = Math.min(...outbox.map((job) => job.retryAt ?? Infinity));
            await new Promise<void>((resolve) => {
              wake = resolve;
              clock.setTimeout(resolve, Math.min(next - now, 1000));
            });
            wake = undefined;
          }
          continue;
        }
        if (index > 0) outbox.unshift(...outbox.splice(index, 1));
        const job = outbox[0]!;
        // Later status changes merge into a held job; the wait restarts with each.
        if (job.hold && job.hold > clock.now()) {
          await sleep(job.hold - clock.now());
          continue;
        }
        job.started = true;
        job.key = currentKey(job.key);
        job.ops = renameCommentIds(renameIds(job.ops, jiraKeys), jiraComments);
        // Files attach to an existing issue: create it first, then upload and attach in a follow-up job.
        const [first, ...rest] = job.ops;
        if (
          first?.op === "create" &&
          (rest.some((op) => op.op === "attachment.add") ||
            JSON.stringify(first).includes('"collection":"local"'))
        ) {
          const description = first.fields.description;
          job.ops = [
            {
              ...first,
              fields: {
                ...first.fields,
                ...(description ? { description: withoutLocalMedia(description) } : {}),
              },
            },
          ];
          outbox.splice(1, 0, {
            key: job.key,
            board: job.board,
            ops: [
              ...(description && JSON.stringify(description).includes('"collection":"local"')
                ? [{ op: "fields" as const, fields: { description } }]
                : []),
              ...rest,
            ],
          });
        }
        // A cancelled job (Restore mirrored Jira version) stops retrying instead of sending discarded edits (R2-D3).
        const post = async (ops: Op[]) =>
          job.cancelled
            ? Response.json({})
            : ports.post(job.key, {
                ops,
                board: job.board,
                // A later write for this issue re-reads it anyway: don't wait for Jira's copy twice (R2-create-D2).
                ...(ops.length && outbox.some((other) => other !== job && other.key === job.key)
                  ? { settle: false }
                  : {}),
                ...(job.tries ? { resend: true } : {}),
              });
        let result: WriteResult, ops: Op[] | undefined;
        try {
          ops = await ports.prepare(job.key, job.ops);
        } catch (e) {
          // An upload failed: fetch Jira's copy to roll back to.
          result = {
            error: e instanceof Error ? e.message : "Could not upload the file to Jira.",
          };
          try {
            result = { ...(await (await post([])).json()), error: result.error };
          } catch {}
        }
        // Files uploaded before they were placed leave nothing to send: no empty write for the next one to wait behind (R2-D10).
        // The issue's next write, or the property poll, brings Jira's attachment list.
        if (ops && !ops.length) {
          outbox.shift();
          if (job.ops.every((op) => op.op === "attachment.add" || op.op === "attachment.delete"))
            events.uploadsOnly(job.key);
          events.pending(outbox.length);
          continue;
        }
        if (ops) {
          const response = await reach(post, ops);
          // 503: Jira didn't answer, or can't tell yet whether an earlier send went through. The same job (same client ids)
          // goes again later, with backoff, behind other issues' writes; it is never dropped (sync review 2-2, 3-1, 3-2).
          if (response.status === 503) {
            const { error } = await response.json().catch(() => ({}));
            const text = error ?? "Jira didn't answer. The change will be sent again shortly.";
            job.tries = (job.tries ?? 0) + 1;
            job.retryAt =
              clock.now() + Math.min(RETRY_WAIT * 2 ** (job.tries - 1), RETRY_WAIT_MAX);
            events.retrying(job.key, text, job.tries >= RETRY_SHOWN);
            continue;
          }
          result = await response
            .json()
            .catch(() => ({ error: `Server returned ${response.status}` }));
        }
        outbox.shift();
        // A create Jira refused leaves nothing for its follow-up uploads to attach to.
        const refused = first?.op === "create" && !result!.created?.[job.key];
        if (refused) drop(job.key);
        const created = new Map(Object.entries(result!.created ?? {}));
        for (const [from, to] of created)
          if (from === job.key) jiraKeys.set(from, to);
          // A re-created comment's old Jira id still files the replies Jira kept under it: only writes already queued move to the new id (R1-D15).
          else if (from.startsWith("local-")) jiraComments.set(from, to);
          else
            for (const queued of outbox)
              queued.ops = renameCommentIds(queued.ops, new Map([[from, to]]));
        // A replayed create whose description edit met a changed Jira copy counts too, so the edit is kept (BJ-20).
        const describes =
          job.ops.some((op) => op.op === "fields" && op.fields.description !== undefined) ||
          !!result!.error?.includes(DESCRIPTION_CONFLICT);
        // A refused description stands in for the description edits still queued: they started from the refused text, so Jira would refuse them too.
        if (result!.error && describes)
          for (const queued of outbox)
            if (queued.key === job.key && !queued.started)
              queued.ops = queued.ops.flatMap((op): Op[] => {
                if (op.op !== "fields" || op.fields.description === undefined) return [op];
                const { description: _d, descriptionBase: _b, ...fields } = op.fields;
                return Object.keys(fields).length ? [{ op: "fields", fields }] : [];
              });
        events.answered({
          key: job.key,
          ops: job.ops,
          result: result!,
          created,
          refused,
          describes,
        });
      }
    } finally {
      flushing = false;
    }
  }
  /** Starts sending (or wakes a loop waiting on a retry). */
  function flush() {
    events.pending(outbox.length);
    void run();
  }

  return {
    /**
     * Queues each change's ops (see jira-ops' opsFor). Doesn't send: call `flush`. Returns the keys of changes that
     * queued no write and have none waiting, so no answer will ever settle them.
     */
    queue(changes: [string, Side, Side][], issues: Map<string, Issue>): string[] {
      // Creates go first, so other issues can name the new key; deletes last, so edits to related issues (cleared parents, links) land first.
      const order = (ops: Op[]) => (ops[0]?.op === "create" ? -1 : ops[0]?.op === "delete" ? 1 : 0);
      const jobs = changes
        .map(([key, before, after]) => ({
          key,
          board: (after.issue ?? before.issue)?.board,
          ops: opsFor(before, after, issues),
        }))
        .sort((a, b) => order(a.ops) - order(b.ops));
      // Jira detaches (or, for sub-tasks, deletes) the children of a deleted issue, and drops its links, itself (R1-D101).
      const deleted = new Set(
        jobs.filter((job) => job.ops[0]?.op === "delete").map((job) => job.key),
      );
      for (const job of jobs)
        if (deleted.size && !deleted.has(job.key)) {
          const parent = changes.find(([key]) => key === job.key)?.[1].issue?.parent;
          job.ops = job.ops.flatMap((op): Op[] => {
            if (op.op === "link" && op.remove && deleted.has(op.target)) return [];
            if (op.op !== "fields" || op.fields.parent !== null || !parent || !deleted.has(parent))
              return [op];
            const { parent: _, ...fields } = op.fields;
            return Object.keys(fields).length ? [{ op: "fields", fields }] : [];
          });
        }
      for (const job of jobs) job.ops = holdCommentDeletes(job.key, job.board, job.ops);
      for (const { key, board, ops } of jobs) {
        if (!ops.length || board === undefined) continue;
        // Ops naming an issue whose create is still queued must run after that create, so they never fold into an earlier job.
        const text = JSON.stringify(ops),
          afterCreate = outbox.some(
            (job) => job.key !== key && job.ops[0]?.op === "create" && text.includes(`"${job.key}"`),
          );
        const waiting = afterCreate
          ? undefined
          : outbox.findLast((job) => job.key === key && !job.started);
        const hold = ops.some((op) => op.op === "status") ? clock.now() + STATUS_HOLD : undefined;
        if (waiting) {
          waiting.ops = mergeOps(waiting.ops, ops);
          if (hold) waiting.hold = hold;
        } else {
          const job = { key, board, ops, ...(hold ? { hold } : {}) };
          // A create queued late (taken over from a closed tab) goes before the queued jobs naming it, so they get its Jira key (BJ-19).
          const naming =
            ops[0]?.op === "create"
              ? outbox.findIndex(
                  (other) => !other.started && JSON.stringify(other.ops).includes(`"${key}"`),
                )
              : -1;
          if (naming >= 0) outbox.splice(naming, 0, job);
          else outbox.push(job);
        }
      }
      return jobs.flatMap(({ key }) => (outbox.some((job) => job.key === key) ? [] : [key]));
    },
    flush,
    /** Queued writes, including one being sent. */
    pending: () => outbox.length,
    /** Whether a write for `key` is queued or being sent. */
    has: (key: string) => outbox.some((job) => job.key === key),
    /** Whether a create is queued or being sent. */
    creating: () => outbox.some((job) => job.ops[0]?.op === "create"),
    /** Whether closing the tab now would lose a write: one this tab must send, or a comment delete still held for undo.
     *  Jobs waiting on another tab's create are saved, and replayed by whichever tab sends that create. */
    unsent: () => outbox.some((job) => !waitsForCreate(job)) || heldDeletes.size > 0,
    /** Whether the comment's delete waits out the undo window (not in Jira yet). */
    holdsDelete: (id: string) => heldDeletes.has(id),
    holdsDeletes: () => heldDeletes.size > 0,
    /** Drops the issue's queued writes; one already being sent stops retrying (an unreachable server never got it). */
    cancel(key: string) {
      for (let i = outbox.length - 1; i >= 0; i--)
        if (outbox[i]!.key === key) {
          if (outbox[i]!.started) outbox[i]!.cancelled = true;
          else outbox.splice(i, 1);
        }
      events.pending(outbox.length);
    },
    /** Moves queued writes from an issue's app key to its Jira key. */
    rename(from: string, to: string) {
      const ids = new Map([[from, to]]);
      for (const job of outbox) {
        job.key = ids.get(job.key) ?? job.key;
        job.ops = renameIds(job.ops, ids);
      }
    },
    /** The key Jira gave an issue created here, or `key`. */
    currentKey,
    /** The first key an issue had in this session. */
    firstKey(key: string) {
      for (const [from, to] of jiraKeys) if (to === key) return from;
      return key;
    },
    /** App key → Jira key, for the saved data. */
    keys: () => Object.fromEntries(jiraKeys),
    /** Key moves read back from saved data at load: known, not news. */
    restoreKeys(keys: Record<string, string> = {}) {
      for (const [from, to] of Object.entries(keys)) jiraKeys.set(from, to);
    },
    /** Takes up key moves another tab saved (`moved` fires for each new one). Returns whether any was new. */
    learnKeys,
    /** The tab that sends `key`'s saved change. */
    tab: (key: string) => owners.get(key) ?? tabs.id,
    /** Edited here: this tab sends the change now. An issue another tab is creating stays that tab's to send, so two
     *  editing tabs never wait on each other (sync review 2-3). */
    touch(...keys: string[]) {
      for (const key of keys) if (!othersCreating.has(key)) owners.delete(key);
    },
    /** A saved change belongs to `tab`; `created`: that tab is creating the issue in Jira. */
    own(key: string, tab: string, created: boolean) {
      owners.set(key, tab);
      if (created) othersCreating.set(key, tab);
    },
    /** This tab takes the change over. */
    release(key: string) {
      owners.delete(key);
      othersCreating.delete(key);
    },
    /** Forgets every tab's claim; `othersOnly` keeps which tab sends what. */
    reset(othersOnly = false) {
      othersCreating.clear();
      if (!othersOnly) owners.clear();
    },
    /** Under the outbox lock, takes the saved changes of tabs that have closed and hands them to `fn`. */
    async claimClosed(fn: (claimed: Set<string>, changes: LocalChange[]) => Promise<void>) {
      await tabs.exclusive!(async (live) => {
        const { claimed, changes } = await tabs.claim(live);
        await fn(claimed, changes);
      });
    },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;
