import { test as base, expect, type Page } from "@playwright/test";
import { personalJira } from "../scripts/personal-jira";

export { expect };

/** The issues this suite may change on cloudsairaj, both To Do tasks on the SAM1 board (board 1). Others run on SAM1-9. */
export const ISSUES = ["SAM1-6", "SAM1-8"] as const;
export type Key = (typeof ISSUES)[number];
/** Every comment the suite writes starts with this, so the put-back deletes only its own. */
export const COMMENT_TAG = "[real-jira suite]";

const issuePath = (key: string) => `/rest/api/3/issue/${key}`;
const ownsWrite = (path: string, init: RequestInit) =>
  ISSUES.some((key) => path === issuePath(key) || path.startsWith(`${issuePath(key)}/`)) ||
  (path === "/rest/agile/1.0/issue/rank" &&
    (JSON.parse(String(init.body)).issues as string[]).every((key) => (ISSUES as readonly string[]).includes(key)));

/** cloudsairaj over REST, writing only to this suite's issues. */
async function rest<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if ((init.method ?? "GET") !== "GET" && !ownsWrite(path, init))
    throw new Error(`refusing to write ${init.method} ${path}: not one of ${ISSUES.join(", ")}`);
  return personalJira<T>(path, init);
}

/** The plain text of an ADF node. */
const plain = (node: any): string => node?.text ?? (node?.content ?? []).map(plain).join("");

export type Comment = { id: string; text: string };
/** One history item from Jira's changelog: a field and what it went from and to. */
export type Change = { field: string; from: string | null; to: string | null };

/** What the suite can change on an issue, as Jira holds it. Rank is the issues ranked right before and after it. */
type IssueState = {
  summary: string;
  priority: { id: string; name: string } | null;
  status: { id: string; name: string };
  comments: Comment[];
  rank: { before: string | null; after: string | null };
};

async function readState(key: Key): Promise<IssueState> {
  const [{ fields }, comments, order] = await Promise.all([
    rest(`${issuePath(key)}?fields=summary,priority,status`),
    readComments(key),
    rest(`/rest/api/3/search/jql?jql=${encodeURIComponent("project = SAM1 ORDER BY Rank ASC")}&fields=summary&maxResults=100`),
  ]);
  const keys: string[] = order.issues.map((issue: any) => issue.key);
  const at = keys.indexOf(key);
  return {
    summary: fields.summary,
    priority: fields.priority ? { id: fields.priority.id, name: fields.priority.name } : null,
    status: { id: fields.status.id, name: fields.status.name },
    comments,
    rank: { before: keys[at - 1] ?? null, after: keys[at + 1] ?? null },
  };
}

async function readComments(key: string): Promise<Comment[]> {
  const { comments } = await rest(`${issuePath(key)}/comment?maxResults=100`);
  return comments.map((comment: any) => ({ id: String(comment.id), text: plain(comment.body) }));
}

