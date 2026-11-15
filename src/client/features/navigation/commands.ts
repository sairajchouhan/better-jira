import { useLayoutEffect, useRef } from "react";

/** The shortcut command channel: a shortcut sends an intent by name, and the module that owns the element registers the handler.
 *  Nothing outside the owner reaches into its DOM or its state. */
/** What a shortcut can ask of the UI, by name: the argument, and what a handler that takes it returns.
 *  An issue intent's argument is the key of the open issue it is for; only that issue's owner takes it. */
export type Commands = {
  /** Edit the issue's description. */
  "edit-description": { arg: string; result: true };
  "create-expanded": { arg: void; result: true };
  /** Focus the issue's title, caret at the end. */
  "focus-title": { arg: string; result: true };
  /** Focus the issue's comment box. */
  "focus-comment": { arg: string; result: true };
  /** Open the issue's subscribers menu from its subscribers button, which keeps focus. */
  "change-subscribers": { arg: string; result: true };
  "focus-find": { arg: void; result: true };
  /** Open the issue's "Sub-issue of" pill menu of its parent's sub-issues. */
  "open-parent-sub-issues": { arg: string; result: true };
  /** Open the card's or row's pull request badge menu for this issue (Linear's ⇧→ "Go to linked pull request…"). */
  "open-pull-requests": { arg: string; result: true };
  /** Start an inline sub-issue under this issue; untaken, the shortcut opens the create dialog. */
  "create-sub-issue": { arg: string; result: true };
  /** The sub-issue row under the pointer or keyboard focus; issue shortcuts act on it. */
  "hovered-sub-issue": { arg: void; result: string };
  /** Move this sub-issue within its parent's manual order (Linear's Move…); untaken when its list isn't ordered manually. */
  "reorder-sub-issue": { arg: { key: string; move: "top" | "up" | "down" | "bottom" }; result: true };
  "document-action": { arg: DocumentAction; result: true };
  /** The view Issue options, or the due or reminder menu, opens in. Kept until a menu that shows it mounts. */
  "issue-options-start": { arg: IssueOptionsStart; result: true };
  /** The composer created `key` from description text (BJ-69): the editor it came from swaps that text for a reference. */
  "issue-from-selection": { arg: { id: string; key: string }; result: true };
};
export type DocumentAction =
  | "rename"
  | "favorite"
  | "authors"
  | "remind"
  | "subscribers"
  | "copy-url"
  | "copy-title"
  | "copy-link"
  | "copy-markdown";
export type IssueOptionsStart = "link" | "pull-request" | "history" | "reminder" | "due";
type Name = keyof Commands;
type Handler<C extends Name> = (arg: Commands[C]["arg"]) => Commands[C]["result"] | false | undefined;

const handlers = new Map<Name, Set<Handler<any>>>();
const pending = new Map<Name, unknown>();

function deliver<C extends Name>(command: C, arg: Commands[C]["arg"]) {
  for (const handler of handlers.get(command) ?? []) {
    const result = handler(arg);
    if (result !== undefined && result !== false) return result as Commands[C]["result"];
  }
}
/** Runs a command on the mounted owner that takes it; undefined when none does. */
export function run<C extends Name>(
  command: C,
  ...[arg]: Commands[C]["arg"] extends void ? [] : [Commands[C]["arg"]]
): Commands[C]["result"] | undefined {
  return deliver(command, arg as Commands[C]["arg"]);
}
/** Runs a command now, or keeps it for the next owner that mounts and takes it; a later post replaces it. */
export function post<C extends Name>(command: C, arg: Commands[C]["arg"]) {
  if (deliver(command, arg) === undefined) pending.set(command, arg);
  else pending.delete(command);
}
const issueIntents: Name[] = [
  "edit-description",
  "focus-title",
  "focus-comment",
  "change-subscribers",
  "open-parent-sub-issues",
];
/** Drops the waiting issue intents for any issue but `open`, the issue now open (null when none is):
 *  an intent lapses when its issue is left before its owner could take it. */
export function forgetIssueIntents(open: string | null) {
  for (const name of issueIntents) if (pending.has(name) && pending.get(name) !== open) pending.delete(name);
}
/** The posted command waiting for its owner, for that owner's first render; its handler takes it once mounted. */
export const kept = <C extends Name>(command: C) =>
  pending.get(command) as Commands[C]["arg"] | undefined;
/** Registers the owner's handler; it returns a truthy result when it takes the command. Returns the unregister function. */
export function handle<C extends Name>(command: C, handler: Handler<C>) {
  let set = handlers.get(command);
  if (!set) handlers.set(command, (set = new Set()));
  set.add(handler);
  if (pending.has(command)) {
    const result = handler(pending.get(command) as Commands[C]["arg"]);
    if (result !== undefined && result !== false) pending.delete(command);
  }
  return () => void set.delete(handler);
}
/** `handle` for a component: the latest handler, registered while mounted, before paint so a kept command shows on first paint. */
export function useCommand<C extends Name>(command: C, handler: Handler<C>) {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  // A declined pending command is retried when this owner commits new DOM (for example, after detail loading).
  useLayoutEffect(() => handle(command, (arg) => latest.current(arg)));
}

/** Focuses an owner's element for a command; takes the command only when focus lands in it (a hidden, disabled or
 *  retiring element refuses focus, and the command must stay pending for the owner that can take it). */
export function focusNode(node: HTMLElement | null | undefined) {
  if (!node) return;
  node.focus();
  const active = node.ownerDocument.activeElement;
  return active && node.contains(active) ? (true as const) : undefined;
}

