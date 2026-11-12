import { isValidElement } from "react";
import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";
import { get } from "./store";
import { currentKey } from "./jira-sync";
import { navigate } from "@/client/features/navigation/app-navigation";

/** Existing confirmations replace one another; inbox undo keeps its own slot. */
export const NOTIFICATION_ID = "ui-machine";
export const INBOX_NOTIFICATION_ID = "inbox";
export type Notification = { text: string; detail?: string; key?: string; undo?: () => void };

function NotificationContent({ notice, id }: { notice: Notification; id: string }) {
  return (
    <Toast data-toast>
      <Toast.Title>{notice.text}</Toast.Title>
      {notice.detail && <Toast.Description>{notice.detail}</Toast.Description>}
      {(notice.undo || notice.key) && (
        <Toast.Actions>
          {notice.undo && <Toast.Action onClick={notice.undo}>Undo</Toast.Action>}
          {notice.key && (
            <Toast.Action onClick={() => {
              toasts.dismiss(id);
              const key = currentKey(notice.key!);
              navigate({ selected: key, panel: true, board: get().issues.get(key)?.board });
            }}>
              View issue
            </Toast.Action>
          )}
          {notice.undo && <Toast.Close />}
        </Toast.Actions>
      )}
    </Toast>
  );
}

/** Queue-owned lifetime keeps the existing 5s confirmations independent of presenter mounting. */
export function showNotification(notice: Notification, id = NOTIFICATION_ID) {
  return toasts.show(<NotificationContent notice={notice} id={id} />, { id, duration: Infinity, expiresIn: 5000 });
}

export function latestNotification(): Notification | undefined {
  const content = toasts.find(NOTIFICATION_ID)?.content;
  return isValidElement<{ notice: Notification }>(content) && content.type === NotificationContent
    ? content.props.notice
    : undefined;
}

/** Rekey the queued content without restarting its lifetime. */
export function rekeyNotification(from: string, to: string) {
  const notice = latestNotification();
  if (notice?.key !== from) return;
  const text = notice.text.replace(new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g"), to);
  toasts.update(NOTIFICATION_ID, <NotificationContent notice={{ ...notice, key: to, text }} id={NOTIFICATION_ID} />);
}
