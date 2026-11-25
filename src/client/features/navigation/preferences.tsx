import { Dialog } from "@/client/components/dialog";
import { Switch } from "@/client/components/switch";
import { Text } from "@/client/components/text";
import { automationsKey } from "@/client/state/browser-preferences";
import { useStoredState } from "@/client/state/stored-state";
import {
  AUTO_ASSIGN_DEFAULTS,
  AUTO_ASSIGN_LABELS,
  parseAutoAssign,
  type AutoAssignPreferences,
} from "@/shared/auto-assign";
import { ui } from "./app-navigation";

/** One preference: its name and description beside a Switch; the whole row toggles it. */
function PreferenceSwitch({
  name,
  description,
  checked,
  onChange,
}: {
  name: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <Switch aria-label={name} isSelected={checked} onChange={onChange} className="flex cursor-default items-center justify-between gap-4 py-2">
      <span className="flex min-w-0 flex-col gap-0.5">
        <Text variant="smallPlus">{name}</Text>
        <Text variant="mini" color="muted">
          {description}
        </Text>
      </span>
      <Switch.Indicator />
    </Switch>
  );
}

const PREFERENCE_IDS = Object.keys(AUTO_ASSIGN_LABELS) as (keyof AutoAssignPreferences)[];

/**
 * Linear's Preferences (⌘K "Preferences", G then S: `showPreferencesModal` in startup-root.CnUSfl4j.js), with the one group we
 * act on: "Automations and workflows" (`X3.automationsAndWorkflows`). Kept per Jira site and account in this browser; issue
 * actions read it when an issue is created or moved (shared/auto-assign.ts).
 */
export function Preferences() {
  const [prefs, setPrefs] = useStoredState(
    automationsKey(),
    parseAutoAssign,
    AUTO_ASSIGN_DEFAULTS,
    "Could not save preferences in this browser",
  );
  const close = () => ui.send({ type: "overlay.close" });
  return (
    <Dialog label="Preferences" close={close} width={560}>
      <Dialog.Header className="p-6">
        <Dialog.Title>Preferences</Dialog.Title>
        <Dialog.Close />
      </Dialog.Header>
      <Dialog.Body className="flex flex-col px-6 pt-0 pb-6">
        <Text as="h3" variant="smallPlus" color="muted" className="mb-1">
          Automations and workflows
        </Text>
        {PREFERENCE_IDS.map((id) => (
          <PreferenceSwitch
            key={id}
            {...AUTO_ASSIGN_LABELS[id]}
            checked={prefs[id]}
            onChange={() => setPrefs({ ...prefs, [id]: !prefs[id] })}
          />
        ))}
      </Dialog.Body>
    </Dialog>
  );
}
