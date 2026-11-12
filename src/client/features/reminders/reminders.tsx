import { type Issue } from "@/shared/issue-model";
import { NOTIFICATION_ID } from "@/client/state/app-notifications";
import { toasts } from "@/client/components/toast-queue";
import { useSyncExternalStore } from "react";
import { IconButton } from "@/client/components/button";
import { FutureTimeStep } from "./future-time-step";
/* oxlint-disable react/purity -- Display current elapsed time and retain a session reference time on mount. */
/* oxlint-disable react/refs -- Imperative editor/menu snapshots use refs and explicitly trigger renders when their visible state changes. */
import { useEffect, useState } from "react";
import {
  nextReminder,
  reminderDistance,
  reminderPresets,
  reminderTime,
} from "./reminder-display";
import { ActionMenu, type ActionEntry } from "@/client/components/action-menu";
import { Icon } from "@/client/components/icons";
import { Menu } from "@/client/components/menu";
import { MenuSurface } from "@/client/components/menu-surface";
import { CommandMenu, CommandTarget, useCommandTarget } from "@/client/components/command-menu";
import { set, useStore } from "@/client/state/store";
import { actions } from "@/client/state/issue-actions";
import { ui } from "@/client/features/navigation/app-navigation";
import { kept, useCommand } from "@/client/features/navigation/commands";

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
  const [custom, setCustom] = useState(startCustom);
  const [query, setQuery] = useState("");
  const choose = (at: string) => {
    if (Date.parse(at) <= Date.now()) {
      set({ perf: "Choose a future reminder time" });
      return;
    }
    onPick(at);
    close();
  };
  // A shortcut on an issue (Shift+H) opens Linear's command menu on it, whose keyboard placeholder is "Remind me at…" (Iq's
  // subActionPlaceholder); a document's menu stays beside its anchor.
  const target = useCommandTarget();
  const menu = (
    <Menu shouldFilter={false} style={target ? undefined : { width: 320 }}>
      <Menu.Input
        autoFocus
        aria-label="Reminder time"
        placeholder={target ? "Remind me at…" : REMIND_PLACEHOLDER}
        value={query}
        onValueChange={setQuery}
      />
      <Menu.List>
        <ReminderRows query={query} onPick={choose} onCustom={() => setCustom(true)} />
      </Menu.List>
    </Menu>
  );
  const body = custom ? (
    <FutureTimeStep
      label="Custom reminder"
      inputLabel="Custom reminder time"
      submitLabel="Set reminder"
      errorMessage="Choose a future reminder time"
      onPick={choose}
      onBack={() => setCustom(false)}
    />
  ) : (
    menu
  );
  return target ? (
    <CommandMenu label="Remind me" issue={target} close={close}>
      {body}
    </CommandMenu>
  ) : (
    <MenuSurface label="Remind me" anchorId={anchorId} anchor={anchor} close={close} fit>
      {body}
    </MenuSurface>
  );
}
export const REMIND_PLACEHOLDER = "Try: 4 pm, 2 days, in 5 weeks…";
/** The reminder rows (Linear's Remind me action, recalculateOnInput): a typed time ("4 pm", "in 2 days") or the presets it matches,
 *  then Custom…. One component for ReminderMenu and Issue options › Remind me. The typed-time parser (chrono) loads with it. The
 *  typed rows match whatever was typed, so a filtering menu keeps them. */
export function ReminderRows({
  query,
  onPick,
  onCustom,
}: {
  query: string;
  onPick: (at: string) => void;
  onCustom: () => void;
}) {
  const [reference] = useState(() => new Date()),
    [presets] = useState(() => reminderPresets(reference)),
    [parsed, setParsed] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void import("./reminder-date").then(({ parseReminder }) => {
      if (active) setParsed(query ? parseReminder(query, reference) : null);
    });
    return () => {
      active = false;
    };
  }, [query, reference]);
  const matches = presets.filter((p) => !query || p.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      {parsed ? (
        <Menu.Item value={parsed} keywords={[query]} icon={<Icon name="clock" />} onSelect={() => onPick(parsed)}>
          {reminderTime(parsed)}
        </Menu.Item>
      ) : (
        matches.map((p) => (
          <Menu.Item
            key={p.label}
            value={p.label}
            icon={<Icon name="clock" />}
            hint={<time dateTime={p.at}>{reminderTime(p.at)}</time>}
            onSelect={() => onPick(p.at)}
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
      <Menu.Item value="Custom…" keywords={query ? [query] : undefined} icon={<Icon name="clock" />} onSelect={onCustom}>
        Custom…
      </Menu.Item>
    </>
  );
}
/** An options menu's "Remind me" submenu: ReminderRows under Linear's placeholder, never listed in the root search (its
 *  subActionsHoisting is off). `pick` runs on a chosen time; `custom` opens the ReminderMenu's custom step. */
export const reminderSubmenu = (
  pick: (at: string) => void,
  custom: () => void,
): Pick<ActionEntry, "placeholder" | "hoistFrom" | "rows"> => ({
  placeholder: REMIND_PLACEHOLDER,
  hoistFrom: Infinity,
  rows: (query) => <ReminderRows query={query} onPick={pick} onCustom={custom} />,
});
/** The issue's reminder menu (overlay "reminder"): Linear's command menu on the issue (Shift+H, CORE-8); Issue options › Remind me ›
 *  Custom… opens it at the custom step, under Issue options. */
export function ReminderPicker({ issue }: { issue: Issue }) {
  const [custom, setCustom] = useState(
    () => kept("issue-options-start") === "reminder",
  );
  useCommand("issue-options-start", (start) => {
    if (start !== "reminder") return;
    setCustom(true);
    return true;
  });
  const menu = (
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
  // Issue options › Remind me › Custom… opens the custom step under Issue options; Shift+H opens the command menu on the issue.
  return custom ? menu : <CommandTarget issue={issue}>{menu}</CommandTarget>;
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
const hasConfirmation = () => toasts.has(NOTIFICATION_ID);

/** A single nearest-deadline timer, including overdue reminders restored after a reload. It re-arms only when the next
 *  reminder changes, not on every poll. */
export function ReminderDelivery() {
  const next = useStore((s) => nextReminder(s.issues)),
    toast = useSyncExternalStore(toasts.subscribe, hasConfirmation, hasConfirmation),
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
