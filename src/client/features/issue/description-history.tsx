import { createContext, use, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { Button } from "@/client/components/button";
import { Dialog } from "@/client/components/dialog";
import { Switch } from "@/client/components/switch";
import { Text } from "@/client/components/text";
import { showNotification } from "@/client/state/app-notifications";
import { actions } from "@/client/state/issue-actions";
import { get, useStore } from "@/client/state/store";
import type { Issue, User } from "@/shared/issue-model";
import {
  currentVersion,
  descriptionVersions,
  issueDescriptionVersions,
  restoreBlocker,
  versionBucket,
  wordDiff,
  type DescriptionVersion,
} from "./description-versions";
import type { Actor, PropertyActivity } from "./issue-activity";
import { absoluteDate, fullTime } from "./issue-dates";
import { useIssueHistory } from "./use-issue-history";
import "./description-history.css";

/** Linear's history dialog width (`uo.widths.xxlarge`, startup-entry). */
const WIDTH = 1020;

const DescriptionHistoryContext = createContext<{ show: (versionId: string) => void } | null>(null);

/**
 * Owns the issue's description history for the Activity: its "updated the description" rows open it at their version. The
 * issue menu's "Show description history" opens the same dialog through IssueDescriptionHistory (Linear's `Xz` in
 * startup-root opens one dialog, `sJt`, from both). Without a provider the row stays plain text.
 */
export function DescriptionHistoryProvider({
  issueKey,
  events,
  created,
  revisions,
  children,
}: {
  issueKey: string;
  events: readonly PropertyActivity[];
  created?: { at?: string; actor?: Actor | null };
  revisions?: Issue["descriptionHistory"];
  children: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const versions = useMemo(() => descriptionVersions(events, created, revisions), [events, created, revisions]);
  const context = useMemo(() => ({ show: setOpen }), []);
  return (
    <DescriptionHistoryContext value={context}>
      {children}
      {open !== null && (
        <DescriptionHistoryDialog issueKey={issueKey} versions={versions} initial={open} close={() => setOpen(null)} />
      )}
    </DescriptionHistoryContext>
  );
}

/** The issue menu's "Show description history": the same dialog at the newest version. It reads Jira's history itself, as the
 *  menu also opens from a list row, where no Activity is mounted. */
export function IssueDescriptionHistory({ issue, close }: { issue: Issue; close: () => void }) {
  const updated = useStore((s) => s.full.get(issue.key)?.fields.updated);
  const history = useIssueHistory(issue.key, updated);
  const versions = useMemo(() => issueDescriptionVersions(issue, history), [issue, history]);
  return <DescriptionHistoryDialog issueKey={issue.key} versions={versions} close={close} />;
}

/** The row's words as the way into the history at this edit's version. */
export function DescriptionHistoryLink({ versionId, children }: { versionId: string; children: ReactNode }) {
  const history = use(DescriptionHistoryContext);
  if (!history) return children;
  return (
    <button
      type="button"
      className="text-left underline-offset-2 hover:text-fg-2 hover:underline"
      aria-haspopup="dialog"
      title="Show description history"
      onClick={() => history.show(versionId)}
    >
      {children}
    </button>
  );
}

/** Linear's `sJt`: the selected version, its changes against the one before highlighted ("Highlight changes", on by default),
 *  beside the version list in day buckets, newest first, the current one marked. Arrow keys move through the list. The
 *  versions may still be loading (the menu's way in): the selection falls back to the newest, as Linear's selects `y[0]`
 *  once the timeline arrives, and an empty list reads Linear's "There is no history yet." (`xJt`). */
function DescriptionHistoryDialog({
  issueKey,
  versions,
  initial,
  close,
}: {
  issueKey: string;
  versions: DescriptionVersion[];
  initial?: string;
  close: () => void;
}) {
  const [selected, setSelected] = useState(initial);
  const [highlight, setHighlight] = useState(true);
  const index = Math.max(
    0,
    versions.findIndex((v) => v.id === selected),
  );
  const version = versions[index];
  const current = currentVersion(versions);
  const parts = useMemo(
    () =>
      !version
        ? []
        : highlight && version.previous !== undefined
          ? wordDiff(version.previous, version.text)
          : [{ kind: "same" as const, text: version.text }],
    [version, highlight],
  );
  const buckets = useMemo(() => {
    const groups = new Map<string, DescriptionVersion[]>();
    for (const v of versions) {
      const label = v.at ? versionBucket(v.at) : "Created";
      groups.set(label, [...(groups.get(label) ?? []), v]);
    }
    return [...groups];
  }, [versions]);
  const move = (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    const next = versions[index + step];
    if (!step || !next) return;
    event.preventDefault();
    setSelected(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-version="${CSS.escape(next.id)}"]`)?.focus();
  };
  // Linear's restore: the version replaces the description, then "Content has been restored." with Undo.
  const restore = (version: DescriptionVersion) => {
    const replaced = get().full.get(issueKey)?.fields.description;
    actions.description(issueKey, version.document ?? version.text, true);
    showNotification({
      text: "Content has been restored.",
      undo: replaced ? () => actions.description(issueKey, replaced, true) : undefined,
    });
    close();
  };
  const blocker = version && restoreBlocker(version, current);
  return (
    <Dialog label="Issue description" close={close} width={WIDTH}>
      <Dialog.Header>
        <Dialog.Title>Issue description</Dialog.Title>
        <Dialog.Close shortcut="Esc" />
      </Dialog.Header>
      {!version ? (
        <Dialog.Body>
          <Text color="muted">There is no history yet.</Text>
        </Dialog.Body>
      ) : (
      <div className="description-history">
        <div className="description-history-content">
          <div className="description-history-toolbar">
            {version.previous !== undefined && (
              <label className="description-history-switch">
                <Switch size="small" checked={highlight} onChange={(e) => setHighlight(e.currentTarget.checked)} />
                <Text variant="mini" color="muted">
                  Highlight changes
                </Text>
              </label>
            )}
            <Button
              variant="primary"
              size="small"
              className="ml-auto"
              disabled={blocker !== undefined}
              disabledReason={blocker || undefined}
              onClick={() => restore(version)}
            >
              Restore version
            </Button>
          </div>
          <div className="description-history-text" aria-label="Description version">
            {parts.map((part, i) =>
              part.kind === "same" ? (
                part.text
              ) : part.kind === "added" ? (
                <ins key={i} className="description-change-addition">
                  {part.text}
                </ins>
              ) : (
                <del key={i} className="description-change-deletion">
                  {part.text}
                </del>
              ),
            )}
            {!version.text && parts.every((part) => part.kind === "same") && (
              <Text variant="small" color="faint">
                No description
              </Text>
            )}
          </div>
        </div>
        <nav className="description-history-versions" aria-label="Versions" onKeyDown={move}>
          {buckets.map(([label, list]) => (
            <div key={label} className="description-history-bucket">
              <Text variant="mini" color="muted" className="description-history-bucket-label">
                {label}
              </Text>
              {list.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  data-version={v.id}
                  aria-current={v === version}
                  tabIndex={v === version ? 0 : -1}
                  className="description-history-version"
                  onClick={() => setSelected(v.id)}
                >
                  <span className="description-history-version-time">
                    {v.at ? (
                      <time dateTime={v.at} title={fullTime(v.at)}>
                        {absoluteDate(v.at)}{" "}
                        {new Date(v.at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
                      </time>
                    ) : (
                      "Original"
                    )}
                    {v === current && <span className="description-history-current">Current</span>}
                  </span>
                  <span className="description-history-version-actor">
                    {v.actor && <Avatar user={v.actor as User} size={14} />}
                    {v.kind === "creation"
                      ? v.actor
                        ? `Created by ${v.actor.name}`
                        : "Created"
                      : v.kind === "local"
                        ? "Saved in this app"
                        : (v.actor?.name ?? "Someone")}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
      )}
    </Dialog>
  );
}
