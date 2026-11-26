/**
 * Puts the place's title (route-title.ts) on the browser tab, and says where a navigation landed to screen readers, as
 * Linear's router does after each navigation (`self.document.title=o.title`, `rbi.announceNavigation`). The title follows
 * the store, so an issue's title edit retitles its tab (Linear revalidates on the issue's URL, which carries its slug),
 * and the Inbox's unread count stays live (Linear's `DocumentTitleUpdater`).
 */
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { routeNotFound } from "@/client/routes/tree";
import { useStore, type State } from "@/client/state/store";
import { isLocalIssue } from "@/client/state/local-edits";
import { useUnreadCount } from "@/client/features/inbox/inbox";
import { peopleOf } from "@/shared/people";
import { defaultPreferences } from "@/shared/view-model";
import { placeOf } from "./navigation";
import { announcement, ERROR_TITLE, NOT_FOUND_TITLE, titleOf } from "./route-title";
import { syncFavicon } from "./favicon-badge";

const placeIn = (s: State) => placeOf(s, (board) => (s.preferences[board] ?? defaultPreferences()).scope);
/** The screen's title; a store selector, so it re-renders only when the words change. */
const screenTitle = (s: State, unread: number) =>
  titleOf(placeIn(s), {
    boards: s.boards,
    savedViews: s.savedViews,
    issues: s.issues,
    editorDraft: s.editorDraft,
    // Read only on a profile: the name its header shows (BoardBreadcrumbs).
    personName: (id) => peopleOf(s.issues.values()).find((u) => u.id === id)?.name ?? id,
    persisted: (key) => !isLocalIssue(key),
    unread,
  });

export function RouteTitle() {
  const failed = useRouterState({
    select: (s) => (routeNotFound(s.matches) ? NOT_FOUND_TITLE : s.matches.some((m) => m.status === "error") ? ERROR_TITLE : null),
  });
  // The sidebar badge's count, so the tab and the badge never disagree.
  const { count } = useUnreadCount();
  const screen = useStore((s) => screenTitle(s, count));
  const title = failed ?? screen;
  const hasUnread = count > 0;
  useEffect(() => {
    if (document.title !== title) document.title = title;
  }, [title]);
  useEffect(() => {
    syncFavicon(hasUnread);
  }, [hasUnread]);
  return <NavigationAnnouncer title={title} />;
}

/** One line per history entry, in a polite live region (Linear's `nbi`: role status, aria-live polite, aria-atomic). */
function NavigationAnnouncer({ title }: { title: string }) {
  const key = useRouterState({ select: (s) => s.resolvedLocation?.state.key ?? s.resolvedLocation?.href ?? "" });
  const [said, setSaid] = useState<{ key?: string; message: string }>({ message: "" });
  // A new entry is a navigation: adjusted during render, so the line lands with the screen it names.
  if (key && said.key !== key) setSaid(announcement(said, key, title));
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-route-announcer>
      {said.message}
    </div>
  );
}
