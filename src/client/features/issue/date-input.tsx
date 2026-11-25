import { useState, type KeyboardEvent } from "react";
import { Button } from "@/client/components/button";
import { Calendar } from "@/client/components/calendar";
import { Dialog } from "@/client/components/dialog";
import { Field, TextInput } from "@/client/components/field";
import { Text } from "@/client/components/text";
import { DUE_DIALOG } from "@/client/lib/due-date";
import { parseDueDate } from "@/client/lib/due-parse";
import "./date-input.css";

/** What the typed text means: a date, nothing (cleared), or not a date yet. */
export function readDueText(text: string): { date: string | null; valid: boolean } {
  if (!text.trim()) return { date: null, valid: true };
  const date = parseDueDate(text);
  return { date, valid: !!date };
}

/**
 * Linear's issue due-date dialog (`r3t`): "Set due date" or "Edit due date"; a Due date field taking typed dates
 * ("tomorrow", "Feb 9") whose preview the calendar circles and turns to; two months below it (hidden on phones), where a
 * day saves at once; and Remove due date (when there is one), Cancel and Save due date. Enter saves what is typed, Escape
 * in the field moves to the Close button (`onEscape`), as Linear's does.
 */
export function DueDateDialog({
  value,
  onSave,
  close,
}: {
  value: string | null;
  /** The new due date, or null to remove it; the dialog closes after. */
  onSave: (due: string | null) => void;
  close: () => void;
}) {
  const [text, setText] = useState(value ?? "");
  const typed = readDueText(text);
  // Linear's `u`: the last date the field accepted, which Save saves.
  const [due, setDue] = useState(value);
  const save = (next: string | null) => {
    onSave(next);
    close();
  };
  const verb = value ? "Edit" : "Set";
  return (
    <Dialog label={`${verb} due date`} close={close} placement="third" width={DUE_DIALOG.WIDTH}>
      <Dialog.Header>
        <Dialog.Title>
          <Text variant="smallPlus" color="muted">
            {verb}
          </Text>{" "}
          <Text variant="smallPlus" color="base">
            due date
          </Text>
        </Dialog.Title>
        <Dialog.Close shortcut="Esc" />
      </Dialog.Header>
      <div className="ui-due-body">
        <Field className="ui-due-field">
          <div className="ui-due-label">
            <Field.Label>
              <Text variant="smallPlus" color="base">
                Due date
              </Text>
            </Field.Label>
            {/* FF's helpText: a faint dash on desktop, then the muted hint 4px on. */}
            <Text variant="mini" color="faint" className="ui-due-dash">
              -
            </Text>
            <Text variant="mini" color="muted">
              Issue needs to be completed by this date
            </Text>
          </div>
          <TextInput
            autoComplete="off"
            aria-invalid={!typed.valid}
            placeholder="Tomorrow, next Monday, in 2 weeks…"
            value={text}
            onChange={(event) => {
              const next = readDueText(event.target.value);
              setText(event.target.value);
              if (next.valid) setDue(next.date);
            }}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (typed.valid) save(typed.date);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.closest("[role=dialog]")?.querySelector<HTMLElement>(".ui-dialog-close")?.focus();
              }
            }}
            className="w-full"
          />
          <Field.Description role="status" className="ui-due-status">
            <Text variant="mini" color="muted">
              {typed.date
                ? new Date(`${typed.date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : typed.valid
                  ? ""
                  : "Enter a complete date, such as next Monday"}
            </Text>
          </Field.Description>
        </Field>
        {/* A press on the calendar keeps focus in the field (Linear's onMouseDown preventDefault). */}
        <div className="ui-due-calendar" onMouseDown={(event) => event.preventDefault()}>
          <Calendar label="Due date" value={value} highlighted={typed.date} onChange={save} />
        </div>
      </div>
      <Dialog.Footer className="ui-due-footer">
        {value && (
          <Button variant="secondary" size="small" onClick={() => save(null)}>
            Remove due date
          </Button>
        )}
        <div className="ui-due-actions">
          <Button variant="secondary" size="small" onClick={close}>
            Cancel
          </Button>
          <Button size="small" disabled={!typed.valid} onClick={() => save(due)}>
            Save due date
          </Button>
        </div>
      </Dialog.Footer>
    </Dialog>
  );
}
