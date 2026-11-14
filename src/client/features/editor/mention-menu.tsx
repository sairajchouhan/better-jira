import { EntityIdentifier } from "@/client/components/entity-identifier";
import { type Issue, type User } from "@/shared/issue-model";
/* oxlint-disable react/immutability -- Session callbacks and mutable imperative models are intentionally owned outside React state. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { Debouncer } from "@tanstack/pacer";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { Menu, MENU } from "@/client/components/menu";
import { MENU_POPUP, useElevation, usePlacement } from "@/client/components/menu-surface";
import { StatusIcon } from "@/client/components/icons";
import { CaretPeek, groupStep } from "./caret-peek";
import { IssuePeek } from "@/client/features/issue/issue-peek";
import type { Keys } from "@/client/components/keycap";
import { get, statusOf } from "@/client/state/store";
import { queryClient } from "@/client/state/server-data";
import { recentIssues } from "@/client/features/navigation/recents";

const peopleKey = (query: string, issue?: string) => [
  "people",
  issue ?? "",
  query.trim().toLowerCase(),
];
/** People Jira lets see the issue, cached for five minutes per query. */
export const searchPeople = (query: string, issue?: string) =>
  queryClient.fetchQuery<User[]>({
    queryKey: peopleKey(query, issue),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const response = await fetch(
        `/api/users?${new URLSearchParams({ query: query.trim(), ...(issue ? { issue } : {}) })}`,
      );
      if (!response.ok) throw new Error("Could not search people");
      return response.json();
    },
  });

const matches = (person: User, query: string) =>
  person.name.toLowerCase().includes(query.trim().toLowerCase());

/** Issues an @query refers to: by key prefix ("@KAN-1") or by words of the title; none for a bare "@". */
export function matchingIssues(issues: Iterable<Issue>, query: string, limit = 5): Issue[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const found: Issue[] = [];
  for (const issue of issues) {
    if (issue.key.toLowerCase().startsWith(q) || issue.summary.toLowerCase().includes(q)) found.push(issue);
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * The @ menu's Issues (Linear's `issueMentions`), never the issue being written in. A bare "@" in an issue offers its
 * related issues, then the five last opened; outside an issue, none. A query needs two characters (`uGn`), then matches.
 */
export function mentionIssues(
  issues: ReadonlyMap<string, Issue>,
  query: string,
  context: { issue?: Issue; recent: readonly string[] },
  limit = 5,
): Issue[] {
  const own = context.issue?.key;
  const q = query.trim();
  if (q) return q.length < 2 ? [] : matchingIssues([...issues.values()].filter((i) => i.key !== own), q, limit);
  if (!context.issue) return [];
  const keys = [...(context.issue.relations ?? []).map((r) => r.key), ...context.recent.slice(0, 5)];
  return [...new Set(keys)]
    .filter((key) => key !== own)
    .map((key) => issues.get(key))
    .filter((i): i is Issue => !!i)
    .slice(0, limit);
}

/** Where a caret menu sits and how it is driven: the caret box at the trigger, read fresh on every placement; the
 * editor element whose scrolls move it; the editor's key forwarding; and Esc. */
export type CaretAnchor = {
  at: () => { left: number; top: number; bottom: number };
  editor: Element | null;
  keys: { current: ((event: KeyboardEvent) => boolean) | null };
  dismiss: () => void;
};
/**
 * `shortcut` is a key that picks the item from anywhere in the list (the paste-link menu's Tab), drawn as its cap.
 * `group` lets ⌥↑/⌥↓ jump between runs of items; `peek` is what → previews beside the menu.
 */
export type CaretMenuItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  shortcut?: Keys;
  pick: () => void;
  group?: string;
  peek?: ReactNode;
};

/** Linear's caret menu (@ people and issues, / blocks, : emoji) under the caret. Focus stays in the editor, which forwards
 * its keys through `keys`. With no items it shows `empty`, or steps aside when `empty` is null. */
