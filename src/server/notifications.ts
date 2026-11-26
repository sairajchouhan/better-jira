/**
 * Jira's in-app notifications (the bell), through the Atlassian GraphQL gateway's `notifications` field.
 * Not in Atlassian's public docs: every GraphQL string lives in this file, so a field change is a one-file fix.
 * The gateway needs `collabContextRoutingAri` (the site's ARI) to find the feed; without it every feed reads empty.
 */
import { canWrite, jiraTimeouts } from "./jira";
import { GROUP_FIRST, GROUP_PAGE, groupPage, mapFeed, type InboxFeed, type InboxGroupPage } from "@/shared/inbox-model";
import { serverAuth } from "./server-config";

const PAGE = 50;
/** Jira gave no answer: the connection failed or timed out. A mark is the same however often it lands, so it can go again. */
export class NoAnswer extends Error {}
const answered = (request: Promise<Response>) =>
  request.catch((cause: unknown) => {
    throw new NoAnswer(`Jira didn't answer: ${String(cause)}`, { cause });
  });

async function gateway<T = any>(
  operationName: string,
  query: string,
  variables: object,
): Promise<T> {
  const { site, email, token } = serverAuth();
  if (/^\s*mutation/.test(query) && !canWrite(site))
    throw new Error(`Jira writes are disabled for ${site}.`);
  // A stalled gateway must fail like any Jira read, not leave the inbox loading forever.
  const ari = await routingAri();
  const res = await answered(fetch(`${site}/gateway/api/graphql`, {
    method: "POST",
    signal: AbortSignal.timeout(jiraTimeouts.request),
    headers: {
      Authorization: "Basic " + btoa(`${email}:${token}`),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName,
      query,
      variables: { ...variables, ari },
    }),
  }));
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.data)
    throw new Error(
      `Jira notifications ${operationName} → ${res.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`,
    );
  return body.data.notifications;
}

let ari: Promise<string> | undefined;
/** `ari:cloud:platform::site/<cloudId>`, read once from the site's public tenant info. */
function routingAri() {
  return (ari ??= (async () => {
    const { cloudId } = await (
      await answered(
        fetch(`${serverAuth().site}/_edge/tenant_info`, {
          signal: AbortSignal.timeout(jiraTimeouts.request),
        }),
      )
    ).json();
    if (!cloudId) throw new Error("Jira did not return a cloud ID");
    return `ari:cloud:platform::site/${cloudId}`;
  })().catch((error) => {
    ari = undefined;
    throw error;
  }));
}

/** One notification (`InfluentsNotificationItem`): a feed head or a group's notification. */
const NOTE = `notificationId timestamp readState category
          analyticsAttributes { key value }
          content {
            type message url
            actor { displayName avatarURL }
            entity { title url status }
            path { title url }
            bodyItems { document { format data } }
          }`;
const FEED = `query InboxFeed($ari: String, $first: Int, $after: String, $category: InfluentsNotificationCategory) {
  notifications {
    unseenNotificationCount(collabContextRoutingAri: $ari)
    notificationFeed(first: $first, after: $after, collabContextRoutingAri: $ari, filter: { categoryFilter: $category }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        groupId groupSize readStates
        additionalActors { displayName avatarURL }
        headNotification { ${NOTE} }
      }
    }
  }
}`;
/** Groups per gateway request: the gateway answers a request in about as long whatever it holds, so the groups go as
 *  parallel requests of six. Measured on a 28-group feed: one request 1.63–1.83 s, six-group requests 1.36–1.63 s
 *  (R4-inbox-D5). */
export const GROUP_CHUNK = 6;
/** The first page of every group with more than one notification (aliases, like `mark`): each row leads with Linear's
 *  main notification, and expanding the group shows the same page at once. A failed request only costs its groups: their
 *  rows fall back to Jira's newest, and each group reads its page when it is expanded. */
async function groupNotes(groups: string[]): Promise<Record<string, { nodes: unknown[]; pageInfo?: any }>> {
  const chunks: string[][] = [];
  for (let i = 0; i < groups.length; i += GROUP_CHUNK) chunks.push(groups.slice(i, i + GROUP_CHUNK));
  const read = await Promise.all(chunks.map(groupChunk));
  return Object.assign({}, ...read);
}
async function groupChunk(groups: string[]): Promise<Record<string, { nodes: unknown[]; pageInfo?: any }>> {
  const fields = groups
    .map(
      (_, i) =>
        `g${i}: notificationGroup(groupId: $g${i}, first: ${GROUP_FIRST}, collabContextRoutingAri: $ari) { pageInfo { hasNextPage endCursor } nodes { ${NOTE} } }`,
    )
    .join("\n");
  const vars = groups.map((_, i) => `$g${i}: String!`).join(", ");
  try {
    const data = await gateway(
      "InboxGroups",
      `query InboxGroups($ari: String, ${vars}) { notifications { ${fields} } }`,
      Object.fromEntries(groups.map((g, i) => [`g${i}`, g])),
    );
    return Object.fromEntries(
      groups.flatMap((g, i) => {
        const group = data?.[`g${i}`];
        return group ? [[g, { nodes: group.nodes ?? [], pageInfo: group.pageInfo }]] : [];
      }),
    );
  } catch (error) {
    console.error("[inbox] group notifications", String(error).slice(0, 200));
    return {};
  }
}

