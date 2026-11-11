/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { useEffect, useRef, useState } from "react";
import { reminderDistance, reminderTime } from "./reminder-display";
import { ActionMenu } from "./action-menu";
import { Icon } from "./icons";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";
import { actions, set, ui, useStore, type Issue } from "./store";
import { kept, useCommand } from "./commands";

type Preset = { label: string; at: string };
const BUTTON = "rounded-md px-2 py-1.5 text-[13px] text-fg-2 hover:bg-hover disabled:opacity-40";
export function ReminderPicker({ issue }: { issue: Issue }) {
  const reference = useRef(new Date()),
    [query, setQuery] = useState(""),
    [presets, setPresets] = useState<Preset[]>([]),
    [parsed, setParsed] = useState<string | null>(null),
    [custom, setCustom] = useState(() => kept("issue-options-start") === "reminder");
  useCommand("issue-options-start", (start) => {
    if (start !== "reminder") return;
    setCustom(true);
    return true;
  });
  const keyboardChoice = useRef(false);
  const close = () => {
    ui.send({ type: "overlay.close" });
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLElement>('[aria-label^="Reminder scheduled"]') ??
        document.getElementById("issue-options")
      )?.focus(),
    );
  };
  useEffect(() => {
    let active = true;
    void import("./reminder-date").then(({ reminderPresets, parseReminder }) => {
      if (!active) return;
      setPresets(reminderPresets(reference.current));
      setParsed(query ? parseReminder(query, reference.current) : null);
    });
    return () => {
      active = false;
    };
  }, [query]);
  const choose = (at: string) => {
    if (Date.parse(at) <= Date.now()) {
      set({ perf: "Choose a future reminder time" });
      return;
    }
    actions.remind(issue.key, at);
    close();
  };
  const matches = presets.filter(
    (p) => !query || p.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <MenuSurface label="Remind me" anchorId="issue-options" close={close} fit>
      {custom ? (
        <form
          className="w-[320px]"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed) choose(parsed);
          }}
        >
          <label className="block p-2 text-[13px]">
            Custom reminder
            <input
              autoFocus
              aria-label="Custom reminder time"
              type="datetime-local"
              min={new Date(
                reference.current.getTime() - reference.current.getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)}
              className="mt-2 w-full rounded border border-line-2 bg-card p-2"
              onChange={(e) =>
                setParsed(e.target.value ? new Date(e.target.value).toISOString() : null)
              }
            />
          </label>
          <div className="flex justify-end gap-2 p-2">
            <button
              type="button"
              className={BUTTON}
              // The custom time isn't a typed query: Back shows the presets again, not that time.
              onClick={() => {
                setParsed(null);
                setCustom(false);
              }}
            >
              Back
            </button>
            <button disabled={!parsed} className={BUTTON}>
              Set reminder
            </button>
          </div>
        </form>
      ) : (
        <Menu
          shouldFilter={false}
          style={{ width: 320 }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") keyboardChoice.current = true;
            if (event.key === "Enter" && !query && !keyboardChoice.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <Menu.Input
            autoFocus
            aria-label="Reminder time"
            placeholder="Try: 4 pm, 2 days, in 5 weeks…"
            value={query}
            onValueChange={setQuery}
          />
          <Menu.List>
            {parsed ? (
              <Menu.Item value={parsed} onSelect={() => choose(parsed)}>
                {reminderTime(parsed)}
              </Menu.Item>
            ) : (
              matches.map((p) => (
                <Menu.Item
                  key={p.label}
                  value={p.label}
                  hint={<time dateTime={p.at}>{reminderTime(p.at)}</time>}
                  onSelect={() => choose(p.at)}
                >
                  {p.label}
                </Menu.Item>
              ))
            )}
            {query && !parsed && !matches.length && (
              <div role="status">
                <Menu.Empty always>Choose a future date and time</Menu.Empty>
              </div>
            )}
            <Menu.Item value="Custom…" onSelect={() => setCustom(true)}>
              Custom…
            </Menu.Item>
          </Menu.List>
        </Menu>
      )}
    </MenuSurface>
  );
}
export function ReminderControl({ issue }: { issue: Issue }) {
  const clock = useStore((s) => s.clock);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!issue.reminder || issue.reminder.delivered) return null;
  const label = `Reminder scheduled ${reminderDistance(issue.reminder.at, Math.max(clock, Date.now()))}`;
  return (
    <>
      <button
        aria-label={label}
        title={label}
        className="grid size-7 shrink-0 place-items-center rounded text-accent hover:bg-hover"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <Icon name="clock" size={15} />
      </button>
      {/* An action menu takes focus, so Esc closes it and not the issue (R2-issue-fields-D4). */}
      {anchor && (
        <ActionMenu
          label="Reminder options"
          anchor={anchor}
          close={() => {
            setAnchor(null);
            anchor.focus();
          }}
          entries={[
            {
              name: "Reschedule reminder",
              run: () => ui.send({ type: "overlay.open", overlay: "reminder" }),
            },
            {
              name: "Cancel reminder",
              run: () => {
                actions.remind(issue.key, null);
                requestAnimationFrame(() => document.getElementById("issue-options")?.focus());
              },
            },
          ]}
        />
      )}
    </>
  );
}
/** A single nearest-deadline timer, including overdue reminders restored after a reload. */
export function ReminderDelivery() {
  const issues = useStore((s) => s.issues),
    toast = useStore((s) => s.toast),
    canEdit = useStore((s) => s.canEdit),
    clock = useStore((s) => s.clock);
  useEffect(() => {
    if (toast || !canEdit) return;
    const pending = [...issues.values()]
      .flatMap((i) => [
        ...(i.reminder && !i.reminder.delivered
          ? [{ at: i.reminder.at, key: i.key, document: undefined as string | undefined }]
          : []),
        ...(i.resources ?? []).flatMap((r) =>
          r.reminder && !r.reminder.delivered
            ? [{ at: r.reminder.at, key: i.key, document: r.id }]
            : [],
        ),
      ])
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const next = pending[0];
    if (!next) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = Date.parse(next.at) - Date.now();
      timer = setTimeout(
        () => (remaining > 2147483647 ? check() : actions.deliverReminder(next.key, next.document)),
        Math.max(0, Math.min(2147483647, remaining)),
      );
    };
    check();
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Clock changes reschedule reminders after the tab wakes.
  }, [issues, toast, canEdit, clock]);
  return null;
}