export function CaretMenu({
  label,
  query,
  items,
  empty,
  at,
  editor,
  keys,
  dismiss,
  width,
  headings,
}: CaretAnchor & {
  label: string;
  query: string;
  items: CaretMenuItem[];
  empty: string | null;
  /** Linear's widths (EditorComponent): slash 240, mention and emoji 350. */
  width: number;
  /** Each item group's heading, drawn over its run of items with a divider between runs (the @ menu's Users, Issues). */
  headings?: Record<string, string>;
}) {
  const [active, setActive] = useState(0);
  // A new query resets keyboard selection.
  const [activeQuery, setActiveQuery] = useState(query);
  if (activeQuery !== query) {
    setActiveQuery(query);
    setActive(0);
  }
  const [peek, setPeek] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const elevation = useElevation();
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Scroll the newly active result into view.
  }, [active]);
  const hidden = !items.length && empty === null;
  keys.current = (event) => {
    if (event.key === "Escape") {
      dismiss();
      return true;
    }
    if (!items.length) return false;
    const keyed = items.find((item) => item.shortcut === event.key);
    if (keyed && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      keyed.pick();
      return true;
    }
    const move = (by: number) => setActive((i) => (i + by + items.length) % items.length);
    const current = items[Math.min(active, items.length - 1)]!;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.altKey)
      setActive(groupStep(items.map((item) => item.group), Math.min(active, items.length - 1), event.key === "ArrowDown" ? 1 : -1));
    else if (event.key === "ArrowRight" && !peek && current.peek) setPeek(true);
    else if (event.key === "ArrowLeft" && peek) setPeek(false);
    else if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) move(1);
    else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) move(-1);
    else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.metaKey)
      items[Math.min(active, items.length - 1)]!.pick();
    else return false;
    return true;
  };
  const runs = headings ? groupRuns(items) : [];
  // Up to eight 32px rows (or the empty state), with each run's heading and the dividers between runs, inside the list's
  // 6px padding and the popup's 1px border.
  const height =
    (items.length ? Math.min(8, items.length) * MENU.ITEM_HEIGHT : MENU.LIST_EMPTY_STATE_HEIGHT) +
    runs.length * MENU.GROUP_HEADER_HEIGHT +
    Math.max(0, runs.length - 1) * MENU.DIVIDER_HEIGHT +
    // A list that opens on a heading has no top padding.
    (runs.length ? 1 : 2) * MENU.LIST_PADDING +
    2;
  const style = usePlacement(
    list,
    editor,
    () => {
      const caret = at(),
        below = innerHeight - caret.bottom - 8 >= height;
      return {
        left: Math.max(8, Math.min(caret.left, innerWidth - width - 8)),
        top: below ? caret.bottom + 4 : Math.max(8, caret.top - 4 - height),
        maxHeight: height,
      };
    },
    !hidden && `${query} ${height}`,
  );
  if (hidden) return null;
  const peeked = peek ? items[Math.min(active, items.length - 1)] : undefined;
  const row = (item: CaretMenuItem) => (
    <Menu.Item key={item.id} value={item.id} icon={item.icon} shortcut={item.shortcut} onSelect={item.pick}>
      {item.label}
    </Menu.Item>
  );
  // The editor keeps focus and drives the highlight through `keys`; the menu mirrors `active` and follows the pointer.
  return (
    <>
    <Menu
      ref={list}
      aria-label={label}
      shouldFilter={false}
      value={items[Math.min(active, items.length - 1)]?.id ?? ""}
      onValueChange={(id) => {
        const i = items.findIndex((item) => item.id === id);
        if (i >= 0) setActive(i);
      }}
      {...elevation.props}
      className={`${MENU_POPUP} fixed z-50`}
      style={{ ...style, width }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Menu.List>
        {!items.length && <Menu.Empty always>{empty}</Menu.Empty>}
        {headings
          ? runs.map((run, i) => (
              <Fragment key={run.group}>
                {i > 0 && <Menu.Divider />}
                <Menu.Group heading={headings[run.group] ?? run.group}>{run.items.map(row)}</Menu.Group>
              </Fragment>
            ))
          : items.map(row)}
      </Menu.List>
    </Menu>
    {peeked?.peek && (
      <CaretPeek menu={list.current} at={peeked.id}>
        {peeked.peek}
      </CaretPeek>
    )}
    </>
  );
}