const GROUP = `query InboxGroup($ari: String, $group: String!, $first: Int, $after: String) {
  notifications {
    notificationGroup(groupId: $group, first: $first, after: $after, collabContextRoutingAri: $ari) {
      pageInfo { hasNextPage endCursor }
      nodes { ${NOTE} }
    }
  }
}`;
/** A row's notifications, newest first: the feed's first page (`GROUP_FIRST`), then five at a time as Jira's bell expands
 *  a group. */
export async function group(groupId: string, after?: string): Promise<InboxGroupPage> {
  const first = after ? GROUP_PAGE : GROUP_FIRST;
  const data = await gateway("InboxGroup", GROUP, { group: groupId, first, after: after ?? null });
  return groupPage(data.notificationGroup?.nodes, data.notificationGroup?.pageInfo, first);
}
/** Jira's bell tabs: Direct (assigned, mentioned, your issues) and Watching; no category is both. `after` is the previous page's cursor. */
export async function feed(category?: "direct" | "watching", after?: string): Promise<InboxFeed> {
  const data = await gateway("InboxFeed", FEED, {
    first: PAGE,
    after: after ?? null,
    category: category ?? null,
  });
  const page = data.notificationFeed?.pageInfo,
    nodes: any[] = data.notificationFeed?.nodes ?? [];
  const children = await groupNotes(
    nodes.filter((n) => n?.groupId && Number(n.groupSize) > 1).map((n) => String(n.groupId)),
  );
  const items = mapFeed(nodes, Object.fromEntries(Object.entries(children).map(([id, c]) => [id, c.nodes])));
  return {
    unseen: Number(data.unseenNotificationCount) || 0,
    items: items.map((item) => {
      const c = children[item.id];
      return c ? { ...item, group: groupPage(c.nodes, c.pageInfo, GROUP_FIRST) } : item;
    }),
    more: !!page?.hasNextPage && !!page.endCursor,
    ...(page?.endCursor ? { cursor: String(page.endCursor) } : {}),
  };
}

const UNREAD = `query InboxUnread($ari: String, $after: String) {
  notifications {
    notificationFeed(first: 50, after: $after, collabContextRoutingAri: $ari, filter: { readStateFilter: unread }) {
      pageInfo { hasNextPage endCursor }
      nodes { groupId headNotification { notificationId } }
    }
  }
}`;
/** Every unread row in Jira's feed: Jira has no unread count, and the feed itself pages, so loaded rows undercount. */
export async function unreadGroups(): Promise<{ id: string; head: string }[]> {
  const out: { id: string; head: string }[] = [];
  let after: string | null = null;
  // ponytail: 10 pages (about 500 unread rows) at most; raise it if anyone gets near that.
  for (let i = 0; i < 10; i++) {
    const f: any = (await gateway("InboxUnread", UNREAD, { after })).notificationFeed;
    const nodes = f?.nodes ?? [];
    for (const n of nodes)
      if (n?.groupId)
        out.push({ id: String(n.groupId), head: String(n.headNotification?.notificationId ?? "") });
    if (!nodes.length || !f?.pageInfo?.hasNextPage || !f.pageInfo.endCursor) break;
    after = String(f.pageInfo.endCursor);
  }
  return out;
}

/** What GET /api/inbox answers without a cursor: a tab's first page, and for the whole feed every unread row (the badge). */
export type FirstPage = InboxFeed & { unread?: { id: string; head: string }[] };
/** The last first page Jira gave, per bell tab. Jira's feed takes 3–4 s to read (feed, then its groups); a browser with no
 *  page of its own shows this one at once and reads Jira's meanwhile, as one with a stored page does (R4-inbox-D5). Linear's
 *  inbox is instant because notifications are synced models in its local pool; this server is the nearest local copy. */
