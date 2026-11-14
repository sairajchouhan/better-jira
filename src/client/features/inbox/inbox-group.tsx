/**
 * A row's earlier notifications: Jira's bell folds a group behind "+3 updates from Priya Chopra and others" and expands it
 * five at a time. Shown in Linear's look for a folded run of activity (`ActivityHistoryCollapse`): one muted line with the
 * expand chevrons, unfolding into activity-style rows (avatar, sentence, time) with each comment under its row.
 */
import { useCallback, useState, useSyncExternalStore } from "react";
import { InfiniteQueryObserver, type InfiniteData } from "@tanstack/query-core";
import { queryClient } from "@/client/state/server-data";
import { Avatar } from "@/client/components/avatar";
import { Button } from "@/client/components/button";
import { Text } from "@/client/components/text";
import { Adf } from "@/client/features/editor/adf";
import { ActivityEntry, ExpandActivityIcon } from "@/client/features/issue/activity-entry";
import { activityTime, fullTime } from "@/client/features/issue/issue-dates";
import { commentAnchor, describe, groupSummary, type InboxGroupPage, type InboxItem, type InboxNote } from "@/shared/inbox-model";
import { type User } from "@/shared/issue-model";

type GroupData = InfiniteData<InboxGroupPage, string>;
/** The group's pages, keyed by its head: a new notification on the issue starts the list again. */
function groupQuery(row: InboxItem) {
  return {
    queryKey: ["inbox-group", row.id, row.head],
    queryFn: async ({ pageParam }: { pageParam: string }) => {
      const res = await fetch(
        `/api/inbox/group?id=${encodeURIComponent(row.id)}${pageParam ? `&after=${encodeURIComponent(pageParam)}` : ""}`,
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Could not read Jira notifications.");
      return (await res.json()) as InboxGroupPage;
    },
    initialPageParam: "",
    // Jira says there is more after its last page; the group's size says when every notification is in.
    getNextPageParam: (last: InboxGroupPage, pages: InboxGroupPage[]) =>
      last.more && last.cursor && pages.reduce((n, p) => n + p.notes.length, 0) < row.count ? last.cursor : undefined,
    staleTime: 60_000,
  };
}

function useGroupNotes(row: InboxItem) {
  const [observer] = useState(
    () => new InfiniteQueryObserver<InboxGroupPage, Error, GroupData, string[], string>(queryClient, groupQuery(row)),
  );
  return useSyncExternalStore(
    useCallback((listener) => observer.subscribe(listener), [observer]),
    () => observer.getCurrentResult(),
  );
}

/** One notification as an activity row; a comment's text follows in a card, with a link to the comment itself. */
export function InboxGroupNote({ note, mirrored }: { note: InboxNote; mirrored: boolean }) {
  const anchor = commentAnchor(note);
  // An issue open here links to its comment on this page; otherwise Jira's own link opens the comment in Jira.
  const href = mirrored && anchor ? `#${anchor}` : note.link;
  return (
    <li data-inbox-note={note.id} className="flex flex-col gap-1.5">
      <ActivityEntry
        as="div"
        icon={<Avatar user={note.actor ? ({ id: note.actor.name, ...note.actor } as User) : null} size={14} />}
        time={
          <time dateTime={note.time} title={fullTime(note.time)}>
            {activityTime(note.time)}
          </time>
        }
      >
        <span className="text-fg-2">{describe({ ...note, preview: "" })}</span>
      </ActivityEntry>
      {(note.doc !== undefined || note.preview) && (
        <blockquote className="ml-[30px] rounded-lg border border-line px-3 py-2">
          <div className="text-[13px] text-fg-2">
            <Adf node={note.doc ?? note.preview} />
          </div>
          {href && (
            <a
              href={href}
              {...(href.startsWith("#") ? {} : { target: "_blank", rel: "noreferrer" })}
              className="mt-1 inline-block text-[12px] text-fg-3 hover:text-fg-2"
            >
              View comment
            </a>
          )}
        </blockquote>
      )}
    </li>
  );
}

function GroupNotes({ row, mirrored }: { row: InboxItem; mirrored: boolean }) {
  const { data, error, isPending, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = useGroupNotes(row);
  const notes = data?.pages.flatMap((p) => p.notes) ?? [];
  if (isPending) return <Text as="p" variant="mini" color="muted" className="px-[11px]">Loading updates…</Text>;
  if (error && !notes.length)
    return (
      <span className="flex items-center gap-2 px-[11px]">
        <Text variant="mini" color="muted">{error.message}</Text>
        <Button variant="muted" size="small" onClick={() => void refetch()}>
          Retry
        </Button>
      </span>
    );
  return (
    <>
      <ul aria-label="Notifications on this issue" className="flex flex-col gap-3">
        {notes.map((note) => (
          <InboxGroupNote key={note.id} note={note} mirrored={mirrored} />
        ))}
      </ul>
      {hasNextPage && (
        <Button
          variant="muted"
          size="small"
          className="self-start"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? "Loading…" : "Show more"}
        </Button>
      )}
    </>
  );
}

/** "+N updates from X and others", which unfolds into the group's notifications. Nothing for a single notification. */
export function InboxGroupUpdates({ row, mirrored }: { row: InboxItem; mirrored: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = groupSummary(row);
  if (!summary) return null;
  return (
    <section aria-label="Grouped notifications" className="flex flex-col gap-2">
      <ActivityEntry
        as="div"
        icon={
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? "Hide grouped notifications" : "Show grouped notifications"}
            onClick={() => setOpen(!open)}
            className="grid size-[14px] place-items-center text-fg-3 hover:text-fg-2"
          >
            <ExpandActivityIcon />
          </button>
        }
      >
        <button type="button" onClick={() => setOpen(!open)} className="text-left hover:text-fg-2">
          {summary}
        </button>
      </ActivityEntry>
      {open && <GroupNotes key={row.head} row={row} mirrored={mirrored} />}
    </section>
  );
}