/** Consecutive items of one group, in order. */
function groupRuns(items: CaretMenuItem[]) {
  const runs: { group: string; items: CaretMenuItem[] }[] = [];
  for (const item of items) {
    const group = item.group ?? "";
    if (runs.at(-1)?.group === group) runs.at(-1)!.items.push(item);
    else runs.push({ group, items: [item] });
  }
  return runs;
}

/** Linear's @ menu groups: `userMentions` "Users", then `issueMentions` "Issues". */
const MENTION_HEADINGS = { people: "Users", issues: "Issues" };

/** Linear's @ menu: people Jira lets see the issue, then issues whose key or title matches (BJ-43). */
export function MentionMenu({
  query,
  issueKey,
  pick,
  pickIssue,
  ...anchor
}: CaretAnchor & {
  query: string;
  issueKey?: string;
  pick: (person: User) => void;
  pickIssue: (issue: Issue) => void;
}) {
  // A cached answer shows at once; otherwise the last list narrows locally while Jira is asked (debounced).
  const cached = queryClient.getQueryData<User[]>(peopleKey(query, issueKey));
  const [last, setLast] = useState<{ query: string; people: User[] } | null>(null);
  const latest = useRef(query);
  latest.current = query;
  const [search] = useState(
    () =>
      new Debouncer(
        (q: string, issue?: string) =>
          void searchPeople(q, issue).then(
            (people) => {
              if (latest.current === q) setLast({ query: q, people });
            },
            () => {
              if (latest.current === q) setLast({ query: q, people: [] });
            },
          ),
        { wait: 150 },
      ),
  );
  useEffect(() => {
    if (cached) setLast({ query, people: cached });
    // The bare "@" needs no debounce: it joins the list preloaded when the editor was approached.
    else if (!query) {
      search.cancel();
      search.fn("", issueKey);
    } else search.maybeExecute(query, issueKey);
  }, [query, issueKey, cached, search]);
  useEffect(() => () => search.cancel(), [search]);
  const people = cached ?? last?.people.filter((p) => matches(p, query)) ?? [];
  const all = get().issues;
  const issues = mentionIssues(all, query, { issue: issueKey ? all.get(issueKey) : undefined, recent: recentIssues() });
  const settled = !!cached || last?.query === query;
  const items: CaretMenuItem[] = [
    ...people.map((person) => ({
      id: person.id,
      label: person.name,
      icon: <Avatar user={person} size={16} />,
      pick: () => pick(person),
      group: "people",
    })),
    ...issues.map((issue) => {
      const status = statusOf(issue);
      return {
        id: `issue:${issue.key}`,
        label: (
          <>
            <EntityIdentifier className="text-fg-3">{issue.key}</EntityIdentifier> {issue.summary}
          </>
        ),
        icon: status && <StatusIcon status={status} />,
        pick: () => pickIssue(issue),
        group: "issues",
        peek: <IssuePeek issue={issue} />,
      };
    }),
  ];
  // A typed name with a space that matches no one is ordinary text: the menu steps aside.
  const hidden = !items.length && (settled ? /\s/.test(query) : !!query);
  return (
    <CaretMenu
      {...anchor}
      label="Mention people"
      width={350}
      headings={MENTION_HEADINGS}
      query={query}
      items={items}
      empty={hidden ? null : settled ? "No people found" : "Searching people…"}
    />
  );
}