const kept = new Map<string, FirstPage>();
/** Bumped as each write to the feed starts and ends: a page read across a write may predate it, so it isn't kept. */
let writes = 0;
/** Jira's first page, fresh, kept for browsers that have none. */
export async function firstPage(kind?: "direct" | "watching"): Promise<FirstPage> {
  const at = writes;
  const [page, unread] = await Promise.all([
    feed(kind),
    kind ? undefined : unreadGroups().catch(() => undefined),
  ]);
  const result: FirstPage = { ...page, ...(unread ? { unread } : {}) };
  if (at === writes) kept.set(kind ?? "all", result);
  return result;
}
/** The kept first page, without asking Jira; undefined until one was read since the server started or last wrote. */
export const keptFirstPage = (kind?: "direct" | "watching") => kept.get(kind ?? "all");
/** Runs a write to the feed's read state (read, unread, read all): the kept pages go, since they may now be wrong, and a fresh one is read
 *  once it lands. */
export async function writing<T>(write: () => Promise<T>): Promise<T> {
  writes++;
  kept.clear();
  try {
    return await write();
  } finally {
    writes++;
    kept.clear();
    refreshKept();
  }
}
let refreshing = false,
  again = false;
/** Reads the whole feed's first page into the kept copy: at start, and after writes (one at a time, the last write wins). */
export function refreshKept() {
  if (refreshing) {
    again = true;
    return;
  }
  refreshing = true;
  void firstPage()
    .catch((e) => console.error("[inbox] refresh", String(e).slice(0, 200)))
    .finally(() => {
      refreshing = false;
      if (again) {
        again = false;
        refreshKept();
      }
    });
}

/** Read or unread, per row: a row is a Jira notification group, so the whole group changes. */
export async function mark(groups: string[], read: boolean) {
  const field = read ? "markNotificationsByGroupIdAsRead" : "markNotificationsByGroupIdAsUnread";
  const fields = groups
    .map((_, i) => `g${i}: ${field}(groupId: $g${i}, collabContextRoutingAri: $ari)`)
    .join("\n");
  const vars = groups.map((_, i) => `$g${i}: String!`).join(", ");
  await gateway(
    "InboxMark",
    `mutation InboxMark($ari: String, ${vars}) { notifications { ${fields} } }`,
    Object.fromEntries(groups.map((g, i) => [`g${i}`, g])),
  );
}

export const markAllRead = () =>
  gateway(
    "InboxMarkAllRead",
    `mutation InboxMarkAllRead($ari: String) { notifications { markNotificationsAsRead(collabContextRoutingAri: $ari) } }`,
    {},
  );

/** ⌥U: every unread row but the `except` heads (rows snoozed or deleted in the browser, which Linear leaves unread: R3-inbox-D3).
 *  When none of them is unread, Jira marks its whole feed in one call; otherwise the rest go by group. Returns the groups marked. */
export async function readAll(except: string[]) {
  const skip = new Set(except),
    unread = await unreadGroups(),
    groups = unread.filter((g) => !skip.has(g.head)).map((g) => g.id);
  // Skipped heads that are already read (old deletes kept in the browser) still allow the one-call path.
  if (groups.length === unread.length) await markAllRead();
  else for (let i = 0; i < groups.length; i += 50) await mark(groups.slice(i, i + 50), true);
  return groups;
}

/** Opening the inbox clears Jira's bell count, as opening the bell does. */
export const clearUnseen = () =>
  gateway(
    "InboxSeen",
    `mutation InboxSeen($ari: String) { notifications { clearUnseenCount(collabContextRoutingAri: $ari) } }`,
    {},
  );

const PULSE = `query InboxPulse($ari: String) {
  notifications {
    unseenNotificationCount(collabContextRoutingAri: $ari)
    notificationFeed(first: 1, collabContextRoutingAri: $ari) {
      nodes { headNotification { notificationId } }
    }
  }
}`;
const g = globalThis as { inboxPulse?: string; inboxChecked?: number };
/** Called from the mirror's poll loop while a tab is open: a cheap read, at most every 10 s. True when the feed moved, so tabs refetch it.
 *  The count alone misses a new notification once a tab's "seen" cleared it in between (1 → 0 → 1 reads as no change), so the newest notification's id counts too (R2-inbox-D4). */
export async function unseenChanged(): Promise<boolean> {
  if (Date.now() - (g.inboxChecked ?? 0) < 10_000) return false;
  g.inboxChecked = Date.now();
  const data = await gateway("InboxPulse", PULSE, {});
  const pulse = `${Number(data.unseenNotificationCount) || 0}:${data.notificationFeed?.nodes?.[0]?.headNotification?.notificationId ?? ""}`;
  const changed = g.inboxPulse !== undefined && pulse !== g.inboxPulse;
  g.inboxPulse = pulse;
  return changed;
}
