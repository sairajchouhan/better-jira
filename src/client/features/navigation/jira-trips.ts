import { get } from "@/client/state/store";
import { JIRA_MESSAGES, jiraMessagesIn, jiraPath, type JiraMessage, type Trip } from "@/shared/jira-trips";
import { router } from "./app-navigation";

/**
 * Records each trip to the Jira site this app is connected to (shared/jira-trips.ts). Every link the browser follows is seen
 * by `watchJiraLinks`, named by the `data-trip` around it; a tab the app opens goes through `openTab`; a message that tells
 * the user to do something in Jira goes through `recordJiraMessages`. Trips are kept in this browser first and sent to the
 * server when it can be reached, as the write outbox does: a failed send waits and goes again, and sooner once back online.
 */

const QUEUE = "better-jira:trips",
  // ponytail: fixed 5 s wait between sends the server didn't take (the outbox's UNREACHABLE_WAIT); keeps at most 1,000.
  RETRY_WAIT = 5000,
  KEPT = 1000;

const read = (): Trip[] => {
  try {
    return JSON.parse(localStorage.getItem(QUEUE) ?? "[]");
  } catch {
    return [];
  }
};
const write = (trips: Trip[]) => {
  try {
    if (trips.length) localStorage.setItem(QUEUE, JSON.stringify(trips.slice(-KEPT)));
    else localStorage.removeItem(QUEUE);
  } catch {
    // Storage is full or off: this trip goes uncounted.
  }
};

let sending = false,
  again = false,
  retry: ReturnType<typeof setTimeout> | undefined;
/** Sends what this browser keeps until none is left, one tab at a time. A trip sent twice is counted once (groupTrips). */
async function send(): Promise<void> {
  if (sending) return void (again = true);
  sending = true;
  clearTimeout(retry);
  const drain = async () => {
    for (let batch = read(); batch.length; batch = read()) {
      const response = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
      if (!response.ok || !response.headers.get("content-type")?.includes("json"))
        throw new Error(`The server didn't keep the trips (${response.status})`);
      const sent = new Set(batch.map((trip) => trip.id));
      write(read().filter((trip) => !sent.has(trip.id)));
    }
  };
  try {
    await (navigator.locks ? navigator.locks.request(QUEUE, drain) : drain());
  } catch {
    retry = setTimeout(() => void send(), RETRY_WAIT);
  } finally {
    sending = false;
  }
  if (again) {
    again = false;
    void send();
  }
}

function keep(kind: string, path: string | null) {
  const s = get();
  write([
    ...read(),
    {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      kind,
      path,
      screen: router.state.matches.at(-1)?.routeId ?? "unknown",
      board: s.board || null,
      issue: s.selected,
    },
  ]);
  void send();
}

/** Records a trip when `url` is on the Jira site: `kind` names the control that opened it. */
export function recordTrip(kind: string, url: string) {
  const target = jiraPath(url, get().site);
  if (target) keep(target.confluence ? `${kind}:confluence` : kind, target.path);
}

/** Records a message that tells the user to do something in Jira, as it is shown. */
export const recordJiraMessage = (message: JiraMessage) => keep(`message:${message}`, JIRA_MESSAGES[message].path);
/** Records each such message in `text` (a notification's, which may come from the server). */
export const recordJiraMessages = (text: string) => jiraMessagesIn(text).forEach(recordJiraMessage);

/** Opens `url` in a new tab: every tab the app opens itself goes through here, named by `kind`. */
export function openTab(url: string, kind: string, features = "noopener") {
  recordTrip(kind, url);
  window.open(url, "_blank", features);
}

/** The control a link belongs to: the closest `data-trip` around it, else just a link. */
export const tripKindOf = (element: Element | null) => element?.closest("[data-trip]")?.getAttribute("data-trip") ?? "link";

/**
 * Records the links the browser follows itself: a click, or a middle click, on a link that no handler took over. That is
 * only known once every handler has run (an issue link in a document opens here and prevents the default), so it is read
 * after the event. A link in text being edited doesn't open on a click. Once per page; sends what an earlier page kept.
 */
export function watchJiraLinks() {
  const follow = (event: MouseEvent) => {
    if (event.button !== (event.type === "auxclick" ? 1 : 0)) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
    if (!link || link.hasAttribute("download") || link.isContentEditable) return;
    const kind = tripKindOf(link);
    setTimeout(() => {
      if (!event.defaultPrevented) recordTrip(kind, link.href);
    });
  };
  addEventListener("click", follow, true);
  addEventListener("auxclick", follow, true);
  addEventListener("online", () => void send());
  void send();
}
