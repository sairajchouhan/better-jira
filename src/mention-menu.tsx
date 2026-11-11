/* oxlint-disable react/immutability -- Session callbacks and mutable imperative models are intentionally owned outside React state. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
/* oxlint-disable react/set-state-in-effect -- Synchronize local UI state with external resources or reset it when the resource identity changes. */
import { Debouncer } from "@tanstack/pacer";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { Menu, MENU } from "./menu";
import { MENU_POPUP, usePlacement } from "./menu-surface";
import { queryClient, type User } from "./store";

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

/** Linear's @mention menu under the caret. Focus stays in the editor, which forwards its keys through `keys`. */
export function MentionMenu({
  query,
  issueKey,
  at,
  editor,
  keys,
  pick,
  dismiss,
}: {
  query: string;
  issueKey?: string;
  /** The caret box at the @, read fresh on every placement; `editor` is the element whose scrolls move it. */
  at: () => { left: number; top: number; bottom: number };
  editor: Element | null;
  keys: { current: ((event: KeyboardEvent) => boolean) | null };
  pick: (person: User) => void;
  dismiss: () => void;
}) {
  // A cached answer shows at once; otherwise the last list narrows locally while Jira is asked (debounced).
  const cached = queryClient.getQueryData<User[]>(peopleKey(query, issueKey));
  const [last, setLast] = useState<{ query: string; people: User[] } | null>(null);
  const [active, setActive] = useState(0);
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
  // A new query resets keyboard selection.
  const [activeQuery, setActiveQuery] = useState(query);
  if (activeQuery !== query) {
    setActiveQuery(query);
    setActive(0);
  }
  const people = cached ?? last?.people.filter((p) => matches(p, query)) ?? [];
  const settled = !!cached || last?.query === query;
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Scroll the newly active result into view.
  }, [active]);
  // A typed name with a space that matches no one is ordinary text: the menu steps aside.
  const hidden = !people.length && (settled ? /\s/.test(query) : !!query);
  keys.current = (event) => {
    if (event.key === "Escape") {
      dismiss();
      return true;
    }
    if (hidden || !people.length) return false;
    const move = (by: number) => setActive((i) => (i + by + people.length) % people.length);
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) move(1);
    else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) move(-1);
    else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.metaKey)
      pick(people[Math.min(active, people.length - 1)]!);
    else return false;
    return true;
  };
  // Up to eight 32px rows (or the empty state) inside the list's 6px padding and the popup's 1px border.
  const height =
    (people.length ? Math.min(8, people.length) * MENU.ITEM_HEIGHT : MENU.LIST_EMPTY_STATE_HEIGHT) +
    2 * MENU.LIST_PADDING +
    2;
  const style = usePlacement(
    list,
    editor,
    () => {
      const caret = at(),
        below = innerHeight - caret.bottom - 8 >= height;
      return {
        left: Math.max(8, Math.min(caret.left, innerWidth - 268)),
        top: below ? caret.bottom + 4 : Math.max(8, caret.top - 4 - height),
        maxHeight: height,
      };
    },
    !hidden && `${query} ${height}`,
  );
  if (hidden) return null;
  // The editor keeps focus and drives the highlight through `keys`; the menu mirrors `active` and follows the pointer.
  return (
    <Menu
      ref={list}
      aria-label="Mention people"
      shouldFilter={false}
      value={people[Math.min(active, people.length - 1)]?.id ?? ""}
      onValueChange={(id) => {
        const i = people.findIndex((p) => p.id === id);
        if (i >= 0) setActive(i);
      }}
      className={`${MENU_POPUP} fixed z-50 w-[260px]`}
      style={style}
      onMouseDown={(event) => event.preventDefault()}
    >
      <Menu.List>
        {!people.length && (
          <Menu.Empty always>{settled ? "No people found" : "Searching people…"}</Menu.Empty>
        )}
        {people.map((person) => (
          <Menu.Item
            key={person.id}
            value={person.id}
            icon={<Avatar user={person} size={16} />}
            onSelect={() => pick(person)}
          >
            {person.name}
          </Menu.Item>
        ))}
      </Menu.List>
    </Menu>
  );
}
