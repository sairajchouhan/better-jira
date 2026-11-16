import { cloneElement, isValidElement, type ReactElement } from "react";
import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";
import { Icon, StatusIcon, type IconName } from "@/client/components/icons";
import { get, statusOf, useStore, issueBoardId } from "./store";
import { currentKey } from "./jira-sync";
import { isLocalIssue } from "./local-edits";
import { navigate } from "@/client/features/navigation/app-navigation";

/** Each different confirmation is a toast of its own, so a second one stacks over the first (up to the queue's four): Linear
 *  shows every `new U(…).show()` as a sonner toast (ToastPresenter `visibleToasts: 4`, gap 8). The same one again takes the
 *  queued toast's place and restarts its time, as Linear's toast id is its type, title, description and link (`d5`,
 *  startup-entry), and sonner updates the toast that has it. Inbox undo keeps its own single slot. */
const CONFIRMATION = "confirmation-";
let confirmations = 0;
const confirmationIds = new Map<string, string>();
/** The queued toast's id for the same content, else a new one. */
export function confirmationId(signature: readonly unknown[]) {
  const content = JSON.stringify(signature);
  const queued = confirmationIds.get(content);
  if (queued && toasts.has(queued)) return queued;
  for (const [key, gone] of confirmationIds) if (!toasts.has(gone)) confirmationIds.delete(key);
  const id = `${CONFIRMATION}${++confirmations}`;
  confirmationIds.set(content, id);
  return id;
}
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
        // Linear's toast link opens the issue afresh (`kX`: `state: { resetBreadcrumb: true }`).
        navigate({ selected: key, panel: true, board: issueBoardId(get().issues.get(key)), trail: null });
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

/**
 * The issue of the newest toast that named one, kept after the toast is gone: Linear's ToastPresenter holds the last
 * toast link in state, set only when the newest toast has a link, for Open link from last toast (`applicable(){return
 * e!==void 0}`).
 */
let lastLink: string | undefined;
export const lastToastLink = () => lastLink;

/** Queue-owned lifetime keeps the existing 5s confirmations independent of presenter mounting. */
export function showNotification(
  notice: Notification,
  id = confirmationId(["notice", notice.text, notice.detail ?? "", notice.key ?? ""]),
) {
  if (notice.key) lastLink = notice.key;
  return toasts.show(<NotificationContent notice={notice} id={id} />, { id, duration: Infinity, expiresIn: 5000 });
}
/** "Issue created" for a new issue, a confirmation like the others so Open link from last toast finds it. */
export function showIssueCreated(key: string) {
  const id = confirmationId(["created", key]);
  lastLink = key;
  return toasts.show(<IssueCreatedContent notice={{ text: "Issue created", key }} id={id} />, {
    id,
    duration: Infinity,
    expiresIn: 5000,
  });
}

/** New issues whose "Issue created" waits for Jira's answer: on a writable site Jira may still refuse the create. */
const awaitingJira = new Set<string>();
/**
 * Confirms a new issue: at once when nothing goes to Jira, else once Jira has created it (`jiraAnswered`), so a refused create
 * shows only "Jira did not save the change", never "Issue created" beside it.
 */
export function announceCreated(key: string) {
  if (get().writable) awaitingJira.add(key);
  else showIssueCreated(key);
}
/** Jira answered the create of `from`: `to` is the key it gave, or undefined when it refused or the issue was discarded. */
export function jiraAnswered(from: string, to?: string) {
  if (awaitingJira.delete(from) && to) showIssueCreated(to);
}

/** The queued confirmations, newest first, with their content. */
function confirmationsNewestFirst() {
  return toasts.all().flatMap((toast) => {
    const content = toast.content;
    return toast.id.startsWith(CONFIRMATION) && isValidElement<ContentProps>(content) && CONTENTS.includes(content.type as never)
      ? [{ id: toast.id, content }]
      : [];
  }).reverse() as { id: string; content: ReactElement<ContentProps> }[];
}
/** Whether a confirmation is queued (reminders wait for it). */
export const hasConfirmation = () => toasts.all().some((toast) => toast.id.startsWith(CONFIRMATION));
/** The newest confirmation still queued. */
export function latestNotification(): Notification | undefined {
  return confirmationsNewestFirst()[0]?.content.props.notice;
}
/** Closes the confirmations about issues that are gone (an undone create). */
export function dismissNotificationsWithout(exists: (key: string) => boolean) {
  for (const { id, content } of confirmationsNewestFirst())
    if (content.props.notice.key && !exists(content.props.notice.key)) toasts.dismiss(id);
}

/** Rekey the queued content without restarting its lifetime. */
export function rekeyNotification(from: string, to: string) {
  if (lastLink === from) lastLink = to;
  for (const { id, content } of confirmationsNewestFirst()) {
    const notice = content.props.notice;
    if (notice.key !== from) continue;
    const text = notice.text.replace(new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "g"), to);
    toasts.update(id, cloneElement(content, { notice: { ...notice, key: to, text } }));
  }
}
