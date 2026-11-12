import { TextInput } from "./field";
import { Button, IconButton } from "./button";
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { useEffect, useRef, useState } from "react";
import {
  nextReminder,
  reminderDistance,
  reminderPresets,
  reminderTime,
} from "./reminder-display";
import { ActionMenu, type ActionEntry } from "./action-menu";
import { Icon } from "./icons";
import { Menu } from "./menu";
import { MenuSurface } from "./menu-surface";
import { actions, set, ui, useStore, type Issue } from "./store";
import { kept, useCommand } from "./commands";

type Preset = { label: string; at: string };

/** Linear's one "Remind me" menu, for an issue or a document: a typed time ("4 pm", "in 2 days"), a preset, or a custom date
 *  and time. The typed-time parser (chrono) loads with the menu. `onPick` gets a future ISO time; the menu then closes. */
export function ReminderMenu({
  anchor,
  anchorId,
  startCustom = false,
  onPick,
  close,
}: {
  anchor?: HTMLElement | null;
  anchorId?: string;
  startCustom?: boolean;
  onPick: (at: string) => void;
  close: () => void;
}) {
  const reference = useRef(new Date()),
    [query, setQuery] = useState(""),
    [presets, setPresets] = useState<Preset[]>([]),
    [parsed, setParsed] = useState<string | null>(null),
    [custom, setCustom] = useState(startCustom);
  const keyboardChoice = useRef(false);
  useEffect(() => {
    let active = true;
    void import("./reminder-date").then(
      ({ reminderPresets, parseReminder }) => {
        if (!active) return;
        setPresets(reminderPresets(reference.current));
        setParsed(query ? parseReminder(query, reference.current) : null);
      },
    );
    return () => {
      active = false;
    };
  }, [query]);
  const choose = (at: string) => {
    if (Date.parse(at) <= Date.now()) {
      set({ perf: "Choose a future reminder time" });
      return;
    }
    onPick(at);
    close();
  };
  const matches = presets.filter(
    (p) => !query || p.label.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <MenuSurface
      label="Remind me"
      anchorId={anchorId}
      anchor={anchor}
      close={close}
      fit
    >
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
            <TextInput
              autoFocus
              aria-label="Custom reminder time"
              type="datetime-local"
              min={new Date(
                reference.current.getTime() -
                  reference.current.getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)}
              className="w-full mt-2"
              onChange={(e) =>
                setParsed(
                  e.target.value
                    ? new Date(e.target.value).toISOString()
                    : null,
                )
              }
            />
          </label>
          <div className="flex justify-end gap-2 p-2">
            <Button
              type="button"

              // The custom time isn't a typed query: Back shows the presets again, not that time.
              onClick={() => {
                setParsed(null);
                setCustom(false);
              }}
              variant="borderless"
              size="medium"
            >
              Back
            </Button>
            <Button
              disabled={!parsed}
              type="submit"
              variant="primary"
              size="medium"
            >
              Set reminder
            </Button>
          </div>
        </form>
      ) : (
        <Menu
          shouldFilter={false}
          style={{ width: 320 }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp")
              keyboardChoice.current = true;
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
/** The "Remind me" submenu rows of an options menu: the presets, then Custom…, which opens the ReminderMenu's custom step. */
export const reminderEntries = (
  pick: (at: string) => void,
  custom: () => void,
): ActionEntry[] => [
  ...reminderPresets().map((preset) => ({
    name: preset.label,
    icon: "clock" as const,
    shortcut: reminderTime(preset.at),
    run: () => pick(preset.at),
  })),
  { name: "Custom…", icon: "calendar", run: custom },
];
/** The open issue's reminder menu (overlay "reminder"), under Issue options; Issue options › Remind me › Custom… opens it at the custom step. */
export function ReminderPicker({ issue }: { issue: Issue }) {
  const [custom, setCustom] = useState(
    () => kept("issue-options-start") === "reminder",
  );
  useCommand("issue-options-start", (start) => {
    if (start !== "reminder") return;
    setCustom(true);
    return true;
  });
  return (
    <ReminderMenu
      key={String(custom)}
      anchorId="issue-options"
      startCustom={custom}
      onPick={(at) => actions.remind(issue.key, at)}
      close={() => {
        ui.send({ type: "overlay.close" });
        requestAnimationFrame(() =>
          (
            document.querySelector<HTMLElement>(
              '[aria-label^="Reminder scheduled"]',
            ) ?? document.getElementById("issue-options")
          )?.focus(),
        );
      }}
    />
  );
}
export function ReminderControl({ issue }: { issue: Issue }) {
  const clock = useStore((s) => s.clock);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!issue.reminder || issue.reminder.delivered) return null;
  const label = `Reminder scheduled ${reminderDistance(issue.reminder.at, Math.max(clock, Date.now()))}`;
  return (
    <>
      <IconButton
        label={label}

        onClick={(e) => setAnchor(e.currentTarget)}
        variant="borderless"
        size="medium"
      >
        <Icon name="clock" size={15} />
      </IconButton>
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
                requestAnimationFrame(() =>
                  document.getElementById("issue-options")?.focus(),
                );
              },
            },
          ]}
        />
      )}
    </>
  );
}
/** A single nearest-deadline timer, including overdue reminders restored after a reload. It re-arms only when the next
 *  reminder changes, not on every poll. */
export function ReminderDelivery() {
  const next = useStore((s) => nextReminder(s.issues)),
    toast = useStore((s) => s.toast),
    canEdit = useStore((s) => s.canEdit),
    clock = useStore((s) => s.clock);
  useEffect(() => {
    if (toast || !canEdit || !next) return;
    const [at = "", key = "", document] = next.split("\n");
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = Date.parse(at) - Date.now();
      timer = setTimeout(
        () =>
          remaining > 2147483647
            ? check()
            : actions.deliverReminder(key, document || undefined),
        Math.max(0, Math.min(2147483647, remaining)),
      );
    };
    check();
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Clock changes reschedule reminders after the tab wakes.
  }, [next, toast, canEdit, clock]);
  return null;
}
