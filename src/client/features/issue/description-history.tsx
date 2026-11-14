import { createContext, use, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Avatar } from "@/client/components/avatar";
import { Dialog } from "@/client/components/dialog";
import { Switch } from "@/client/components/switch";
import { Text } from "@/client/components/text";
import type { User } from "@/shared/issue-model";
import { descriptionVersions, versionBucket, wordDiff, type DescriptionVersion } from "./description-versions";
import type { Actor, PropertyActivity } from "./issue-activity";
import { absoluteDate, fullTime } from "./issue-dates";
import "./description-history.css";

/** Linear's history dialog width (`uo.widths.xxlarge`, startup-entry). */
const WIDTH = 1020;

const DescriptionHistoryContext = createContext<{ show: (versionId: string) => void } | null>(null);

/**
 * Owns the issue's description history: the Activity's "updated the description" rows open it at their version (Linear's
 * "Show description history", `Xz` in startup-root, opens the same dialog from the issue menu). Without a provider the row
 * stays plain text.
 */
export function DescriptionHistoryProvider({
  events,
  created,
  children,
}: {
  events: readonly PropertyActivity[];
  created?: { at?: string; actor?: Actor | null };
  children: ReactNode;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const versions = useMemo(() => descriptionVersions(events, created), [events, created]);
  const context = useMemo(() => ({ show: setOpen }), []);
  return (
    <DescriptionHistoryContext value={context}>
      {children}
      {open !== null && versions.length > 0 && (
        <DescriptionHistoryDialog versions={versions} initial={open} close={() => setOpen(null)} />
      )}
    </DescriptionHistoryContext>
  );
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
 *  beside the version list in day buckets, newest first, the newest marked Current. Arrow keys move through the list. */
function DescriptionHistoryDialog({
  versions,
  initial,
  close,
}: {
  versions: DescriptionVersion[];
  initial: string;
  close: () => void;
}) {
  const [selected, setSelected] = useState(() => versions.find((v) => v.id === initial)?.id ?? versions[0]!.id);
  const [highlight, setHighlight] = useState(true);
  const index = Math.max(
    0,
    versions.findIndex((v) => v.id === selected),
  );
  const version = versions[index]!;
  const parts = useMemo(
    () =>
      highlight && version.previous !== undefined
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
  return (
    <Dialog label="Issue description" close={close} width={WIDTH}>
      <Dialog.Header>
        <Dialog.Title>Issue description</Dialog.Title>
        <Dialog.Close shortcut="Esc" />
      </Dialog.Header>
      <div className="description-history">
        <div className="description-history-content">
          {version.previous !== undefined && (
            <label className="description-history-switch">
              <Switch size="small" checked={highlight} onChange={(e) => setHighlight(e.currentTarget.checked)} />
              <Text variant="mini" color="muted">
                Highlight changes
              </Text>
            </label>
          )}
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
                  aria-current={v.id === selected}
                  tabIndex={v.id === selected ? 0 : -1}
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
                    {v === versions[0] && <span className="description-history-current">Current</span>}
                  </span>
                  <span className="description-history-version-actor">
                    {v.actor && <Avatar user={v.actor as User} size={14} />}
                    {v.kind === "creation" ? (v.actor ? `Created by ${v.actor.name}` : "Created") : (v.actor?.name ?? "Someone")}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </Dialog>
  );
}