/** Puts `key` back to `was`: only what differs, so an untouched issue gets no write. */
async function putBack(key: Key, was: IssueState) {
  const now = await readState(key);
  const known = new Set(was.comments.map((comment) => comment.id));
  for (const comment of now.comments)
    if (!known.has(comment.id) && comment.text.startsWith(COMMENT_TAG))
      await rest(`${issuePath(key)}/comment/${comment.id}`, { method: "DELETE" });
  const fields: Record<string, unknown> = {};
  if (now.summary !== was.summary) fields.summary = was.summary;
  if (now.priority?.id !== was.priority?.id) {
    if (!was.priority) throw new Error(`${key}: Jira can't clear a priority, so its empty priority can't be put back`);
    fields.priority = { id: was.priority.id };
  }
  if (Object.keys(fields).length) await rest(issuePath(key), { method: "PUT", body: JSON.stringify({ fields }) });
  if (now.status.id !== was.status.id) {
    const { transitions } = await rest(`${issuePath(key)}/transitions`);
    const back = transitions.find((transition: any) => transition.to.id === was.status.id);
    if (!back) throw new Error(`${key}: no transition back to ${was.status.name}`);
    await rest(`${issuePath(key)}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: back.id } }) });
  }
  // Another run may move a neighbour; the issue itself moved only when neither neighbour is still beside it.
  if (now.rank.before !== was.rank.before && now.rank.after !== was.rank.after) {
    const anchor = was.rank.before ? { rankAfterIssue: was.rank.before } : { rankBeforeIssue: was.rank.after };
    await rest("/rest/agile/1.0/issue/rank", { method: "PUT", body: JSON.stringify({ issues: [key], ...anchor }) });
  }
}

const sameState = (a: IssueState, b: IssueState) =>
  a.summary === b.summary &&
  a.priority?.id === b.priority?.id &&
  a.status.id === b.status.id &&
  a.comments.map((comment) => comment.id).join() === b.comments.map((comment) => comment.id).join() &&
  (a.rank.before === b.rank.before || a.rank.after === b.rank.after);

export type Jira = {
  /** The issue as Jira held it when the test began. */
  before(key: Key): IssueState;
  /** The issue as Jira holds it now. */
  now(key: Key): Promise<IssueState>;
  /** The issue's comments in Jira now, as plain text. */
  comments(key: Key): Promise<Comment[]>;
  /** Every changelog item Jira recorded on the issue since the test began, oldest first. */
  changes(key: Key): Promise<Change[]>;
  /** Someone renames the issue in Jira itself, not through the app. */
  renameInJira(key: Key, summary: string): Promise<void>;
};

/** `jira`: reads cloudsairaj back, and after each test (passed or not) closes the page, so the app sends nothing more, and
 *  puts this suite's issues back as they were, then checks Jira holds that. */
export const test = base.extend<{ jira: Jira }>({
  jira: [
    async ({ page }, use) => {
      const states = new Map<Key, IssueState>();
      const historyStart = new Map<Key, number>();
      for (const key of ISSUES) {
        states.set(key, await readState(key));
        historyStart.set(key, (await rest(`${issuePath(key)}/changelog?maxResults=1`)).total);
      }
      await use({
        before: (key) => states.get(key)!,
        now: readState,
        comments: readComments,
        async changes(key) {
          const items: Change[] = [];
          for (let startAt = historyStart.get(key)!, last = false; !last; ) {
            const answer = await rest(`${issuePath(key)}/changelog?startAt=${startAt}&maxResults=100`);
            for (const history of answer.values)
              for (const item of history.items) items.push({ field: item.field, from: item.fromString, to: item.toString });
            startAt += answer.values.length;
            last = answer.isLast || !answer.values.length;
          }
          return items;
        },
        async renameInJira(key, summary) {
          await rest(issuePath(key), { method: "PUT", body: JSON.stringify({ fields: { summary } }) });
        },
      });
      await page.close();
      for (const key of ISSUES) {
        const was = states.get(key)!;
        // A write the app sent just before the page closed can still land: put back again until Jira stays put.
        await expect
          .poll(async () => {
            await putBack(key, was);
            await new Promise((resolve) => setTimeout(resolve, 1500));
            return sameState(await readState(key), was);
          }, { message: `put ${key} back as it was`, timeout: 30_000, intervals: [0] })
          .toBe(true);
      }
    },
    { auto: true, timeout: 60_000 },
  ],
});

/** A run-unique suffix for the text a test writes. */
export const runId = () => `run ${Date.now().toString(36)}`;

export const saveStatus = (page: Page) => page.getByRole("status", { name: "Jira save status" });
export const issueTitle = (page: Page) => page.getByRole("textbox", { name: "Issue title" });
/** A card on the SAM1 board, in the column named for its status. */
export const card = (page: Page, key: string, title: string, column: string) =>
  page.getByRole("grid", { name: column }).getByRole("row", { name: `${key} ${title}`, exact: true });

/** Opens the SAM1 board and waits until it shows `key` as Jira holds it (the mirror polls Jira every few seconds, so it can
 *  still show a previous test's put-back on its way). Answers its card. */
export async function openBoard(page: Page, key: Key, state: IssueState) {
  await page.goto("/board/1/all");
  const row = card(page, key, state.summary, state.status.name);
  await expect(row).toBeVisible({ timeout: 20_000 });
  return row;
}

export async function openIssue(page: Page, key: Key, state: IssueState) {
  await (await openBoard(page, key, state)).getByText(state.summary, { exact: true }).click();
  await expect(issueTitle(page)).toHaveValue(state.summary);
}

/** Types a new title in the open issue and leaves the field, which saves it. */
export async function retitle(page: Page, title: string) {
  await issueTitle(page).fill(title);
  await issueTitle(page).press("Tab");
}
