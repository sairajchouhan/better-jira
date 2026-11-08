/**
 * Jira's in-app notifications (the bell), through the Atlassian GraphQL gateway's `notifications` field.
 * Not in Atlassian's public docs: every GraphQL string lives in this file, so a field change is a one-file fix.
 * The gateway needs `collabContextRoutingAri` (the site's ARI) to find the feed; without it every feed reads empty.
 */
import { canWrite } from "./jira";
import { mapFeed, type InboxFeed } from "./inbox-model";
import { serverAuth } from "./server-config";

const PAGE = 50;

async function gateway<T = any>(
  operationName: string,
  query: string,
  variables: object,
): Promise<T> {
  const { site, email, token } = serverAuth();
  if (/^\s*mutation/.test(query) && !canWrite(site))
    throw new Error(`Jira writes are disabled for ${site}.`);
  const res = await fetch(`${site}/gateway/api/graphql`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${email}:${token}`),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      operationName,
      query,
      variables: { ...variables, ari: await routingAri() },
    }),
  });
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
    const { cloudId } = await (await fetch(`${serverAuth().site}/_edge/tenant_info`)).json();
    if (!cloudId) throw new Error("Jira did not return a cloud ID");
    return `ari:cloud:platform::site/${cloudId}`;
  })().catch((error) => {
    ari = undefined;
    throw error;
  }));
}

const FEED = `query InboxFeed($ari: String, $first: Int, $after: String, $category: InfluentsNotificationCategory) {
  notifications {
    unseenNotificationCount(product: "jira", collabContextRoutingAri: $ari)
    notificationFeed(first: $first, after: $after, collabContextRoutingAri: $ari, filter: { productFilter: "jira", categoryFilter: $category }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        groupId groupSize readStates
        headNotification {
          notificationId timestamp readState category
          content {
            type message url
            actor { displayName avatarURL }
            entity { title url status }
            path { title url }
            bodyItems { document { format data } }
          }
        }
      }
    }
  }
}`;
/** Jira's bell tabs: Direct (assigned, mentioned, your issues) and Watching; no category is both. `after` is the previous page's cursor. */
export async function feed(category?: "direct" | "watching", after?: string): Promise<InboxFeed> {
  const data = await gateway("InboxFeed", FEED, {
    first: PAGE,
    after: after ?? null,
    category: category ?? null,
  });
  const page = data.notificationFeed?.pageInfo;
  return {
    unseen: Number(data.unseenNotificationCount) || 0,
    items: mapFeed(data.notificationFeed?.nodes),
    more: !!page?.hasNextPage && !!page.endCursor,
    ...(page?.endCursor ? { cursor: String(page.endCursor) } : {}),
  };
}

const UNSEEN = `query InboxUnseen($ari: String) {
  notifications { unseenNotificationCount(product: "jira", collabContextRoutingAri: $ari) }
}`;
export const unseen = async () =>
  Number((await gateway("InboxUnseen", UNSEEN, {})).unseenNotificationCount) || 0;

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
    `mutation InboxMarkAllRead($ari: String) { notifications { markNotificationsAsRead(product: "jira", collabContextRoutingAri: $ari) } }`,
    {},
  );

/** Opening the inbox clears Jira's bell count, as opening the bell does. */
export const clearUnseen = () =>
  gateway(
    "InboxSeen",
    `mutation InboxSeen($ari: String) { notifications { clearUnseenCount(product: "jira", collabContextRoutingAri: $ari) } }`,
    {},
  );

const g = globalThis as { inboxUnseen?: number; inboxChecked?: number };
/** Called from the mirror's poll loop while a tab is open: a cheap count read, at most every 10 s. True when it moved, so tabs refetch the feed. */
export async function unseenChanged(): Promise<boolean> {
  if (Date.now() - (g.inboxChecked ?? 0) < 10_000) return false;
  g.inboxChecked = Date.now();
  const count = await unseen();
  const changed = g.inboxUnseen !== undefined && count !== g.inboxUnseen;
  g.inboxUnseen = count;
  return changed;
}
