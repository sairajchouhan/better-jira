import { cloneElement, isValidElement, type ReactElement } from "react";
import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";
import { Icon, StatusIcon, type IconName } from "@/client/components/icons";
import { get, statusOf, useStore } from "./store";
import { currentKey } from "./jira-sync";
import { isLocalIssue } from "./local-edits";
import { navigate } from "@/client/features/navigation/app-navigation";

/** Existing confirmations replace one another; inbox undo keeps its own slot. */
export const NOTIFICATION_ID = "ui-machine";
export const INBOX_NOTIFICATION_ID = "inbox";
/** `icon` is the image before the text, as Linear's info toasts carry one (the copy icon on "Copied issue link to clipboard"). */
export type Notification = { text: string; detail?: string; key?: string; undo?: () => void; icon?: IconName };
type ContentProps = { notice: Notification; id: string };

/** View issue: opens the issue by the key it has now, so a key Jira has since replaced still finds it. */
function viewIssue(issueKey: string, id: string) {
  return (
    <Toast.Action
      onClick={() => {
        toasts.dismiss(id);
        const key = currentKey(issueKey);
        navigate({ selected: key, panel: true, board: get().issues.get(key)?.board });
      }}
    >
      View issue
    </Toast.Action>
  );
}

/** Every confirmation ends in Linear's close button (ToastPresenter), last so its other buttons come first. */
function NotificationContent({ notice, id }: ContentProps) {
  return (
    <Toast data-toast>
      <Toast.Title>
        {notice.icon && (
          <Toast.Icon>
            <Icon name={notice.icon} size={14} />
          </Toast.Icon>
        )}
        {notice.text}
      </Toast.Title>
      {notice.detail && <Toast.Description>{notice.detail}</Toast.Description>}
      {(notice.undo || notice.key) && (
        <Toast.Actions>
          {notice.undo && <Toast.Action onClick={notice.undo}>Undo</Toast.Action>}
          {notice.key && viewIssue(notice.key, id)}
        </Toast.Actions>
      )}
      <Toast.Close />
    </Toast>
  );
}

/** The new issue under "Issue created": its status icon, then "KEY – title" once Jira has given it a key (its title alone until then). */
function CreatedIssue({ issueKey }: { issueKey: string }) {
  const issue = useStore((s) => s.issues.get(currentKey(issueKey)));
  const pending = useStore((s) => s.writable) && isLocalIssue(currentKey(issueKey));
  const status = issue && statusOf(issue);
  return (
    <Toast.Subject data-toast-subject={issueKey}>
      {status && <StatusIcon status={status} />}
      <span>{pending || !issue ? issue?.summary : `${issue.key} – ${issue.summary}`}</span>
    </Toast.Subject>
  );
}

/** Linear's create toast (`createIssueToastLink`): a success check, "Issue created", the issue, View issue and close. */
function IssueCreatedContent({ notice, id }: ContentProps) {
  return (
    <Toast role="status" data-toast>
      <Toast.Title>
        <Toast.Check />
        {notice.text}
      </Toast.Title>
      <Toast.Close />
      {notice.key && <CreatedIssue issueKey={notice.key} />}
      {notice.key && (
        <Toast.Actions>
          {viewIssue(notice.key, id)}
        </Toast.Actions>
      )}
    </Toast>
  );
}
const CONTENTS = [NotificationContent, IssueCreatedContent];

/** Queue-owned lifetime keeps the existing 5s confirmations independent of presenter mounting. */
export function showNotification(notice: Notification, id = NOTIFICATION_ID) {
  return toasts.show(<NotificationContent notice={notice} id={id} />, { id, duration: Infinity, expiresIn: 5000 });
}
/** "Issue created" for a new issue, in the confirmations' slot so Open link from last toast finds it. */
export function showIssueCreated(key: string) {
  const id = NOTIFICATION_ID;
  return toasts.show(<IssueCreatedContent notice={{ text: "Issue created", key }} id={id} />, {
    id,
    duration: Infinity,
    expiresIn: 5000,
  });
}

function latestContent(): ReactElement<ContentProps> | undefined {
  const content = toasts.find(NOTIFICATION_ID)?.content;
  return isValidElement<ContentProps>(content) && CONTENTS.includes(content.type as never) ? content : undefined;
}
export function latestNotification(): Notification | undefined {
  return latestContent()?.props.notice;
}

/** Rekey the queued content without restarting its lifetime. */
export function rekeyNotification(from: string, to: string) {
  const content = latestContent();
  const notice = content?.props.notice;
  if (!content || notice?.key !== from) return;
  const text = notice.text.replace(new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g"), to);
  toasts.update(NOTIFICATION_ID, cloneElement(content, { notice: { ...notice, key: to, text } }));
}
