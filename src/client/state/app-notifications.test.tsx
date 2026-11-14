import { afterEach, expect, jest, test } from "bun:test";
import { type ReactElement, type ReactNode, Children, isValidElement } from "react";
import { showNotification, latestNotification, lastToastLink, rekeyNotification, hasConfirmation } from "./app-notifications";
import { toasts, createToastQueue } from "@/client/components/toast-queue";
import { Toast } from "@/client/components/toast";

afterEach(() => {
  toasts.dismissAll();
  jest.useRealTimers();
});

test("R3-chrome-D5: confirmations stack up to four instead of replacing one another; each keeps its own five seconds", () => {
  jest.useFakeTimers();
  toasts.dismissAll();
  showNotification({ text: "Created A-NEW2", key: "A-NEW2" });
  jest.advanceTimersByTime(4000);
  showNotification({ text: "Created A-NEW3", key: "A-NEW3" });
  for (const text of ["Copied", "Copied", "Copied"]) showNotification({ text });
  // Linear's Toaster shows the newest four; the oldest waits unshown.
  expect(toasts.visible()).toHaveLength(4);
  expect(toasts.all()).toHaveLength(5);
  rekeyNotification("A-NEW", "A-40");
  expect(toasts.all().filter((t) => (t.content as ReactElement<{ notice: { key?: string } }>).props.notice.key === "A-40")).toHaveLength(0);
  // Open link from last toast follows the newest confirmation with an issue; rekey preserves its lifetime.
  expect(latestNotification()?.text).toBe("Copied");
  rekeyNotification("A-NEW3", "A-37");
  jest.advanceTimersByTime(1000);
  expect(toasts.all()).toHaveLength(4); // A-NEW2's five seconds are up
  jest.advanceTimersByTime(3999);
  expect(toasts.all().map((t) => (t.content as ReactElement<{ notice: { text: string } }>).props.notice.text)).toEqual(["Created A-37", "Copied", "Copied", "Copied"]);
  jest.advanceTimersByTime(1);
  expect(latestNotification()).toBeUndefined();
});

function actionIn(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) continue;
    if (child.type === Toast.Action) return child;
    const action = actionIn(child.props.children);
    if (action) return action;
  }
}

test("the queued undo toast runs the action belonging to that toast", () => {
  let undone = 0;
  const id = showNotification({ text: "Deleted notification", undo: () => undone++ });
  const content = toasts.find(id)!.content as ReactElement<{ notice: unknown }>;
  const body = (content.type as (props: typeof content.props) => ReactNode)(content.props);
  const action = actionIn(body);
  expect(action).toBeDefined();
  action!.props.onClick();
  expect(undone).toBe(1);
});

test("reminder deferral follows the queued confirmations through rekey, expiry and dismissal", () => {
  jest.useFakeTimers();
  const deferrals: boolean[] = [];
  const stop = toasts.subscribe(() => deferrals.push(hasConfirmation()));
  expect(hasConfirmation()).toBe(false);
  toasts.show("View created", { id: "view", duration: Infinity });
  expect(hasConfirmation()).toBe(false);
  showNotification({ text: "Created A-NEW1", key: "A-NEW1" });
  expect(hasConfirmation()).toBe(true);
  rekeyNotification("A-NEW1", "A-1");
  expect(hasConfirmation()).toBe(true);
  showNotification({ text: "Copied" });
  jest.advanceTimersByTime(5000);
  expect(hasConfirmation()).toBe(false);
  const id = showNotification({ text: "Copied again" });
  toasts.dismiss(id);
  expect(hasConfirmation()).toBe(false);
  expect(deferrals).toEqual([false, true, true, true, true, false, true, false]);
  stop();
});

test("dismissed queue lifetimes cannot remove a later toast reusing that id", () => {
  jest.useFakeTimers();
  const queue = createToastQueue();
  queue.show("first", { id: "a", expiresIn: 1000 });
  queue.dismissAll();
  queue.show("second", { id: "a", duration: Infinity });
  jest.advanceTimersByTime(1000);
  expect(queue.find("a")?.content).toBe("second");
  queue.dismissAll();
});

test("View issue dismisses the toast that owns the action", () => {
  showNotification({ text: "Keep this confirmation" });
  const id = showNotification({ text: "An inbox issue", key: "TEST-2" }, "inbox");
  const content = toasts.find(id)!.content as ReactElement<{ notice: unknown; id: string }>;
  const body = (content.type as (props: typeof content.props) => ReactNode)(content.props);
  actionIn(body)!.props.onClick();
  expect(toasts.has(id)).toBe(false);
  expect(hasConfirmation()).toBe(true);
});

import { renderToStaticMarkup } from "react-dom/server";
import { ToastViewport } from "@/client/components/toast";
import { showIssueCreated } from "./app-notifications";
import { get, set } from "./store";
import { markCreated } from "./local-edits";
import type { Issue } from "@/shared/issue-model";

const shown = () => renderToStaticMarkup(<ToastViewport queue={toasts} />).replace(/<[^>]+>/g, "|");
const words = () => shown().split("|").filter(Boolean);

test("#20: Issue created names the issue by Jira's key and title, with View issue and close, and follows a rekey", () => {
  const before = { issues: get().issues, writable: get().writable };
  const issue = (key: string) => ({ key, board: 1, summary: "Fix the toast", status: "1", labels: [] }) as unknown as Issue;
  try {
    // While Jira has not answered, the app key is not shown: just the title.
    markCreated("A-NEW7");
    set({ writable: true, issues: new Map([["A-NEW7", issue("A-NEW7")]]) });
    showIssueCreated("A-NEW7");
    expect(words()).toEqual(["Issue created", "Fix the toast", "View issue"]);
    expect(renderToStaticMarkup(<ToastViewport queue={toasts} />)).toContain("ui-toast-check");
    expect(renderToStaticMarkup(<ToastViewport queue={toasts} />)).toContain('aria-label="Dismiss"');
    // Jira's key arrives: the same toast now reads "A-37 – title", and Open link from last toast follows it.
    set({ issues: new Map([["A-37", issue("A-37")]]) });
    rekeyNotification("A-NEW7", "A-37");
    expect(latestNotification()).toEqual({ text: "Issue created", key: "A-37" });
    expect(words()).toEqual(["Issue created", "A-37 – Fix the toast", "View issue"]);
  } finally {
    set(before);
  }
});

test("#13: a notification with an icon draws it before its text, and every confirmation has Linear's close button", () => {
  showNotification({ text: "Copied issue link to clipboard", icon: "copy" });
  const html = renderToStaticMarkup(<ToastViewport queue={toasts} />);
  expect(html).toMatch(/ui-toast-icon[^]*<svg[^]*Copied issue link to clipboard/);
  expect(html).toContain('aria-label="Dismiss"');
});

test("R3 G13: Open link from last toast keeps the last toast's issue after the toast is gone, as Linear's ToastPresenter does", () => {
  jest.useFakeTimers();
  showNotification({ text: "Created A-NEW9", key: "A-NEW9" });
  // A newer toast with no issue doesn't take the link away.
  showNotification({ text: "Copied" });
  jest.advanceTimersByTime(5000);
  expect(toasts.all()).toHaveLength(0);
  expect(lastToastLink()).toBe("A-NEW9");
  rekeyNotification("A-NEW9", "A-41");
  expect(lastToastLink()).toBe("A-41");
});
