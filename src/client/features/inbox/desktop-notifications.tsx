/** Desktop notifications for new inbox rows (Linear's Push notifications › Desktop), through the browser's Notification API.
 *  The server already polls Jira's bell and tells open tabs to refetch the feed; each fetch's new rows are pushed here. */
import { useEffect } from "react";
import { commentAnchor, type InboxItem } from "@/shared/inbox-model";
import { newPushes, noteIds, pushContent, type Push } from "@/shared/inbox-push";
import { ME, get } from "@/client/state/store";
import { showNotification } from "@/client/state/app-notifications";
import { navigate, showAnchor } from "@/client/features/navigation/app-navigation";
import { inbox, itemsOf, selectRow, useFeed } from "./inbox";

export type PushPermission = NotificationPermission | "unsupported";
export const pushPermission = (): PushPermission =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/** Linear's `subscribeUser`: turning desktop notifications on is what asks the browser, so the prompt follows a click. When
 *  the browser refuses, Linear's "Error subscribing" toast says where to allow it, and the setting stays off. */
export async function enableDesktopNotifications() {
  let permission = pushPermission();
  if (permission === "default") permission = await Notification.requestPermission();
  if (permission === "granted") return inbox.changePush({ enabled: true });
  showNotification({
    text: "Error subscribing",
    detail:
      "Please go to your browser settings and grant this site permission to post notifications to enable this feature.",
  });
}
export const disableDesktopNotifications = () => inbox.changePush({ enabled: false });

/** Opens what a clicked notification is about: the issue, at its comment for a comment, as Jira's link does; a row whose
 *  issue isn't mirrored opens in the inbox. */
function openPush(item: InboxItem) {
  const issue = get().issues.get(item.key);
  if (!issue) return selectRow(item);
  navigate({ board: issue.board, selected: issue.key, panel: true, view: get().view });
  const anchor = commentAnchor(item);
  if (anchor) requestAnimationFrame(() => showAnchor(anchor));
}

function show(push: Push) {
  const { title, body } = pushContent(push);
  // One per row: a newer notification on the same issue replaces the last one, in every tab, instead of stacking.
  const note = new Notification(title, { body, tag: push.item.id });
  note.onclick = (event) => {
    event.preventDefault();
    window.focus();
    note.close();
    openPush(push.item);
  };
}

const CLAIMS = () => `better-jira:inbox-pushed:v1:${get().namespace}`;
/** The notifications no other tab has shown yet, now claimed for this one. */
function claim(ids: string[]) {
  let claimed: string[] = [];
  try {
    claimed = JSON.parse(localStorage.getItem(CLAIMS()) ?? "[]");
  } catch {
    /* unreadable claims read as none */
  }
  const fresh = ids.filter((id) => !claimed.includes(id));
  try {
    localStorage.setItem(CLAIMS(), JSON.stringify([...claimed, ...fresh].slice(-500)));
  } catch {
    /* a tab that can't store claims may show a notification another tab shows too; the shared tag keeps it one */
  }
  return new Set(fresh);
}
/** Every open tab sees the same new rows; a Web Lock makes the claim check-and-write one step, so only one tab shows each. */
async function deliver(pushes: Push[]) {
  const run = () => {
    const fresh = claim(pushes.map((p) => p.note.id));
    for (const push of pushes) if (fresh.has(push.note.id)) show(push);
  };
  if (navigator.locks) await navigator.locks.request("better-jira-inbox-push", run);
  else run();
}

/** The notifications each account's feed held when this tab first fetched it, and every one fetched since. */
const knownBy = new Map<string, Set<string>>();

/** Mounted once in the shell. The first fetched feed is the baseline (older rows never notify); each later fetch pushes what
 *  `newPushes` lets through, unless this tab is the one being looked at. */
export function InboxPushDelivery() {
  const { data, dataUpdatedAt } = useFeed("all");
  useEffect(() => {
    // The feed shown from storage at load isn't Jira's yet.
    if (!dataUpdatedAt) return;
    const items = itemsOf(data),
      namespace = get().namespace,
      known = knownBy.get(namespace);
    if (known && pushPermission() === "granted") {
      const pushes = newPushes(items, {
        settings: inbox.pushState(),
        known,
        local: inbox.localState(),
        priorityInbox: inbox.viewState().priorityInbox,
        me: ME.name,
        now: Date.now(),
      });
      const looking = document.visibilityState === "visible" && document.hasFocus();
      if (pushes.length && !looking) void deliver(pushes);
    }
    knownBy.set(namespace, new Set([...(known ?? []), ...noteIds(items)]));
  }, [data, dataUpdatedAt]);
  return null;
}
