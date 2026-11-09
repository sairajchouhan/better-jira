import { useEffect, useRef, useState } from "react";
import { Command } from "cmdk";
import { reminderDistance, reminderTime } from "./reminder-display";
import { ActionMenu } from "./action-menu";
import { Icon } from "./icons";
import { MenuSurface, MENU_ITEM, MENU_INPUT } from "./menu-surface";
import { actions, get, set, ui, useStore, type Issue } from "./store";

type Preset = { label: string; at: string };
export function ReminderPicker({ issue }: { issue: Issue }) {
  const reference = useRef(new Date()),
    [query, setQuery] = useState(""),
    [presets, setPresets] = useState<Preset[]>([]),
    [parsed, setParsed] = useState<string | null>(null),
    [custom, setCustom] = useState(() => get().issueOptionsStart === "reminder");
  useEffect(() => {
    if (get().issueOptionsStart === "reminder") set({ issueOptionsStart: null });
  }, []);
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
  return (
    <MenuSurface label="Remind me" anchorId="issue-options" close={close} width={320}>
      {custom ? (
        <form
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
              className={MENU_ITEM}
              // The custom time isn't a typed query: Back shows the presets again, not that time.
              onClick={() => {
                setParsed(null);
                setCustom(false);
              }}
            >
              Back
            </button>
            <button disabled={!parsed} className={`${MENU_ITEM} disabled:opacity-40`}>
              Set reminder
            </button>
          </div>
        </form>
      ) : (
        <Command
          loop
          shouldFilter={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") keyboardChoice.current = true;
            if (event.key === "Enter" && !query && !keyboardChoice.current) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
        >
          <Command.Input
            autoFocus
            aria-label="Reminder time"
            placeholder="Try: 4 pm, 2 days, in 5 weeks…"
            value={query}
            onValueChange={setQuery}
            className={MENU_INPUT}
          />
          <Command.List className="p-1">
            {parsed ? (
              <Command.Item value={parsed} className={MENU_ITEM} onSelect={() => choose(parsed)}>
                {reminderTime(parsed)}
              </Command.Item>
            ) : (
              presets
                .filter((p) => !query || p.label.toLowerCase().includes(query.toLowerCase()))
                .map((p) => (
                  <Command.Item
                    key={p.label}
                    value={p.label}
                    className={MENU_ITEM}
                    onSelect={() => choose(p.at)}
                  >
                    <span className="flex-1">{p.label}</span>
                    <time dateTime={p.at} className="text-[11px] text-fg-3">
                      {reminderTime(p.at)}
                    </time>
                  </Command.Item>
                ))
            )}
            {query &&
              !parsed &&
              !presets.some((p) => p.label.toLowerCase().includes(query.toLowerCase())) && (
                <p role="status" className="p-2 text-[12px] text-fg-3">
                  Choose a future date and time
                </p>
              )}
            <Command.Item className={MENU_ITEM} onSelect={() => setCustom(true)}>
              Custom…
            </Command.Item>
          </Command.List>
        </Command>
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
  }, [issues, toast, canEdit, clock]);
  return null;
}
