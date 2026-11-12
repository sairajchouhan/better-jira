import { afterEach, expect, jest, test } from "bun:test";
import { type ReactElement, type ReactNode, Children, isValidElement } from "react";
import { showNotification, latestNotification, rekeyNotification, NOTIFICATION_ID } from "./app-notifications";
import { toasts, createToastQueue } from "./toast-queue";
import { Toast } from "./toast";

afterEach(() => {
  toasts.dismissAll();
  jest.useRealTimers();
});

test("confirmation replacement restarts five seconds; rekey preserves the remaining lifetime", () => {
  jest.useFakeTimers();
  showNotification({ text: "Created A-NEW2", key: "A-NEW2" });
  jest.advanceTimersByTime(4000);
  showNotification({ text: "Created A-NEW3", key: "A-NEW3" });
  expect(toasts.visible().filter((toast) => toast.id === NOTIFICATION_ID)).toHaveLength(1);
  jest.advanceTimersByTime(4000);
  rekeyNotification("A-NEW", "A-40");
  expect(latestNotification()?.key).toBe("A-NEW3");
  rekeyNotification("A-NEW3", "A-37");
  expect(latestNotification()).toEqual({ text: "Created A-37", key: "A-37" });
  jest.advanceTimersByTime(999);
  expect(latestNotification()).toBeDefined();
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
  showNotification({ text: "Deleted notification", undo: () => undone++ });
  const content = toasts.find(NOTIFICATION_ID)!.content as ReactElement<{ notice: unknown }>;
  const body = (content.type as (props: typeof content.props) => ReactNode)(content.props);
  const action = actionIn(body);
  expect(action).toBeDefined();
  action!.props.onClick();
  expect(undone).toBe(1);
});

test("reminder deferral follows the queue confirmation slot through replace, rekey, expiry and dismissal", () => {
  jest.useFakeTimers();
  const deferrals: boolean[] = [];
  const stop = toasts.subscribe(() => deferrals.push(toasts.has(NOTIFICATION_ID)));
  expect(toasts.has(NOTIFICATION_ID)).toBe(false);
  toasts.show("View created", { id: "view", duration: Infinity });
  expect(toasts.has(NOTIFICATION_ID)).toBe(false);
  showNotification({ text: "Created A-NEW1", key: "A-NEW1" });
  expect(toasts.has(NOTIFICATION_ID)).toBe(true);
  rekeyNotification("A-NEW1", "A-1");
  expect(toasts.has(NOTIFICATION_ID)).toBe(true);
  showNotification({ text: "Copied" });
  jest.advanceTimersByTime(5000);
  expect(toasts.has(NOTIFICATION_ID)).toBe(false);
  showNotification({ text: "Copied again" });
  toasts.dismiss(NOTIFICATION_ID);
  expect(toasts.has(NOTIFICATION_ID)).toBe(false);
  expect(deferrals).toEqual([false, true, true, true, false, true, false]);
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
  expect(toasts.has(NOTIFICATION_ID)).toBe(true);
});
